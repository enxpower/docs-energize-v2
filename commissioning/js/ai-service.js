/**
 * ai-service.js
 * EnergizeOS Commissioning Copilot V1
 *
 * Single AI service layer:
 *   - System prompt construction (commissioning engineer persona)
 *   - Context assembly from RetrievalService results
 *   - Anthropic API integration (BYOK — user-supplied key, browser-direct)
 *   - Mock AI fallback when no key is configured
 *
 * KEY HANDLING:
 *   The API key is entered by the user and stored ONLY in the browser
 *   (localStorage, this device). It is never embedded in source, never
 *   sent anywhere except directly to api.anthropic.com over HTTPS using
 *   Anthropic's official CORS support ("anthropic-dangerous-direct-
 *   browser-access" header). A future hosted backend can replace this
 *   transparently — callers only use AiService.ask().
 *
 * V2/V3 ARCHITECTURE STUBS at bottom of file:
 *   PCSDataConnector, BMSDataConnector, EMSDataConnector,
 *   ModbusConnector, AlarmLogConnector, SiteTelemetryConnector,
 *   ReportWorkflowService.
 */

"use strict";

const AI_CONFIG = {
  // Model is configurable — single definition point, never hard-coded elsewhere.
  model: localStorage.getItem("cx-model") || "claude-sonnet-4-20250514",
  maxTokens: 2000,
  apiKeyStorageKey: "cx-anthropic-key",
};

// ============================================================== prompts

/**
 * Build the commissioning assistant system prompt.
 * @param {object} project   { name, siteType }
 * @param {Array}  documents document metadata list
 * @returns {string}
 */
function buildSystemPrompt(project, documents) {
  const D = window.CxDomain;
  const K = D.COMMISSIONING_KNOWLEDGE;

  const docList = documents.length
    ? documents.map(d => `- ${d.fileName} [${D.categoryLabel(d.category)}] (${d.pageCount} page(s), parser: ${d.parser}${d.warnings?.length ? ", warnings: " + d.warnings.join("; ") : ""})`).join("\n")
    : "(no documents uploaded yet)";

  const bessSeq = K.bess_sequence.map((s, i) => `${i + 1}. ${s.step} — ${s.detail}`).join("\n");
  const emsSeq  = K.ems_sequence.map((s, i) => `${i + 1}. ${s.step} — ${s.detail}`).join("\n");
  const tsCats  = K.troubleshooting_categories.map(c =>
    `- ${c.label}: first checks → ${c.first_checks.join("; ")}`).join("\n");

  return `# EnergizeOS Commissioning Copilot

You are a senior commissioning engineer and EMS/BESS systems engineer assisting field engineers and project managers. You combine the perspectives of: commissioning lead, relay and controls troubleshooter, and safety-conscious field advisor.

## Project Context
- Project: ${project.name || "(unnamed)"}
- Site type: ${D.siteTypeLabel(project.siteType)}
- Uploaded documents:
${docList}

## Hard Rules
1. NEVER pretend certainty when documents are incomplete. State explicitly what is missing and how it limits confidence.
2. NEVER instruct energization, switching, relay setting changes, or live electrical work as a direct command. Frame as procedures that require qualified personnel, site safety procedures, and LOTO.
3. After a protection trip: NEVER recommend reset-and-retry. Always require event report retrieval and root cause review first.
4. Every claim drawn from an uploaded document must cite the file name (and page where available).
5. If asked something the uploaded documents do not cover, say so plainly, then give general engineering guidance clearly labelled as general (not project-specific).
6. Stale data, bad-quality data, and comm loss must always be treated as FALSE/unsafe in any permissive logic discussion.

## Answer Structure
For substantive technical questions, structure the answer as (omit sections that don't apply):
1. **Direct answer**
2. **Evidence from uploaded files** (file name + page)
3. **Likely root cause**
4. **Recommended checks**
5. **Safety warnings**
6. **Missing information**
7. **Suggested next action**

For troubleshooting, use: Symptom → Evidence → Possible causes → Checks → Recommended action → Escalation.

For report generation, write in concise professional language suitable for customers, EPCs, utilities, and internal engineering teams. No filler.

## Canonical BESS Commissioning Sequence
${bessSeq}

## Canonical EMS Commissioning Sequence
${emsSeq}

## Troubleshooting Knowledge
${tsCats}

## Safety Notice (include when relevant, do not repeat in every message)
${D.SAFETY_DISCLAIMER}`;
}

