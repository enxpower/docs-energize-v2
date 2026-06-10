/**
 * copilot-shared.js
 * EnergizeOS Microgrid EMS — Phase 2 Copilot
 *
 * Shared UI utilities used by all copilot-ph2 pages:
 *   - Header/nav burger menu
 *   - Toast notification system
 *   - AI Copilot panel initialization & message rendering
 *   - Markdown-lite renderer for AI responses
 *   - Event log renderer
 */

"use strict";

// ----------------------------------------------------------------- nav burger
function initBurger() {
  document.querySelector(".burger")?.addEventListener("click", () => {
    document.getElementById("mnav")?.classList.toggle("open");
  });
}

// ----------------------------------------------------------------- toasts
const toastContainer = (() => {
  const div = document.createElement("div");
  div.className = "toast-container";
  document.body.appendChild(div);
  return div;
})();

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {"info"|"warn"|"error"|"success"} type
 * @param {number} durationMs
 */
function showToast(msg, type = "info", durationMs = 4000) {
  const t = document.createElement("div");
  t.className = `toast${type !== "info" ? " " + type : ""}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// ----------------------------------------------------------------- markdown-lite renderer
/**
 * Convert AI response text (markdown-lite) to safe HTML.
 * Supports: **bold**, *italic*, `code`, bullet lists, numbered lists,
 * line breaks. No external markdown library needed.
 * @param {string} text
 * @returns {string} HTML
 */
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic: *text*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code: `code`
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Horizontal rule: ---
    .replace(/^---+$/gm, "<hr>")
    // Bullet list items: "- item" or "• item"
    .replace(/^[•\-] (.+)$/gm, "<li>$1</li>")
    // Numbered list items: "1. item"
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, match => `<ul>${match}</ul>`);

  // Paragraphs: double newline
  html = html
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.startsWith("<ul>") || p.startsWith("<hr>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return html;
}

// ----------------------------------------------------------------- Copilot panel
/**
 * Initialize the AI Copilot panel for a page.
 * @param {object} engine         - EmsEngine instance
 * @param {string[]} quickPrompts - list of quick-action prompt strings
 * @param {string} pageContext    - module name for history reset label
 */
function initCopilot(engine, quickPrompts = [], pageContext = "") {
  const { CopilotCore, SITE_CONFIG, INTERLOCK_DEFS } = window.EnergizeOS;

  const copilot = new CopilotCore(
    () => engine.getStateSnapshot(),
    window.EnergizeOS.logEvent,
    SITE_CONFIG,
    INTERLOCK_DEFS
  );

  const panel    = document.getElementById("copilot-panel");
  const header   = document.getElementById("copilot-header");
  const messages = document.getElementById("copilot-messages");
  const input    = document.getElementById("copilot-input");
  const sendBtn  = document.getElementById("copilot-send");
  const typing   = document.getElementById("copilot-typing");
  const quickWrap = document.getElementById("copilot-quick");

  if (!panel) return copilot;

  // Collapse/expand
  header?.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
  });

  // API key button (🔑) — injected into the panel header.
  // Key is stored only in this browser's localStorage and shared with
  // the Commissioning Copilot. Clicking with a key set offers removal.
  if (header) {
    const keyBtn = document.createElement("button");
    keyBtn.className = "copilot-toggle-btn";
    keyBtn.setAttribute("aria-label", "Configure API key");
    keyBtn.title = "Configure Anthropic API key (stored in this browser only)";
    keyBtn.textContent = "\u{1F511}"; // key emoji
    keyBtn.style.marginRight = "6px";
    keyBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // don't toggle the panel
      if (copilot.isLive) {
        if (confirm("An API key is configured (live AI mode). Remove it and switch to offline mode?")) {
          copilot.apiKey = "";
          appendMessage("assistant", "**API key removed.** Copilot is now in offline mode — state questions are answered directly from the live EMS snapshot.");
        }
      } else {
        const k = prompt("Enter your Anthropic API key.\n\nStored only in this browser (localStorage), sent only to api.anthropic.com over HTTPS. Leave empty to cancel.");
        if (k && k.trim()) {
          copilot.apiKey = k.trim();
          appendMessage("assistant", "**API key saved — live AI mode enabled.** Ask me anything about site operations.");
        }
      }
    });
    const toggleBtn = header.querySelector(".copilot-toggle-btn");
    header.insertBefore(keyBtn, toggleBtn);
  }

  // Render quick-action chips
  if (quickWrap && quickPrompts.length) {
    quickWrap.innerHTML = quickPrompts
      .map(q => `<button class="q-chip" data-q="${q.replace(/"/g,"&quot;")}">${q}</button>`)
      .join("");
    quickWrap.addEventListener("click", e => {
      const chip = e.target.closest(".q-chip");
      if (chip) sendMessage(chip.dataset.q);
    });
  }

  // Send on Enter (Shift+Enter = newline)
  input?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value.trim());
    }
  });
  sendBtn?.addEventListener("click", () => sendMessage(input.value.trim()));

  /**
   * Append a message bubble to the panel.
   * @param {"user"|"assistant"} role
   * @param {string} content - plain text for user, markdown for assistant
   */
  function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = `msg-bubble ${role}`;
    if (role === "assistant") {
      div.innerHTML = renderMarkdown(content);
    } else {
      div.textContent = content;
    }
    messages?.appendChild(div);
    messages && (messages.scrollTop = messages.scrollHeight);
  }

  async function sendMessage(text) {
    if (!text) return;
    if (input) input.value = "";
    appendMessage("user", text);

    // Show typing indicator
    if (typing) typing.style.display = "block";
    messages && (messages.scrollTop = messages.scrollHeight);
    if (sendBtn) sendBtn.disabled = true;

    const response = await copilot.ask(text);

    if (typing) typing.style.display = "none";
    if (sendBtn) sendBtn.disabled = false;
    appendMessage("assistant", response);

    // Open panel if collapsed
    panel?.classList.remove("collapsed");
  }

  // Greeting on first open — reflects live vs offline mode
  appendMessage("assistant",
    `**Site Copilot ready** — ${pageContext} module loaded.\n\n` +
    (copilot.isLive
      ? "AI mode: **LIVE**. I have live access to the EMS state, interlock chain, tariff data, and event log. Ask me anything about site operations, or use the quick prompts above."
      : "AI mode: **OFFLINE** — I answer state questions directly from the live EMS snapshot (interlocks, SOC, PCC flow, grid state). For full AI reasoning, click the \u{1F511} icon above and add your Anthropic API key (stored in this browser only).") +
    "\n\n_Advisory only — I do not control equipment._"
  );

  return copilot;
}

