/**
 * parsers.js
 * EnergizeOS Commissioning Copilot V1
 *
 * DocumentParser layer — adapter pattern.
 *
 * Each parser adapter implements:
 *   canParse(file): boolean
 *   parse(file): Promise<ParsedDocument>
 *
 * ParsedDocument = {
 *   text: string,            // full extracted text
 *   pages: [{ page, text }], // page-level text where the format supports it
 *   meta: { parser, warnings: string[] }
 * }
 *
 * External libraries (CDN, loaded lazily on first use):
 *   - pdf.js  (Mozilla)  → PDF text extraction
 *   - mammoth            → DOCX → text
 *   - SheetJS (xlsx)     → XLSX/CSV → text tables
 *
 * Future adapters (clean extension points, not implemented in V1):
 *   - OcrImageParser     → site photos, scanned drawings
 *   - DrawingParser      → single-line diagram interpretation
 */

"use strict";

// ---------------------------------------------------------------- lazy CDN loader
const _loadedLibs = {};

/**
 * Load an external script once.
 * @param {string} url
 * @returns {Promise<void>}
 */
function loadScript(url) {
  if (_loadedLibs[url]) return _loadedLibs[url];
  _loadedLibs[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load " + url));
    document.head.appendChild(s);
  });
  return _loadedLibs[url];
}

const CDN = {
  pdfjs:        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfjsWorker:  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  mammoth:      "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
  xlsx:         "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
};

// ---------------------------------------------------------------- adapters

/** Plain text family: .txt .md .log */
const TextParser = {
  name: "TextParser",
  canParse: (file) => /\.(txt|md|markdown|log)$/i.test(file.name) || file.type.startsWith("text/plain"),
  async parse(file) {
    const text = await file.text();
    return { text, pages: [{ page: 1, text }], meta: { parser: this.name, warnings: [] } };
  },
};

/** JSON — pretty-printed so chunks remain readable */
const JsonParser = {
  name: "JsonParser",
  canParse: (file) => /\.json$/i.test(file.name) || file.type === "application/json",
  async parse(file) {
    const raw = await file.text();
    let text = raw;
    const warnings = [];
    try { text = JSON.stringify(JSON.parse(raw), null, 2); }
    catch { warnings.push("File has .json extension but is not valid JSON; treated as text."); }
    return { text, pages: [{ page: 1, text }], meta: { parser: this.name, warnings } };
  },
};

/** CSV — rendered as pipe-delimited rows for AI readability */
const CsvParser = {
  name: "CsvParser",
  canParse: (file) => /\.csv$/i.test(file.name) || file.type === "text/csv",
  async parse(file) {
    const raw = await file.text();
    // Simple CSV handling — quoted-field aware enough for typical alarm logs
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const text = lines.map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")).join(" | ")).join("\n");
    return { text, pages: [{ page: 1, text }], meta: { parser: this.name, warnings: [] } };
  },
};

/** PDF via pdf.js — page-level text */
const PdfParser = {
  name: "PdfParser",
  canParse: (file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf",
  async parse(file) {
    await loadScript(CDN.pdfjs);
    /* global pdfjsLib */
    pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    const warnings = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map(it => it.str).join(" ").replace(/\s{2,}/g, " ").trim();
      pages.push({ page: p, text });
      if (!text) warnings.push(`Page ${p} has no extractable text (likely scanned image — OCR not yet supported).`);
    }
    return {
      text: pages.map(p => p.text).join("\n\n"),
      pages,
      meta: { parser: this.name, warnings },
    };
  },
};

/** DOCX via mammoth */
const DocxParser = {
  name: "DocxParser",
  canParse: (file) => /\.docx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  async parse(file) {
    await loadScript(CDN.mammoth);
    /* global mammoth */
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    const warnings = result.messages?.map(m => m.message) || [];
    return { text: result.value, pages: [{ page: 1, text: result.value }], meta: { parser: this.name, warnings } };
  },
};

/** XLSX via SheetJS — each sheet rendered as a labelled table */
const XlsxParser = {
  name: "XlsxParser",
  canParse: (file) => /\.(xlsx|xls)$/i.test(file.name),
  async parse(file) {
    await loadScript(CDN.xlsx);
    /* global XLSX */
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const pages = [];
    wb.SheetNames.forEach((name, i) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      const text = `=== Sheet: ${name} ===\n` +
        csv.split("\n").filter(l => l.trim()).map(l => l.split(",").join(" | ")).join("\n");
      pages.push({ page: i + 1, text });
    });
    return {
      text: pages.map(p => p.text).join("\n\n"),
      pages,
      meta: { parser: this.name, warnings: [] },
    };
  },
};

/**
 * Image placeholder — V1 stores metadata only.
 * Future: OcrImageParser (Tesseract.js or vision-model OCR) plugs in here
 * without changing any calling code.
 */
const ImagePlaceholderParser = {
  name: "ImagePlaceholderParser",
  canParse: (file) => /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name) || file.type.startsWith("image/"),
  async parse(file) {
    const text = `[IMAGE FILE: ${file.name} — ${(file.size / 1024).toFixed(0)} KB. ` +
      `Visual content not yet extracted. OCR and drawing interpretation are planned for a future release. ` +
      `The engineer should describe relevant visual details in chat if needed.]`;
    return {
      text, pages: [{ page: 1, text }],
      meta: { parser: this.name, warnings: ["Image content not extracted — OCR pending."] },
    };
  },
};

/** Fallback — attempt text decode */
const FallbackParser = {
  name: "FallbackParser",
  canParse: () => true,
  async parse(file) {
    const warnings = [];
    let text = "";
    try {
      text = await file.text();
      // Heuristic: reject binary garbage
      const printable = (text.match(/[\x20-\x7E\n\r\t]/g) || []).length;
      if (text.length && printable / text.length < 0.7) {
        text = `[UNSUPPORTED BINARY FILE: ${file.name}. Content could not be extracted.]`;
        warnings.push("Binary or unsupported format — no text extracted.");
      }
    } catch (e) {
      text = `[UNREADABLE FILE: ${file.name}]`;
      warnings.push("File read failed: " + e.message);
    }
    return { text, pages: [{ page: 1, text }], meta: { parser: this.name, warnings } };
  },
};

// Adapter registry — order matters (first match wins; fallback last)
const PARSERS = [PdfParser, DocxParser, XlsxParser, CsvParser, JsonParser, TextParser, ImagePlaceholderParser, FallbackParser];

/**
 * DocumentParser facade.
 * @param {File} file
 * @returns {Promise<ParsedDocument>}
 */
async function parseDocument(file) {
  const adapter = PARSERS.find(p => p.canParse(file));
  try {
    return await adapter.parse(file);
  } catch (err) {
    return {
      text: `[PARSE ERROR: ${file.name} — ${err.message}]`,
      pages: [],
      meta: { parser: adapter.name, warnings: ["Parse failed: " + err.message] },
    };
  }
}

window.CxParsers = { parseDocument };