/**
 * Format retrieved chunks as a context block for the user message.
 * @param {Array<{chunk, score}>} results
 * @returns {string}
 */
function buildRetrievalContext(results) {
  if (!results.length) return "";
  const blocks = results.map((r, i) => {
    const c = r.chunk;
    const loc = [c.fileName, c.page ? `p.${c.page}` : null, c.heading ? `§ ${c.heading}` : null]
      .filter(Boolean).join(", ");
    return `[SOURCE ${i + 1}: ${loc}]\n${c.text}`;
  });
  return `\n\n--- RETRIEVED DOCUMENT EXCERPTS (cite by file name and page) ---\n${blocks.join("\n\n")}\n--- END EXCERPTS ---`;
}

// ============================================================== AiService

class AiService {
  constructor() {
    this.history = [];           // { role, content } — current session
    this.MAX_TURNS = 12;
  }

  get apiKey()  { return localStorage.getItem(AI_CONFIG.apiKeyStorageKey) || ""; }
  set apiKey(k) {
    if (k) localStorage.setItem(AI_CONFIG.apiKeyStorageKey, k.trim());
    else   localStorage.removeItem(AI_CONFIG.apiKeyStorageKey);
  }
  get isLive() { return !!this.apiKey; }

  resetHistory() { this.history = []; }

