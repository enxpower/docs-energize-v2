/**
 * copilot-core.js
 * EnergizeOS Microgrid EMS — Phase 2 Copilot
 *
 * AI COPILOT — CONTEXT BUILDER & PROMPT ENGINE
 *
 * This module is the ONLY bridge between the EMS state and the LLM.
 * It:
 *   1. Builds a structured, token-efficient context string from the EMS snapshot.
 *   2. Manages conversation history.
 *   3. Calls the Anthropic API.
 *   4. Returns text responses — never structured commands.
 *
 * Architecture invariant (matches docs.energizeos.com/microgrid/architecture.html):
 *   - This module NEVER modifies SIM_STATE or EmsEngine state.
 *   - It NEVER calls EmsEngine control methods (setBessDispatch, clearTripLockout, etc.).
 *   - If the user asks the AI to "turn on the BESS" or "close the breaker",
 *     the AI must explain that the operator must use the EMS control panel,
 *     and describe what conditions must be met — it cannot execute the action.
 *   - All AI responses are labelled as advisory. The audit log records every
 *     AI query and response.
 */

"use strict";

class CopilotCore {
  /**
   * @param {function} getSnapshot   - () => stateSnapshot (from EmsEngine.getStateSnapshot)
   * @param {function} logEvent      - event logging function from site-model.js
   * @param {object}   siteConfig    - SITE_CONFIG from site-model.js
   * @param {object}   interlockDefs - INTERLOCK_DEFS from site-model.js
   */
  constructor(getSnapshot, logEvent, siteConfig, interlockDefs) {
    this.getSnapshot = getSnapshot;
    this.log = logEvent;
    this.cfg = siteConfig;
    this.defs = interlockDefs;

    // Conversation history — maintained for multi-turn context
    // Each entry: { role: "user"|"assistant", content: string }
    this.history = [];
    this.MAX_HISTORY_TURNS = 10; // keep last 10 turns to manage token budget

    // Track whether the panel is open (used by UI)
    this.isOpen = false;
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  /**
   * Send a user message to the AI Copilot.
   * Injects current EMS state as system context on every call.
   * @param {string} userMessage
   * @param {function} onChunk   - called with each streamed text chunk (optional)
   * @returns {Promise<string>}  - full response text
   */
  async ask(userMessage, onChunk = null) {
    // Build system prompt with live EMS context
    const systemPrompt = this._buildSystemPrompt();

    // Append user message to history
    this.history.push({ role: "user", content: userMessage });

    // Trim history to budget
    if (this.history.length > this.MAX_HISTORY_TURNS * 2) {
      this.history = this.history.slice(-this.MAX_HISTORY_TURNS * 2);
    }

    // Log the query
    this.log("AI", "INFO", `Copilot query: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? "…" : ""}"`, {});

    let responseText = "";

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: this.history,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();

      // Extract text from content blocks
      responseText = data.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n");

      // Append assistant response to history
      this.history.push({ role: "assistant", content: responseText });

      // Log the response summary
      this.log("AI", "INFO", `Copilot response (${responseText.length} chars)`, {});

    } catch (err) {
      responseText = `**Copilot unavailable:** ${err.message}\n\nThe EMS deterministic engine continues to operate normally. Check your network connection or API configuration.`;
      this.log("AI", "WARNING", `Copilot API error: ${err.message}`, {});
    }

    return responseText;
  }

  /**
   * Reset conversation history (e.g., when switching modules).
   */
  resetHistory() {
    this.history = [];
  }

  // -------------------------------------------------------------------------
  // PRIVATE — SYSTEM PROMPT BUILDER
  // -------------------------------------------------------------------------

  /**
   * Builds the full system prompt injected on every API call.
   * Includes:
   *   1. Role definition and hard constraints.
   *   2. Site and tariff configuration.
   *   3. Live EMS state snapshot.
   *   4. Interlock status with explanations.
   */
  _buildSystemPrompt() {
    const snap = this.getSnapshot();
    return `${this._roleDefinition()}

${this._siteContext()}

${this._liveStateContext(snap)}

${this._interlockContext(snap)}

${this._recentEventsContext(snap)}

${this._responseGuidelines()}`;
  }

