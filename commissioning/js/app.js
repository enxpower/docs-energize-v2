/**
 * app.js
 * EnergizeOS Commissioning Copilot V1
 *
 * Workspace controller. Wires together:
 *   DocumentStore + Chunker + RetrievalService (store.js)
 *   DocumentParser (parsers.js)
 *   AiService (ai-service.js)
 *   ReportService (reports.js)
 *   Templates (templates.js)
 *
 * State flow:
 *   upload → parse → chunk → persist (IndexedDB) → retrieval-ready
 *   question → retrieve top chunks → AI (live or mock) → structured answer card
 *   report → retrieval sweep → AI → markdown preview → copy/download
 */

"use strict";

(async function () {
  const D = window.CxDomain;
  const { DocumentStore, RetrievalService, chunkDocument } = window.CxStore;
  const { parseDocument } = window.CxParsers;
  const { AiService } = window.CxAi;
  const { ReportService } = window.CxReports;
  const { TEMPLATES, REPORT_TYPES } = window.CxTemplates;

  // ---------------------------------------------------------------- services
  const store = await new DocumentStore().init();
  const retrieval = new RetrievalService(store);
  const ai = new AiService();
  const reports = new ReportService({ store, retrieval, ai });

  // ---------------------------------------------------------------- state
  let project = null;          // { id, name, siteType, createdAt }
  let documents = [];          // document metadata for current project
  let chatFindings = [];       // assistant answers this session (for reports)
  let pendingCategory = "other";

  // ---------------------------------------------------------------- el refs
  const $ = (id) => document.getElementById(id);
  const el = {
    projectName: $("project-name"),
    siteType: $("site-type"),
    projectStatus: $("project-status"),
    dropzone: $("dropzone"),
    fileInput: $("file-input"),
    categorySelect: $("upload-category"),
    fileList: $("file-list"),
    docCount: $("doc-count"),
    chatMessages: $("chat-messages"),
    chatInput: $("chat-input"),
    chatSend: $("chat-send"),
    chatTyping: $("chat-typing"),
    aiModeBadge: $("ai-mode-badge"),
    quickQuestions: $("quick-questions"),
    reportButtons: $("report-buttons"),
    reportPreview: $("report-preview"),
    reportActions: $("report-actions"),
    templateList: $("template-list"),
    templateView: $("template-view"),
    settingsModal: $("settings-modal"),
    apiKeyInput: $("api-key-input"),
    modelInput: $("model-input"),
  };

  // ================================================================ project

  function projectId(name, siteType) {
    return (name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "--" + siteType;
  }

  async function ensureProject() {
    const name = el.projectName.value.trim() || "Untitled Project";
    const siteType = el.siteType.value;
    const id = projectId(name, siteType);
    if (!project || project.id !== id) {
      project = (await store.getProject(id)) ||
        { id, name, siteType, createdAt: new Date().toISOString() };
      project.name = name;
      project.siteType = siteType;
      await store.saveProject(project);
      documents = await store.listDocuments(id);
      ai.resetHistory();
      chatFindings = [];
      renderFileList();
      updateProjectStatus();
    }
    return project;
  }

  function updateProjectStatus() {
    const required = D.COMMISSIONING_KNOWLEDGE.required_docs_by_site[project.siteType] || [];
    const have = new Set(documents.map(d => d.category));
    const missing = required.filter(c => !have.has(c));
    el.projectStatus.innerHTML = missing.length
      ? `<span class="pill warn">Docs: ${documents.length} uploaded · ${missing.length} recommended missing</span>
         <div class="status-detail">Missing: ${missing.map(D.categoryLabel).join(", ")}</div>`
      : documents.length
        ? `<span class="pill good">Docs: ${documents.length} uploaded · all recommended categories present</span>`
        : `<span class="pill neutral">No documents uploaded yet</span>`;
  }

  el.projectName.addEventListener("change", ensureProject);
  el.siteType.addEventListener("change", ensureProject);

  // ================================================================ upload

  // Populate category select
  el.categorySelect.innerHTML = D.FILE_CATEGORIES
    .map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  el.categorySelect.value = "other";
  el.categorySelect.addEventListener("change", () => pendingCategory = el.categorySelect.value);

  // Drag & drop + click
  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("dragover", e => { e.preventDefault(); el.dropzone.classList.add("drag"); });
  el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("drag"));
  el.dropzone.addEventListener("drop", e => {
    e.preventDefault(); el.dropzone.classList.remove("drag");
    handleFiles(e.dataTransfer.files);
  });
  el.fileInput.addEventListener("change", () => handleFiles(el.fileInput.files));

  async function handleFiles(fileList) {
    await ensureProject();
    for (const file of Array.from(fileList)) {
      await ingestFile(file, pendingCategory);
    }
    el.fileInput.value = "";
  }

  /**
   * Full ingestion pipeline for one file:
   * parse → chunk → persist document + chunks → refresh UI
   */
  async function ingestFile(file, category) {
    const docId = "doc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    const row = appendFileRow({ id: docId, fileName: file.name, category, status: "parsing" });

    try {
      const parsed = await parseDocument(file);
      const chunks = chunkDocument(parsed, {
        docId, projectId: project.id, fileName: file.name, category,
      });

      const docMeta = {
        id: docId, projectId: project.id,
        fileName: file.name, category,
        size: file.size,
        parser: parsed.meta.parser,
        warnings: parsed.meta.warnings,
        pageCount: parsed.pages.length || 1,
        chunkCount: chunks.length,
        uploadedAt: new Date().toISOString(),
      };

      await store.saveDocument(docMeta);
      await store.saveChunks(chunks);
      documents = await store.listDocuments(project.id);

      updateFileRow(row, docMeta, "ready");
      updateProjectStatus();
      toast(`${file.name}: ${chunks.length} chunks indexed`, "success");
    } catch (err) {
      updateFileRow(row, { fileName: file.name, category, warnings: [err.message] }, "error");
      toast(`${file.name}: ingestion failed — ${err.message}`, "error");
    }
  }

  function appendFileRow(meta) {
    const div = document.createElement("div");
    div.className = "file-row";
    div.dataset.docId = meta.id;
    div.innerHTML = fileRowHtml(meta, "parsing");
    el.fileList.prepend(div);
    return div;
  }

  function fileRowHtml(meta, status) {
    const statusPill = {
      parsing: '<span class="pill info">Parsing…</span>',
      ready:   '<span class="pill good">Indexed</span>',
      error:   '<span class="pill bad">Error</span>',
    }[status];
    const warn = meta.warnings?.length
      ? `<div class="file-warn">⚠ ${meta.warnings.join(" · ")}</div>` : "";
    const detail = status === "ready"
      ? `<span class="file-detail">${meta.pageCount} pg · ${meta.chunkCount} chunks · ${meta.parser}</span>` : "";
    return `
      <div class="file-row-main">
        <div class="file-name" title="${meta.fileName}">${meta.fileName}</div>
        <span class="pill neutral">${D.categoryLabel(meta.category)}</span>
        ${statusPill}
        ${status === "ready" ? `<button class="file-del" data-del="${meta.id}" title="Remove">×</button>` : ""}
      </div>
      ${detail}${warn}`;
  }

  function updateFileRow(row, meta, status) {
    row.innerHTML = fileRowHtml({ ...meta, id: row.dataset.docId }, status);
  }

  function renderFileList() {
    el.fileList.innerHTML = "";
    for (const d of documents) {
      const div = document.createElement("div");
      div.className = "file-row";
      div.dataset.docId = d.id;
      div.innerHTML = fileRowHtml(d, "ready");
      el.fileList.appendChild(div);
    }
  }

  el.fileList.addEventListener("click", async e => {
    const id = e.target.dataset?.del;
    if (!id) return;
    await store.deleteDocument(id);
    documents = await store.listDocuments(project.id);
    renderFileList();
    updateProjectStatus();
    toast("Document removed", "info");
  });

  // ================================================================ chat

  const QUICK_QUESTIONS = [
    "What commissioning steps are missing?",
    "Why can't this PCS connect to the grid?",
    "Extract all alarms from uploaded reports",
    "Summarize the SEL relay settings",
    "What documents are missing before site commissioning?",
    "What are the main risks in the uploaded documentation?",
  ];
  el.quickQuestions.innerHTML = QUICK_QUESTIONS
    .map(q => `<button class="q-chip" data-q="${q}">${q}</button>`).join("");
  el.quickQuestions.addEventListener("click", e => {
    const q = e.target.dataset?.q;
    if (q) sendChat(q);
  });

  el.chatSend.addEventListener("click", () => sendChat(el.chatInput.value.trim()));
  el.chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(el.chatInput.value.trim()); }
  });

  async function sendChat(text) {
    if (!text) return;
    await ensureProject();
    el.chatInput.value = "";
    appendMsg("user", text);
    el.chatTyping.style.display = "block";
    el.chatSend.disabled = true;

    try {
      const results = await retrieval.retrieve(text, project.id, { topK: 8 });
      const answer = await ai.ask(text, { project, documents, retrieval: results });

      el.chatTyping.style.display = "none";
      appendAnswerCard(answer);
      chatFindings.push(answer.text);
    } catch (err) {
      el.chatTyping.style.display = "none";
      appendMsg("assistant", "**Error:** " + err.message);
    }
    el.chatSend.disabled = false;
  }

  function appendMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML = role === "assistant" ? renderMd(text) : escapeHtml(text);
    el.chatMessages.appendChild(div);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendAnswerCard(answer) {
    const div = document.createElement("div");
    div.className = "msg assistant answer-card";
    const srcs = answer.sources?.length
      ? `<div class="answer-sources"><strong>Sources:</strong> ${
          [...new Set(answer.sources.map(s => s.fileName + (s.page ? ` p.${s.page}` : "")))].join(" · ")
        }</div>` : "";
    const modeBadge = answer.mode === "mock"
      ? '<span class="pill warn" style="float:right">MOCK</span>' : "";
    div.innerHTML = modeBadge + renderMd(answer.text) + srcs;
    el.chatMessages.appendChild(div);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  // ================================================================ reports

  el.reportButtons.innerHTML = REPORT_TYPES
    .map(t => `<button class="btn btn-ghost btn-sm" data-report="${t.id}" title="${t.desc}">${t.label}</button>`)
    .join("");

  el.reportButtons.addEventListener("click", async e => {
    const typeId = e.target.dataset?.report;
    if (!typeId) return;
    await ensureProject();
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Generating…";
    el.reportPreview.innerHTML = '<div class="empty-state">Generating report…</div>';

    try {
      const { markdown, mode } = await reports.generate(typeId, project, documents, chatFindings);
      el.reportPreview.innerHTML = renderMd(markdown);
      el.reportActions.style.display = "flex";
      el.reportActions.dataset.markdown = markdown;
      el.reportActions.dataset.typeLabel = REPORT_TYPES.find(t => t.id === typeId).label;
      if (mode === "mock") toast("Report generated in MOCK mode — add API key for full AI analysis", "warn");
      else toast("Report generated", "success");
    } catch (err) {
      el.reportPreview.innerHTML = `<div class="empty-state">Report failed: ${escapeHtml(err.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = REPORT_TYPES.find(t => t.id === typeId).label;
  });

  $("report-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(el.reportActions.dataset.markdown || "")
      .then(() => toast("Report copied to clipboard", "success"));
  });
  $("report-download").addEventListener("click", () => {
    reports.download(el.reportActions.dataset.markdown || "", project,
      el.reportActions.dataset.typeLabel || "report");
  });

  // ================================================================ templates

  el.templateList.innerHTML = TEMPLATES
    .map(t => `<button class="tpl-item" data-tpl="${t.id}">
      <span class="pill neutral" style="font-size:.62rem">${t.kind}</span> ${t.label}</button>`)
    .join("");

  el.templateList.addEventListener("click", e => {
    const id = e.target.closest("[data-tpl]")?.dataset.tpl;
    if (!id) return;
    const tpl = TEMPLATES.find(t => t.id === id);
    el.templateView.innerHTML = `<h3>${tpl.label}</h3>` + tpl.sections.map(s =>
      `<h4>${s.title}</h4><ul class="tpl-checklist">${
        s.items.map(i => `<li><label><input type="checkbox"> ${escapeHtml(i)}</label></li>`).join("")
      }</ul>`).join("") +
      `<button class="btn btn-ghost btn-sm" id="tpl-copy">Copy as Markdown</button>`;
    $("tpl-copy").addEventListener("click", () => {
      const md = `# ${tpl.label}\n\n` + tpl.sections.map(s =>
        `## ${s.title}\n` + s.items.map(i => `- [ ] ${i}`).join("\n")).join("\n\n");
      navigator.clipboard.writeText(md).then(() => toast("Template copied as markdown", "success"));
    });
  });

  // ================================================================ settings

  function updateAiBadge() {
    el.aiModeBadge.innerHTML = ai.isLive
      ? '<span class="pill good">AI: LIVE</span>'
      : '<span class="pill warn">AI: MOCK — set API key</span>';
  }

  $("settings-btn").addEventListener("click", () => {
    el.apiKeyInput.value = ai.apiKey;
    el.modelInput.value = window.CxAi.AI_CONFIG.model;
    el.settingsModal.style.display = "flex";
  });
  $("settings-close").addEventListener("click", () => el.settingsModal.style.display = "none");
  $("settings-save").addEventListener("click", () => {
    ai.apiKey = el.apiKeyInput.value.trim();
    const model = el.modelInput.value.trim();
    if (model) {
      window.CxAi.AI_CONFIG.model = model;
      localStorage.setItem("cx-model", model);
    }
    el.settingsModal.style.display = "none";
    updateAiBadge();
    toast(ai.isLive ? "API key saved (this browser only)" : "API key cleared — mock mode", "info");
  });
  el.settingsModal.addEventListener("click", e => {
    if (e.target === el.settingsModal) el.settingsModal.style.display = "none";
  });

  // ================================================================ utilities

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Markdown-lite renderer (bold, italic, code, headings, lists, tables, hr). */
  function renderMd(text) {
    if (!text) return "";
    let html = escapeHtml(text)
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^---+$/gm, "<hr>")
      .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^- \[ \] (.+)$/gm, '<li class="todo">☐ $1</li>')
      .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // tables
    html = html.replace(/((?:^\|.+\|\s*$\n?)+)/gm, block => {
      const rows = block.trim().split("\n").filter(r => !/^\|[\s\-|:]+\|$/.test(r));
      const cells = rows.map((r, i) => {
        const tag = i === 0 ? "th" : "td";
        const cols = r.split("|").slice(1, -1).map(c => `<${tag}>${c.trim()}</${tag}>`).join("");
        return `<tr>${cols}</tr>`;
      });
      return `<table>${cells.join("")}</table>`;
    });

    html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`);
    return html.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
      .map(p => /^<(h\d|ul|table|hr|blockquote)/.test(p) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  const toastWrap = document.createElement("div");
  toastWrap.className = "toast-container";
  document.body.appendChild(toastWrap);
  function toast(msg, type = "info") {
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.textContent = msg;
    toastWrap.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ================================================================ init

  await ensureProject();
  updateAiBadge();

  appendMsg("assistant",
    "**Commissioning Copilot ready.**\n\n" +
    "1. Name your project and select a site type\n" +
    "2. Upload commissioning documents (PDF, DOCX, XLSX, CSV, TXT, MD, JSON)\n" +
    "3. Ask questions — answers cite your documents\n" +
    "4. Generate reports from the panel on the right\n\n" +
    (ai.isLive ? "AI mode: **LIVE**." : "AI mode: **MOCK** — document parsing, indexing, and retrieval are fully functional. Add your Anthropic API key in Settings for live AI analysis.") +
    "\n\n> " + D.SAFETY_DISCLAIMER);
})();