  /**
   * Ask the commissioning assistant.
   * @param {string} userMessage
   * @param {object} ctx { project, documents, retrieval: Array<{chunk,score}> }
   * @returns {Promise<{text: string, mode: "live"|"mock", sources: Array}>}
   */
  async ask(userMessage, ctx) {
    const sources = (ctx.retrieval || []).map(r => ({
      fileName: r.chunk.fileName, page: r.chunk.page,
      heading: r.chunk.heading, category: r.chunk.category,
    }));

    if (!this.isLive) {
      return { text: this._mockAnswer(userMessage, ctx), mode: "mock", sources };
    }

    const systemPrompt = buildSystemPrompt(ctx.project, ctx.documents);
    const contextBlock = buildRetrievalContext(ctx.retrieval || []);

    this.history.push({ role: "user", content: userMessage + contextBlock });
    if (this.history.length > this.MAX_TURNS * 2) {
      this.history = this.history.slice(-this.MAX_TURNS * 2);
    }

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: AI_CONFIG.model,
          max_tokens: AI_CONFIG.maxTokens,
          system: systemPrompt,
          messages: this.history,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${resp.status}`);
      }
      const data = await resp.json();
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      this.history.push({ role: "assistant", content: text });
      return { text, mode: "live", sources };
    } catch (err) {
      // Drop the failed turn so retry is clean
      this.history.pop();
      return {
        text: `**AI request failed:** ${err.message}\n\nCheck your API key in Settings, or continue in Mock mode (clear the key). Document upload, retrieval, and templates work without AI.`,
        mode: "live", sources,
      };
    }
  }

  /**
   * Mock answer generator — structured, deterministic, demonstrates the
   * answer format using actual retrieved chunks. Clearly labelled.
   */
  _mockAnswer(userMessage, ctx) {
    const r = ctx.retrieval || [];
    const evidence = r.length
      ? r.slice(0, 3).map(x =>
          `- **${x.chunk.fileName}**${x.chunk.page ? ` (p.${x.chunk.page})` : ""}${x.chunk.heading ? ` — ${x.chunk.heading}` : ""}: "${x.chunk.text.slice(0, 160).replace(/\s+/g, " ")}…"`
        ).join("\n")
      : "- No uploaded documents matched this question.";

    const missingDocs = this._missingDocs(ctx);

    return `**[MOCK MODE — no API key configured. Add your Anthropic API key in Settings for live AI analysis. Retrieval below is real.]**

**1. Direct answer**
This is a placeholder response demonstrating the structured answer format. With a live API key, the assistant analyzes the retrieved excerpts below and answers: "${userMessage.slice(0, 120)}"

**2. Evidence from uploaded files**
${evidence}

**3. Recommended checks**
- Review the retrieved excerpts above — retrieval ranking is live even in mock mode.
- Verify document coverage for this question's topic.

**5. Safety warnings**
${window.CxDomain.SAFETY_DISCLAIMER}

**6. Missing information**
${missingDocs}

**7. Suggested next action**
Configure the API key (Settings → API Key) to enable live commissioning analysis.`;
  }

  _missingDocs(ctx) {
    const D = window.CxDomain;
    const required = D.COMMISSIONING_KNOWLEDGE.required_docs_by_site[ctx.project.siteType] || [];
    const have = new Set((ctx.documents || []).map(d => d.category));
    const missing = required.filter(c => !have.has(c));
    return missing.length
      ? "Recommended documents not yet uploaded for this site type: " + missing.map(D.categoryLabel).join(", ") + "."
      : "All recommended document categories for this site type are present.";
  }
}

// ============================================================== V2 connector stubs
/**
 * V2 ARCHITECTURE — live data connectors.
 *
 * Each connector implements the same interface:
 *   connect(config): Promise<void>
 *   read(pointIds):  Promise<DataPoint[]>
 *   subscribe(cb):   () => void          // returns unsubscribe
 *
 * DataPoint = { id, value, unit, quality, ts }
 *
 * V1 ships mock implementations only. Future flow:
 *   Live data → alarm/event context → AI diagnosis → report
 */
class BaseConnector {
  constructor(name) { this.name = name; this.connected = false; }
  async connect(_config) { this.connected = true; /* TODO V2: real transport */ }
  async read(pointIds = []) {
    // Mock sample data — replace with real protocol adapter in V2
    return pointIds.map(id => ({ id, value: 0, unit: "", quality: "MOCK", ts: new Date().toISOString() }));
  }
  subscribe(_cb) { /* TODO V2: polling/event subscription */ return () => {}; }
}
class PCSDataConnector      extends BaseConnector { constructor() { super("PCS"); } }
class BMSDataConnector      extends BaseConnector { constructor() { super("BMS"); } }
class EMSDataConnector      extends BaseConnector { constructor() { super("EMS"); } }
class ModbusConnector       extends BaseConnector { constructor() { super("Modbus"); } }
class AlarmLogConnector     extends BaseConnector { constructor() { super("AlarmLog"); } }
class SiteTelemetryConnector extends BaseConnector { constructor() { super("Telemetry"); } }

// ============================================================== V3 workflow stubs
/**
 * V3 ARCHITECTURE — automatic report workflows.
 * Service stubs only; no scheduling in V1.
 * Future: dailyCommissioningReport(), punchList(), handoffPackage(),
 * omTransitionPackage() — each composes RetrievalService + AiService +
 * connector data into a generated document on a schedule or trigger.
 */
class ReportWorkflowService {
  // TODO V3: auto-generate daily commissioning report
  async dailyCommissioningReport() { throw new Error("Not implemented — V3"); }
  // TODO V3: auto-generate punch list from open issues
  async punchList() { throw new Error("Not implemented — V3"); }
  // TODO V3: auto-generate customer handoff package
  async handoffPackage() { throw new Error("Not implemented — V3"); }
  // TODO V3: auto-generate O&M transition package
  async omTransitionPackage() { throw new Error("Not implemented — V3"); }
}

window.CxAi = {
  AiService, AI_CONFIG, buildSystemPrompt, buildRetrievalContext,
  connectors: { PCSDataConnector, BMSDataConnector, EMSDataConnector, ModbusConnector, AlarmLogConnector, SiteTelemetryConnector },
  ReportWorkflowService,
};