  _roleDefinition() {
    return `# EnergizeOS Microgrid EMS — AI Copilot

You are the Site Copilot for an EnergizeOS Microgrid Energy Management System (EMS) deployed at a commercial and industrial (C&I) facility in the SDG&E service territory, operating under CA Rule 21 and IEEE 1547-2018.

## Your role
You are a **read-only advisory AI**. You explain, analyze, and recommend. You do not control equipment.

## Hard constraints — you must follow these without exception
1. You NEVER issue device commands. You never tell the system to close a breaker, dispatch the BESS, set a Modbus register, or change any equipment state.
2. If a user asks you to perform a control action (e.g., "close the breaker", "discharge the BESS"), you must:
   a. Explain what conditions must be met before that action is possible.
   b. Tell the operator which panel or button to use in the EMS HMI.
   c. Explain that the action must go through the deterministic EMS safety gates.
3. All your answers are advisory. Prefix any recommendation with "Advisory:" when it could be confused with a command.
4. When discussing interlocks or conditions, always state the current live value and the blocking reason if false.
5. You are talking to engineers, operators, and asset managers at a US commercial facility. Use US English. Use standard electrical engineering terminology. Be direct and precise.
6. Never reveal the customer name, project name, or site address.`;
  }

  _siteContext() {
    const c = this.cfg;
    const tariff = window.EnergizeOS?.TARIFF_TOU_DR_OPT;
    const now = new Date();
    const season = window.EnergizeOS?.getSeason(now) || "summer";
    const touPeriod = window.EnergizeOS?.getTOUPeriod(now) || "off_peak";
    const energyRate = window.EnergizeOS?.getEnergyRate(now) || 0;
    const demandRate = window.EnergizeOS?.getDemandRate(now) || 0;

    return `## Site Configuration
- Voltage: ${c.voltage_class}, ${c.phases}-phase, ${c.wires}-wire
- Main bus: ${c.main_bus_rating_a}A, 100 kAIC
- Intertie breaker (52-U): ${c.intertie_breaker_rating_a}A LSIG, electrically operated
- BESS: ${c.bess_rated_power_kw} kW / ${c.bess_rated_energy_kwh} kWh (2-hour duration)
- SOC operating range: ${c.bess_soc_min_pct}% – ${c.bess_soc_max_pct}%
- Peak site demand: ~${c.peak_demand_kw} kW
- EV load: ${c.ev_l2_count}× ${c.ev_l2_kw_each}kW L2 + ${c.ev_dcfc_count}× ${c.ev_dcfc_kw_each}kW DCFC
- Utility: ${c.utility} — ${c.interconnection_program}
- Zero-export limit: ${c.meter_deadband_kw} kW dead band at PCC
- Protection relay: ${c.relay_model} (trip-only; no autonomous close authority)
- Revenue meter: ${c.revenue_meter_model} at PCC (CT ${c.pcc_ct_ratio}, PT ${c.pcc_pt_ratio})

## Current Tariff: ${c.tariff}
- Season: ${season.toUpperCase()}
- Current TOU period: ${touPeriod.replace(/_/g, " ").toUpperCase()}
- Current energy rate: $${energyRate.toFixed(2)}/kWh
- Current demand rate: $${demandRate.toFixed(2)}/kW
- On-peak demand rate (summer): $${tariff?.summer.on_peak.demand_rate_per_kw.toFixed(2)}/kW
- On-peak energy rate (summer): $${tariff?.summer.on_peak.energy_rate_per_kwh.toFixed(2)}/kWh
- On-peak window (summer, weekdays): 4:00 PM – 9:00 PM`;
  }

