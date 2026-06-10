# EnergizeOS Commissioning Copilot V1

AI commissioning assistant for BESS, EMS, PCS, BMS, SEL relay, and microgrid
field commissioning workflows.

**Live:** https://docs.energizeos.com/commissioning/

## What it does

Upload commissioning documents → automatic text extraction and indexing →
ask technical questions with document-cited answers → generate structured
reports (summary, open issues, risk register, FAT/SAT checklists, handoff,
troubleshooting).

## Architecture (V1 — fully client-side)

```
index.html          workspace UI (3-column: project/upload | chat | reports)
app.css             Slate & Volt design system, mobile-responsive
js/
  domain.js         site types, file categories, commissioning knowledge
  parsers.js        DocumentParser adapters (PDF.js, mammoth, SheetJS, text)
  store.js          Chunker + DocumentStore (IndexedDB) + RetrievalService
  templates.js      10 built-in commissioning templates + 7 report types
  ai-service.js     AiService (Anthropic BYOK + mock mode), V2/V3 stubs
  reports.js        ReportService (per-type prompts, markdown export)
  app.js            workspace controller
```

Pipeline: `upload → parse → chunk(+metadata) → IndexedDB → keyword/IDF
retrieval → AI analysis with citations → report generation`.

## AI configuration (no keys in code — ever)

The app runs in **Mock mode** by default: parsing, indexing, retrieval, and
templates are fully functional; AI answers show the structured format with
real retrieved excerpts.

To enable **Live mode**: Settings → paste your Anthropic API key. The key is
stored only in the browser's localStorage and sent only to api.anthropic.com
over HTTPS using Anthropic's official CORS browser-access support. The model
is configurable in the same panel (single config point: `AI_CONFIG.model`).

A future hosted backend (key proxy + server-side store) can replace this
transparently — all AI calls go through one service layer (`AiService.ask`).

## Data storage

All projects, documents, and chunks persist in the browser's IndexedDB
(`energizeos-commissioning`). Nothing is uploaded to any server. The schema
is backend-shaped (projects / documents / chunks) so a future server-side
knowledge store can adopt it without remodeling.

## Run locally

Static files — no build step. Serve the repo root with any static server:

```
python3 -m http.server 8080
# open http://localhost:8080/commissioning/
```

(Opening index.html via file:// works for UI but CDN parser libraries and
IndexedDB behave better over http.)

## Deploy

Push to `main` — GitHub Pages serves the directory automatically at
docs.energizeos.com/commissioning/.

## Known limitations (V1)

- Image/scanned-PDF content is not extracted (OCR adapter is a planned
  parser plug-in; placeholder records metadata and warns the user).
- Retrieval is keyword+IDF with domain synonyms, not embeddings. The
  RetrievalService interface is stable so embeddings can swap in.
- Reports export as Markdown (copy/download); PDF export not in V1.
- Knowledge persists per-browser. Cross-team institutional memory requires
  the V2 hosted store.
- No scheduling/automation (V3 ReportWorkflowService stubs in place).

## Roadmap hooks already in the code

- **V2 live data:** `PCSDataConnector`, `BMSDataConnector`,
  `EMSDataConnector`, `ModbusConnector`, `AlarmLogConnector`,
  `SiteTelemetryConnector` (common connect/read/subscribe interface,
  mock data now). Flow: live data → alarm context → AI diagnosis → report.
- **V3 workflows:** `ReportWorkflowService` stubs — daily commissioning
  report, punch list, handoff package, O&M transition package.
