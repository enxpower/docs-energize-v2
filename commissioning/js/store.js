/**
 * store.js
 * EnergizeOS Commissioning Copilot V1
 *
 * Three layers in one module (kept together because they share the schema):
 *
 *   Chunker          — splits extracted text into retrieval units
 *   DocumentStore    — IndexedDB persistence (projects, documents, chunks)
 *   RetrievalService — scored keyword retrieval over chunks
 *
 * Persistence design:
 *   IndexedDB database "energizeos-commissioning", three object stores:
 *     projects  { id, name, siteType, createdAt }
 *     documents { id, projectId, fileName, category, size, parser,
 *                 warnings, pageCount, uploadedAt }
 *     chunks    { id, projectId, docId, fileName, category, page,
 *                 heading, text, ts }
 *
 *   This is the V1 form of the knowledge-capture layer: every uploaded
 *   project persists locally and remains searchable across sessions.
 *   The schema is intentionally backend-shaped so a future server-side
 *   store (Postgres + vector index) can adopt it without remodeling.
 */

"use strict";

// ============================================================== Chunker

const CHUNK_TARGET_CHARS = 1400;   // ~350 tokens
const CHUNK_OVERLAP_CHARS = 150;

/**
 * Detect a section heading in a line of text.
 * Matches numbered headings ("3.2 Protection Settings"), ALL-CAPS lines,
 * and markdown headings.
 * @param {string} line
 * @returns {string|null}
 */
function detectHeading(line) {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  if (/^#{1,4}\s+\S/.test(t)) return t.replace(/^#+\s*/, "");
  if (/^\d+(\.\d+)*[.)]?\s+[A-Z]/.test(t)) return t;
  if (/^[A-Z][A-Z0-9 \-/&]{6,80}$/.test(t) && !/\d{4,}/.test(t)) return t;
  return null;
}

/**
 * Split parsed pages into chunks with metadata.
 * @param {object} parsed   - ParsedDocument from parsers.js
 * @param {object} docMeta  - { docId, projectId, fileName, category }
 * @returns {Array<object>} chunks
 */
function chunkDocument(parsed, docMeta) {
  const chunks = [];
  let currentHeading = null;

  for (const pageObj of (parsed.pages.length ? parsed.pages : [{ page: 1, text: parsed.text }])) {
    const lines = pageObj.text.split(/\n/);
    let buf = "";

    const flush = () => {
      const text = buf.trim();
      if (text.length > 40) {
        chunks.push({
          id: `${docMeta.docId}-c${chunks.length}`,
          projectId: docMeta.projectId,
          docId: docMeta.docId,
          fileName: docMeta.fileName,
          category: docMeta.category,
          page: pageObj.page,
          heading: currentHeading,
          text,
          ts: new Date().toISOString(),
        });
      }
      // keep overlap tail for context continuity
      buf = text.slice(-CHUNK_OVERLAP_CHARS);
    };

    for (const line of lines) {
      const h = detectHeading(line);
      if (h) { flush(); currentHeading = h; buf = ""; }
      buf += line + "\n";
      if (buf.length >= CHUNK_TARGET_CHARS) flush();
    }
    flush();
    buf = "";
  }
  return chunks;
}

// ============================================================== DocumentStore

const DB_NAME = "energizeos-commissioning";
const DB_VERSION = 1;

class DocumentStore {
  constructor() { this.db = null; }