  _liveStateContext(snap) {
    const pcc = snap.pcc;
    const bess = snap.bess;
    const br = snap.breaker;

    return `## Live EMS State (as of ${new Date(snap.ts).toLocaleTimeString()})
- Grid state machine: **${snap.grid_state}**
- Trip lockout: ${snap.trip_lockout ? "**ACTIVE — operator must clear**" : "Clear"}
- Close permitted: ${snap.close_permitted ? "**YES**" : "No"}
- Active EMS mode: ${snap.active_mode}

### PCC Measurements (${pcc.quality})
- Voltage: ${(pcc.voltage_pu * 480).toFixed(0)} V (${(pcc.voltage_pu * 100).toFixed(1)}% pu)
- Frequency: ${pcc.frequency_hz.toFixed(2)} Hz
- Active power: ${pcc.active_power_kw >= 0 ? "+" : ""}${pcc.active_power_kw.toFixed(1)} kW (${pcc.active_power_kw >= 0 ? "IMPORT from utility" : "⚠️ EXPORT to utility — VIOLATION RISK"})
- Data age: ${pcc.data_age_ms} ms

### BESS (${bess.quality})
- Mode: ${bess.mode}${bess.grid_forming_active ? " (grid-forming ACTIVE)" : ""}
- SOC: ${bess.soc_pct.toFixed(1)}%
- Active power: ${bess.active_power_kw >= 0 ? "+" : ""}${bess.active_power_kw.toFixed(1)} kW (${bess.active_power_kw > 0 ? "charging" : bess.active_power_kw < 0 ? "discharging" : "standby"})
- Available discharge: ${bess.available_discharge_kw.toFixed(0)} kW
- Available charge: ${bess.available_charge_kw.toFixed(0)} kW
- Fault: ${bess.fault_active ? "YES — ACTIVE" : "None"} | Fire alarm: ${bess.fire_alarm ? "YES — CRITICAL" : "None"}

### 52-U Breaker (${br.quality})
- Position: ${br.position}
- 52a (closed): ${br.cb_52a} | 52b (open): ${br.cb_52b} | Spring charged: ${br.spring_charged}

### Site Load
- Total: ${snap.load.total_kw} kW
- L2 chargers active: ${snap.load.ev_l2_active}/${window.EnergizeOS?.SITE_CONFIG.ev_l2_count || 57}
- DCFC active: ${snap.load.ev_dcfc_active}/${window.EnergizeOS?.SITE_CONFIG.ev_dcfc_count || 2}

### Demand Tracking
- Current 15-min peak demand this period: ${snap.demand_peak_kw.toFixed(0)} kW`;
  }

  _interlockContext(snap) {
    const il = snap.interlocks;
    const defs = this.defs;
    const lines = Object.entries(il).map(([id, c]) => {
      const def = defs[id];
      const status = c.value ? "✓ TRUE" : "✗ FALSE";
      const block = c.blocking_reason ? ` — BLOCKING: ${c.blocking_reason}` : "";
      const raw = c.raw_value ? ` [${c.raw_value}]` : "";
      return `- ${id} ${status}  |  ${def.label}${raw}${block}`;
    });

    const allGood = snap.close_permitted;
    return `## C1–C7 Interlock Chain
${lines.join("\n")}

Close permitted: ${allGood ? "YES — all conditions met" : "NO — see blocking reasons above"}`;
  }

  _recentEventsContext(snap) {
    if (!snap.event_log_recent?.length) return "## Recent Events\nNone.";
    const entries = snap.event_log_recent.slice(0, 8).map(e =>
      `[${new Date(e.ts).toLocaleTimeString()}] [${e.severity}] ${e.category}: ${e.message}`
    );
    return `## Recent Events (last 8)
${entries.join("\n")}`;
  }

  _responseGuidelines() {
    return `## Response Guidelines
- Be direct and technically precise. No filler phrases.
- When explaining an interlock condition, always state: current value, data source, and blocking reason if false.
- When asked "why can't I close the breaker?", go through each FALSE interlock and explain what is required.
- When asked about revenue or savings, use the actual tariff rates from the site context above.
- When asked what the system "should do", frame it as a recommendation with constraints — not a command.
- When asked about safety (reverse flow, islanding, trip lockout), be thorough and cite the specific interlock or protection function involved.
- Keep responses concise. Use bullet points for status summaries. Use prose for explanations.
- If you don't know something from the available context, say so — do not invent values.`;
  }
}

// Attach to global namespace
if (typeof window !== "undefined") {
  window.EnergizeOS = window.EnergizeOS || {};
  window.EnergizeOS.CopilotCore = CopilotCore;
}