// ----------------------------------------------------------------- interlock renderer
/**
 * Render the C1–C7 interlock grid into a container element.
 * @param {string} containerId
 * @param {object} interlocks  - from state snapshot
 * @param {object} defs        - INTERLOCK_DEFS
 */
function renderInterlocks(containerId, interlocks, defs) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Object.entries(interlocks).map(([id, c]) => {
    const cls = c.value ? "il-true" : "il-false";
    const icon = c.value ? "✓" : "✗";
    const detail = c.raw_value ? `<div class="il-detail">${c.raw_value}</div>` : "";
    const block  = !c.value && c.blocking_reason
      ? `<div class="il-block">↳ ${c.blocking_reason}</div>`
      : "";
    return `<div class="interlock-row ${cls}">
      <span class="il-id">${id}</span>
      <span class="il-icon">${icon}</span>
      <div class="il-body">
        <div class="il-label">${defs[id].label}</div>
        ${detail}${block}
      </div>
    </div>`;
  }).join("");
}

// ----------------------------------------------------------------- event log renderer
/**
 * Render the event log into a container element.
 * @param {string} containerId
 * @param {Array}  events      - event_log array from SIM_STATE
 * @param {number} limit
 */
function renderEventLog(containerId, events, limit = 15) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = events.slice(0, limit).map(e => {
    const ts = new Date(e.ts).toLocaleTimeString("en-US", { hour12: false });
    return `<div class="event-row">
      <span class="ev-ts">${ts}</span>
      <span class="ev-sev ${e.severity}">${e.severity}</span>
      <span class="ev-cat">${e.category}</span>
      <span class="ev-msg">${e.message}</span>
    </div>`;
  }).join("") || '<div style="padding:8px;color:var(--muted);font-size:0.8rem;">No events yet.</div>';
}

// Attach to global namespace
if (typeof window !== "undefined") {
  window.EnergizeOS = window.EnergizeOS || {};
  Object.assign(window.EnergizeOS, {
    initBurger,
    showToast,
    renderMarkdown,
    initCopilot,
    renderInterlocks,
    renderEventLog,
  });
}