  /** Open (or create) the IndexedDB database. */
  async init() {
    if (this.db) return this;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("projects"))
          db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("documents")) {
          const s = db.createObjectStore("documents", { keyPath: "id" });
          s.createIndex("byProject", "projectId");
        }
        if (!db.objectStoreNames.contains("chunks")) {
          const s = db.createObjectStore("chunks", { keyPath: "id" });
          s.createIndex("byProject", "projectId");
          s.createIndex("byDoc", "docId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this;
  }

  _tx(store, mode = "readonly") {
    return this.db.transaction(store, mode).objectStore(store);
  }
  _req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }

  // ---- projects
  async saveProject(p)        { return this._req(this._tx("projects", "readwrite").put(p)); }
  async getProject(id)        { return this._req(this._tx("projects").get(id)); }
  async listProjects()        { return this._req(this._tx("projects").getAll()); }

  // ---- documents
  async saveDocument(d)       { return this._req(this._tx("documents", "readwrite").put(d)); }
  async listDocuments(projectId) {
    return this._req(this._tx("documents").index("byProject").getAll(projectId));
  }
  async deleteDocument(docId) {
    await this._req(this._tx("documents", "readwrite").delete(docId));
    // delete chunks belonging to the doc
    const chunks = await this._req(this._tx("chunks").index("byDoc").getAll(docId));
    const store = this._tx("chunks", "readwrite");
    await Promise.all(chunks.map(c => this._req(store.delete(c.id))));
  }

  // ---- chunks
  async saveChunks(chunks) {
    const store = this._tx("chunks", "readwrite");
    await Promise.all(chunks.map(c => this._req(store.put(c))));
  }
  async listChunks(projectId) {
    return this._req(this._tx("chunks").index("byProject").getAll(projectId));
  }
}

// ============================================================== RetrievalService

/**
 * Scored keyword retrieval.
 *
 * V1 algorithm (deliberately simple, transparent, debuggable):
 *   score = Σ termFrequency(term) * idfWeight(term)
 *           + headingBonus + categoryBonus
 *
 * Domain synonym expansion improves recall for field vocabulary
 * (e.g. "trip" also matches "tripped", "51", "overcurrent").
 *
 * Future: swap in embedding similarity behind the same interface —
 * retrieve(query, projectId, opts) — without touching callers.
 */
const DOMAIN_SYNONYMS = {
  trip:     ["tripped", "tripping", "51", "50", "overcurrent", "fault"],
  voltage:  ["volt", "kv", "vac", "vdc", "27", "59", "undervoltage", "overvoltage"],
  frequency:["freq", "hz", "81", "underfrequency", "overfrequency", "rocof"],
  soc:      ["state of charge", "state-of-charge"],
  modbus:   ["register", "holding", "tcp", "rtu", "polling"],
  bms:      ["battery management"],
  pcs:      ["inverter", "power conversion"],
  relay:    ["sel", "700g", "735", "protection"],
  breaker:  ["52", "52a", "52b", "cb"],
  export:   ["reverse power", "32", "backfeed", "zero export"],
  sync:     ["synchronism", "25", "phase angle", "synchronization"],
  alarm:    ["alarms", "event", "warning", "fault"],
  estop:    ["e-stop", "emergency stop"],
  ground:   ["grounding", "earth", "insulation", "megger", "ir test"],
};

class RetrievalService {
  /** @param {DocumentStore} store */
  constructor(store) { this.store = store; }

  /**
   * Retrieve the most relevant chunks for a query.
   * @param {string} query
   * @param {string} projectId
   * @param {object} [opts] { topK?: number, category?: string }
   * @returns {Promise<Array<{chunk, score}>>}
   */
  async retrieve(query, projectId, opts = {}) {
    const topK = opts.topK || 8;
    const chunks = await this.store.listChunks(projectId);
    if (!chunks.length) return [];

    // Build expanded term list
    const baseTerms = query.toLowerCase().match(/[a-z0-9][a-z0-9\-/.]{1,30}/g) || [];
    const terms = new Set(baseTerms);
    for (const t of baseTerms) {
      if (DOMAIN_SYNONYMS[t]) DOMAIN_SYNONYMS[t].forEach(s => terms.add(s));
    }

    // Document frequency for idf weighting
    const df = {};
    for (const term of terms) {
      df[term] = chunks.reduce((n, c) => n + (c.text.toLowerCase().includes(term) ? 1 : 0), 0);
    }
    const N = chunks.length;

    const scored = chunks.map(chunk => {
      const lower = chunk.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!df[term]) continue;
        const tf = lower.split(term).length - 1;
        if (!tf) continue;
        const idf = Math.log(1 + N / df[term]);
        score += tf * idf;
      }
      // heading bonus
      if (chunk.heading) {
        const hLower = chunk.heading.toLowerCase();
        for (const term of terms) if (hLower.includes(term)) score += 2.5;
      }
      // category bias if caller specified
      if (opts.category && chunk.category === opts.category) score *= 1.4;
      return { chunk, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

window.CxStore = { DocumentStore, RetrievalService, chunkDocument };
