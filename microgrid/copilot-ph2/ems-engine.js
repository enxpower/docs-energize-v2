/**
 * ems-engine.js
 * EnergizeOS Microgrid EMS — Phase 2 Copilot
 *
 * DETERMINISTIC EMS CONTROL ENGINE
 *
 * This module implements all safety-critical and control logic.
 * It is the ONLY layer allowed to transition EMS states or issue
 * simulated device commands.
 *
 * Architecture invariants (from docs.energizeos.com/microgrid/architecture.html):
 *   - The LLM/AI layer NEVER calls functions in this file directly.
 *   - The AI layer reads state snapshots (read-only) via getStateSnapshot().
 *   - All control actions flow: Operator UI → EmsEngine → SIM_STATE.
 *   - Every state change is written to the event log.
 *   - Safety gates are enforced before every close or dispatch command.
 *
 * Grid-Island-Grid State Machine:
 *
 *   GRID_CONNECTED
 *     ↓ grid loss detected (V or F out of range)
 *   GRID_LOSS_DETECTED  (transition: 52-U trips, BESS mode → GRID_FORMING)
 *     ↓
 *   ISLANDING           (BESS energizing island bus)
 *     ↓ grid restored (V and F back in range for ≥ restoration_stable_s)
 *   GRID_RESTORE_DETECTED
 *     ↓ BESS stops grid-forming, settles
 *   SYNC_CHECKING       (C1, C3, C5, C6 evaluated; C4+C7 required from operator)
 *     ↓ all C1–C7 satisfied + operator close authorization
 *   RECLOSE_AUTHORIZED
 *     ↓ DO2 pulse issued (simulated)
 *   GRID_CONNECTED      (full reconnection, C5+C6 cleared)
 *
 *   Any trip event in any state → TRIP_LOCKOUT
 *   TRIP_LOCKOUT → SYNC_CHECKING (only after operator clears lockout + admin approval)
 */

"use strict";

// ---------------------------------------------------------------------------
// STATE MACHINE CONSTANTS
// ---------------------------------------------------------------------------

const GRID_STATES = Object.freeze({
  GRID_CONNECTED:        "GRID_CONNECTED",
  GRID_LOSS_DETECTED:    "GRID_LOSS_DETECTED",
  ISLANDING:             "ISLANDING",
  GRID_RESTORE_DETECTED: "GRID_RESTORE_DETECTED",
  SYNC_CHECKING:         "SYNC_CHECKING",
  RECLOSE_AUTHORIZED:    "RECLOSE_AUTHORIZED",
  TRIP_LOCKOUT:          "TRIP_LOCKOUT",
});

const BESS_MODES = Object.freeze({
  STANDBY:      "STANDBY",
  CHARGE:       "CHARGE",
  DISCHARGE:    "DISCHARGE",
  GRID_FORMING: "GRID_FORMING",
  FAULT:        "FAULT",
  OFFLINE:      "OFFLINE",
});

// Grid restoration requires voltage and frequency to be stable for this duration
const GRID_RESTORE_STABLE_S = 5;

// Minimum BESS settling time after mode transition before C3 can evaluate TRUE
const BESS_SETTLE_S = 10;

// DO2 close pulse width (milliseconds). A latch is a wiring fault.
const DO2_PULSE_MS = 150;

// ---------------------------------------------------------------------------
// EMS ENGINE CLASS
// ---------------------------------------------------------------------------

class EmsEngine {
  /**
   * @param {object} simState   - Reference to SIM_STATE from site-model.js
   * @param {object} siteConfig - Reference to SITE_CONFIG from site-model.js
   * @param {object} interlockDefs - Reference to INTERLOCK_DEFS
   * @param {function} logEvent - Event logging function
   */
  constructor(simState, siteConfig, interlockDefs, logEvent) {
    this.state = simState;
    this.cfg = siteConfig;
    this.defs = interlockDefs;
    this.log = logEvent;

    // Internal timers (milliseconds since last state entry)
    this._gridRestoreTimer = 0;   // counts stable grid time during GRID_RESTORE_DETECTED
    this._bessSettleTimer = 0;    // counts BESS settle time after mode change
    this._lastTickMs = Date.now();

    // Fault injection flags (for simulation/demo controls)
    this._faults = {
      grid_loss: false,
      bess_fault: false,
      comm_loss_bess: false,
      comm_loss_relay: false,
      sync_angle_fail: false,
      spring_charge_fail: false,
    };

    this.log("SYSTEM", "INFO", "EMS Engine initialized", {
      site: siteConfig.voltage_class,
      bess_rated_kw: siteConfig.bess_rated_power_kw,
      tariff: siteConfig.tariff,
    });
  }

  // -------------------------------------------------------------------------
  // PUBLIC API — called by UI modules
  // -------------------------------------------------------------------------

  /**
   * Main tick — call from setInterval to advance simulation.
   * @param {number} speedMultiplier  - Simulation speed (1 = real-time)
   */
  tick(speedMultiplier = 1) {
    const now = Date.now();
    const dtMs = (now - this._lastTickMs) * speedMultiplier;
    this._lastTickMs = now;

    this._updateMeasurements(dtMs);
    this._evaluateInterlocks();
    this._runStateMachine(dtMs);
    this._enforceOperationalLimits();
    this._updateDemandTracking();
  }

  /**
   * Return a read-only deep-copy snapshot of the current EMS state.
   * This is the ONLY data the AI layer is allowed to consume.
   * @returns {object}
   */
  getStateSnapshot() {
    return JSON.parse(JSON.stringify({
      ts: new Date().toISOString(),
      grid_state: this.state.ems.grid_state,
      trip_lockout: this.state.ems.trip_lockout,
      close_permitted: this.state.close_permitted,
      active_mode: this.state.ems.active_mode,
      pcc: this.state.pcc,
      bess: this.state.bess,
      breaker: this.state.breaker,
      relay: this.state.relay,
      load: this.state.load,
      interlocks: this.state.interlocks,
      demand_peak_kw: this.state.demand_peak_kw,
      event_log_recent: this.state.event_log.slice(0, 20),
    }));
  }

  /**
   * Operator requests close authorization.
   * Validates operator role, checks that state machine is in SYNC_CHECKING,
   * sets C7 and C4 if conditions allow.
   * @param {string} operatorId
   * @param {string} role  - "admin" | "operator"
   * @returns {{ success: boolean, reason: string }}
   */
  requestCloseAuthorization(operatorId, role) {
    if (this.state.ems.grid_state !== GRID_STATES.SYNC_CHECKING) {
      return { success: false, reason: `Close authorization is only available in SYNC_CHECKING state. Current state: ${this.state.ems.grid_state}.` };
    }
    if (this.state.ems.trip_lockout) {
      return { success: false, reason: "Trip lockout is active. An admin must clear the lockout before authorization is possible." };
    }
    if (!["admin", "operator"].includes(role)) {
      return { success: false, reason: "Invalid role. Must be admin or operator." };
    }

    const expiry = new Date(Date.now() + this.defs.C7.authorization_window_s * 1000);
    this.state.ems.operator_id = operatorId;
    this.state.ems.operator_role = role;
    this.state.ems.close_authorized = true;
    this.state.ems.close_auth_expires = expiry;

    this.log("CONTROL", "INFO", `Close authorization granted to ${operatorId} (${role})`, {
      expires: expiry.toISOString(),
    });
    return { success: true, reason: `Authorization granted. Valid until ${expiry.toLocaleTimeString()}.` };
  }

  /**
   * Admin clears trip lockout after root-cause review.
   * @param {string} adminId
   * @returns {{ success: boolean, reason: string }}
   */
  clearTripLockout(adminId) {
    if (!this.state.ems.trip_lockout) {
      return { success: false, reason: "No active trip lockout." };
    }
    this.state.ems.trip_lockout = false;
    this._transitionGridState(GRID_STATES.SYNC_CHECKING, `Trip lockout cleared by admin ${adminId}`);
    this.log("CONTROL", "WARNING", `Trip lockout cleared by ${adminId}. All C1–C7 will be re-evaluated before close is permitted.`, {});
    return { success: true, reason: "Lockout cleared. System moved to SYNC_CHECKING. All interlocks will be re-evaluated." };
  }

  /**
   * Inject or clear a simulation fault for demo purposes.
   * @param {string} faultKey  - key from this._faults
   * @param {boolean} active
   */
  setFault(faultKey, active) {
    if (!(faultKey in this._faults)) return;
    this._faults[faultKey] = active;
    this.log("SYSTEM", active ? "WARNING" : "INFO",
      `Simulation fault ${active ? "INJECTED" : "CLEARED"}: ${faultKey}`, {});
  }

  /**
   * Manually set BESS dispatch target.
   * Positive = charge kW, negative = discharge kW.
   * Safety limits are enforced — command may be clamped.
   * @param {number} targetKw
   * @returns {{ success: boolean, applied_kw: number, reason: string }}
   */
  setBessDispatch(targetKw) {
    if (this.state.ems.grid_state === GRID_STATES.TRIP_LOCKOUT) {
      return { success: false, applied_kw: 0, reason: "BESS dispatch blocked: trip lockout active." };
    }
    if (this.state.bess.mode === BESS_MODES.GRID_FORMING) {
      return { success: false, applied_kw: 0, reason: "BESS dispatch blocked: BESS is in grid-forming mode." };
    }
    if (this.state.bess.fault_active) {
      return { success: false, applied_kw: 0, reason: "BESS dispatch blocked: active fault." };
    }

    // Enforce SOC limits
    const maxCharge = this.state.bess.available_charge_kw;
    const maxDischarge = -this.state.bess.available_discharge_kw;
    const clamped = clamp(targetKw, maxDischarge, maxCharge);

    // Enforce zero-export: if discharging would cause reverse flow, limit it
    const projectedExport = this.state.load.total_kw - Math.abs(clamped);
    const exportLimit = this.cfg.meter_deadband_kw * -1; // e.g. -2 kW
    if (projectedExport < exportLimit) {
      // Reduce discharge to avoid exceeding export limit
      const maxSafeDischarge = this.state.load.total_kw + exportLimit;
      const safeKw = clamp(targetKw, -maxSafeDischarge, maxCharge);
      this.log("CONTROL", "WARNING", `Dispatch clamped to prevent reverse flow. Requested: ${targetKw.toFixed(0)} kW → Applied: ${safeKw.toFixed(0)} kW`, {});
      this.state.bess.active_power_kw = safeKw;
      this._updatePCC();
      return { success: true, applied_kw: safeKw, reason: `Clamped from ${targetKw.toFixed(0)} kW to ${safeKw.toFixed(0)} kW to prevent reverse power.` };
    }

    this.state.bess.active_power_kw = clamped;
    if (clamped > 0) this.state.bess.mode = BESS_MODES.CHARGE;
    else if (clamped < 0) this.state.bess.mode = BESS_MODES.DISCHARGE;
    else this.state.bess.mode = BESS_MODES.STANDBY;

    this._updatePCC();
    this.log("CONTROL", "INFO", `BESS dispatch set to ${fmtKW(clamped)}`, { mode: this.state.bess.mode });
    return { success: true, applied_kw: clamped, reason: "Command applied." };
  }

  // -------------------------------------------------------------------------
  // PRIVATE — MEASUREMENT SIMULATION
  // -------------------------------------------------------------------------

  _updateMeasurements(dtMs) {
    const s = this.state;

    // Age all data
    s.pcc.data_age_ms += dtMs;
    s.bess.data_age_ms += dtMs;
    s.breaker.data_age_ms += dtMs;
    s.relay.data_age_ms += dtMs;

    // Simulate poll cycle — refresh every poll_interval_ms
    const poll = this.cfg.ems_poll_interval_ms;
    if (s.pcc.data_age_ms >= poll) {
      s.pcc.data_age_ms = 0;
      this._pollPCC();
    }
    if (s.bess.data_age_ms >= poll && !this._faults.comm_loss_bess) {
      s.bess.data_age_ms = 0;
      this._pollBESS();
    }

    // Apply comm-loss fault
    if (this._faults.comm_loss_bess) {
      s.bess.quality = s.bess.data_age_ms > this.cfg.comm_loss_timeout_ms ? "COMM_LOSS" : "STALE";
      s.bess.comm_healthy = false;
    }
    if (this._faults.comm_loss_relay) {
      s.relay.quality = "COMM_LOSS";
      s.relay.healthy = false;
    }

    // Apply grid-loss fault
    if (this._faults.grid_loss) {
      s.pcc.voltage_pu = 0.0;
      s.pcc.frequency_hz = 0.0;
    } else if (s.ems.grid_state === GRID_STATES.GRID_CONNECTED || s.ems.grid_state === GRID_STATES.GRID_RESTORE_DETECTED) {
      // Small wander
      s.pcc.voltage_pu = 1.003 + (Math.random() - 0.5) * 0.005;
      s.pcc.frequency_hz = 60.00 + (Math.random() - 0.5) * 0.04;
    }

    // Apply BESS fault
    if (this._faults.bess_fault) {
      s.bess.fault_active = true;
      s.bess.mode = BESS_MODES.FAULT;
    }
  }

  _pollPCC() {
    this._updatePCC();
    this.state.pcc.quality = "GOOD";
  }

  /**
   * Recalculate PCC active power from load and BESS:
   *   PCC_import = load - BESS_discharge
   *   (positive = importing; negative = exporting → violation)
   */
  _updatePCC() {
    const s = this.state;
    // BESS: positive kw = charging (consuming from bus), negative = discharging (producing to bus)
    s.pcc.active_power_kw = s.load.total_kw + s.bess.active_power_kw;
    s.pcc.quality = "GOOD";
  }

  _pollBESS() {
    const s = this.state.bess;
    // Update SOC based on active power (kW * dt_h = kWh)
    const dtH = this.cfg.ems_poll_interval_ms / 3600000;
    const energyKWh = s.active_power_kw * dtH; // positive = charging
    const capacityKWh = this.cfg.bess_rated_energy_kwh;
    s.soc_pct = clamp(s.soc_pct + (energyKWh / capacityKWh) * 100, 0, 100);

    // Update available power based on SOC
    const socHeadroom = (s.soc_pct - this.cfg.bess_soc_min_pct) / 100;
    const socRoom = (this.cfg.bess_soc_max_pct - s.soc_pct) / 100;
    s.available_discharge_kw = clamp(this.cfg.bess_rated_power_kw * socHeadroom * 10, 0, this.cfg.bess_rated_power_kw);
    s.available_charge_kw = clamp(this.cfg.bess_rated_power_kw * socRoom * 10, 0, this.cfg.bess_rated_power_kw);
    s.quality = "GOOD";
    s.comm_healthy = true;
  }

  // -------------------------------------------------------------------------
  // PRIVATE — INTERLOCK EVALUATION
  // Evaluates C1–C7 every tick. Each condition is fail-safe:
  // STALE data → false. COMM_LOSS → false.
  // -------------------------------------------------------------------------

  _evaluateInterlocks() {
    const s = this.state;
    const il = s.interlocks;

    // C1 — Grid V & F within limits
    this._setInterlock("C1",
      s.pcc.quality === "GOOD" &&
      s.pcc.voltage_pu >= this.defs.C1.voltage_min_pu &&
      s.pcc.voltage_pu <= this.defs.C1.voltage_max_pu &&
      s.pcc.frequency_hz >= this.defs.C1.freq_min_hz &&
      s.pcc.frequency_hz <= this.defs.C1.freq_max_hz,
      s.pcc.quality !== "GOOD"
        ? `PCC data quality: ${s.pcc.quality}`
        : s.pcc.voltage_pu < this.defs.C1.voltage_min_pu
          ? `Undervoltage: ${(s.pcc.voltage_pu * 100).toFixed(1)}% (min ${this.defs.C1.voltage_min_pu * 100}%)`
          : s.pcc.voltage_pu > this.defs.C1.voltage_max_pu
            ? `Overvoltage: ${(s.pcc.voltage_pu * 100).toFixed(1)}%`
            : s.pcc.frequency_hz < this.defs.C1.freq_min_hz
              ? `Underfrequency: ${s.pcc.frequency_hz.toFixed(2)} Hz`
              : s.pcc.frequency_hz > this.defs.C1.freq_max_hz
                ? `Overfrequency: ${s.pcc.frequency_hz.toFixed(2)} Hz`
                : null,
      `V=${(s.pcc.voltage_pu * 480).toFixed(0)}V (${(s.pcc.voltage_pu * 100).toFixed(1)}%), F=${s.pcc.frequency_hz.toFixed(2)}Hz`
    );

    // C2 — Zero export / no reverse power
    const reverseFlowTripped = s.pcc.active_power_kw < this.defs.C2.export_limit_kw;
    this._setInterlock("C2",
      s.pcc.quality === "GOOD" && !reverseFlowTripped,
      s.pcc.quality !== "GOOD"
        ? `PCC meter quality: ${s.pcc.quality}`
        : reverseFlowTripped
          ? `Reverse flow detected: ${fmtKW(s.pcc.active_power_kw)} (limit: ${fmtKW(this.defs.C2.export_limit_kw)})`
          : null,
      `PCC flow: ${fmtKW(s.pcc.active_power_kw)} (${s.pcc.active_power_kw >= 0 ? "IMPORT" : "EXPORT"})`
    );

    // C3 — BESS stopped/standby/charge-only
    const bessComm = s.bess.quality !== "COMM_LOSS" && s.bess.quality !== "STALE";
    const bessReady = bessComm &&
      s.bess.ready &&
      !s.bess.fault_active &&
      !s.bess.fire_alarm &&
      s.bess.safety_chain_healthy &&
      !s.bess.grid_forming_active &&
      s.bess.transition_complete &&
      s.bess.comm_healthy;
    this._setInterlock("C3",
      bessReady,
      !bessComm
        ? `BESS communication: ${s.bess.quality}`
        : s.bess.fault_active
          ? "BESS fault active"
          : s.bess.fire_alarm
            ? "BESS fire alarm active — CRITICAL"
            : !s.bess.safety_chain_healthy
              ? "BESS safety chain unhealthy"
              : s.bess.grid_forming_active
                ? "BESS is in grid-forming mode — must complete transition and settle"
                : !s.bess.transition_complete
                  ? `BESS mode transition in progress (settling time: ${this.defs.C3.min_stable_time_s}s required)`
                  : null,
      `BESS mode: ${s.bess.mode}, SOC: ${fmtPct(s.bess.soc_pct)}`
    );

    // C4 — EMS close authorization
    const authValid = s.ems.close_authorized && s.ems.close_auth_expires && new Date() < s.ems.close_auth_expires;
    if (s.ems.close_authorized && s.ems.close_auth_expires && new Date() >= s.ems.close_auth_expires) {
      // Expired — revoke
      s.ems.close_authorized = false;
      s.ems.close_auth_expires = null;
      this.log("CONTROL", "WARNING", "Close authorization expired.", {});
    }
    this._setInterlock("C4",
      authValid,
      authValid ? null : "No active EMS close authorization. Operator must request authorization.",
      authValid ? `Authorized by ${s.ems.operator_id} (${s.ems.operator_role}), expires ${s.ems.close_auth_expires?.toLocaleTimeString()}` : "—"
    );

    // C5 — Synchronism check (only meaningful when breaker is open)
    if (s.breaker.position !== "OPEN") {
      this._setInterlock("C5", false, "Breaker is not open — sync check not applicable", "N/A");
    } else if (this._faults.sync_angle_fail) {
      this._setInterlock("C5", false, "Phase angle delta exceeds threshold (simulated fault)", `Δθ > ${this.defs.C5.phase_angle_max_deg}°`);
    } else {
      // In sync_checking state with breaker open — simulate gradual sync improvement
      const syncOk = s.ems.grid_state === GRID_STATES.SYNC_CHECKING && il.C1.value && il.C3.value;
      this._setInterlock("C5",
        syncOk,
        syncOk ? null : "Sync conditions not yet established — waiting for grid and BESS stability",
        syncOk ? `Δθ ≈ 2.1°, ΔF ≈ 0.01 Hz (within limits)` : "—"
      );
    }

    // C6 — Breaker open + spring charged
    const c6ok = s.breaker.position === "OPEN" &&
      s.breaker.cb_52b &&
      s.breaker.spring_charged &&
      !this._faults.spring_charge_fail &&
      s.breaker.quality === "GOOD";
    this._setInterlock("C6",
      c6ok,
      !c6ok
        ? s.breaker.position !== "OPEN"
          ? `Breaker is ${s.breaker.position} (52b not active)`
          : !s.breaker.spring_charged || this._faults.spring_charge_fail
            ? "Spring charge not ready — breaker cannot close"
            : s.breaker.quality !== "GOOD"
              ? `Breaker feedback quality: ${s.breaker.quality}`
              : "52b not active"
        : null,
      `52a=${s.breaker.cb_52a}, 52b=${s.breaker.cb_52b}, spring=${s.breaker.spring_charged}`
    );

    // C7 — Operator authorization
    this._setInterlock("C7",
      authValid,
      authValid ? null : "No active operator authorization. Use Close Authorization panel.",
      authValid ? `${s.ems.operator_id} (${s.ems.operator_role})` : "—"
    );

    // Derive close_permitted: ALL of C1–C7 must be true AND no trip lockout
    const allTrue = Object.values(s.interlocks).every(c => c.value);
    s.close_permitted = allTrue && !s.ems.trip_lockout &&
      (s.ems.grid_state === GRID_STATES.SYNC_CHECKING || s.ems.grid_state === GRID_STATES.RECLOSE_AUTHORIZED);
  }

  /**
   * Helper to update a single interlock entry.
   * Fires a log entry on state change.
   */
  _setInterlock(id, value, blockingReason, rawValue) {
    const il = this.state.interlocks[id];
    const prev = il.value;
    il.value = value;
    il.blocking_reason = value ? null : blockingReason;
    il.raw_value = rawValue;
    il.data_age_ms = 0;

    if (prev !== value) {
      this.log("INTERLOCK", value ? "INFO" : "WARNING",
        `${id} (${this.defs[id].label}): ${prev} → ${value}`,
        { blocking_reason: blockingReason, raw: rawValue }
      );
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — GRID-ISLAND-GRID STATE MACHINE
  // -------------------------------------------------------------------------

  _runStateMachine(dtMs) {
    const s = this.state;
    const prev = s.ems.grid_state;

    switch (s.ems.grid_state) {

      case GRID_STATES.GRID_CONNECTED:
        this._handleGridConnected(dtMs);
        break;

      case GRID_STATES.GRID_LOSS_DETECTED:
        // Transition immediately: trip 52-U, switch BESS to GRID_FORMING
        this._executeGridLossResponse();
        this._transitionGridState(GRID_STATES.ISLANDING, "Grid loss response complete — BESS now energizing island");
        break;

      case GRID_STATES.ISLANDING:
        this._handleIslanding(dtMs);
        break;

      case GRID_STATES.GRID_RESTORE_DETECTED:
        this._handleGridRestoreDetected(dtMs);
        break;

      case GRID_STATES.SYNC_CHECKING:
        this._handleSyncChecking();
        break;

      case GRID_STATES.RECLOSE_AUTHORIZED:
        this._executeReclose();
        break;

      case GRID_STATES.TRIP_LOCKOUT:
        // Frozen — operator must clear via clearTripLockout()
        break;
    }
  }

  _handleGridConnected() {
    const s = this.state;
    // Detect grid loss
    if (this._faults.grid_loss || !s.interlocks.C1.value) {
      if (!this._faults.grid_loss) return; // C1 might transiently fail — require actual fault injection
      this._transitionGridState(GRID_STATES.GRID_LOSS_DETECTED, "Grid voltage/frequency out of range — grid loss confirmed");
    }
  }

  _executeGridLossResponse() {
    const s = this.state;
    // Open 52-U (simulate)
    s.breaker.position = "OPEN";
    s.breaker.cb_52a = false;
    s.breaker.cb_52b = true;

    // Switch BESS to grid-forming
    s.bess.mode = BESS_MODES.GRID_FORMING;
    s.bess.grid_forming_active = true;
    s.bess.transition_complete = false;

    // Activate trip lockout — will be cleared by grid-restore path (not by fault trip path)
    s.ems.trip_lockout = true;
    this.log("CONTROL", "CRITICAL", "52-U OPENED (simulated). BESS transitioning to GRID_FORMING mode.", {});
  }

  _handleIslanding(dtMs) {
    const s = this.state;

    // Advance BESS transition timer
    if (!s.bess.transition_complete) {
      this._bessSettleTimer += dtMs;
      if (this._bessSettleTimer >= BESS_SETTLE_S * 1000) {
        s.bess.transition_complete = true;
        s.bess.grid_forming_active = true; // still forming — in island
        this._bessSettleTimer = 0;
        this.log("CONTROL", "INFO", "BESS grid-forming transition complete. Island bus energized.", {});
      }
    }

    // Detect grid restoration
    if (!this._faults.grid_loss && s.pcc.voltage_pu >= this.defs.C1.voltage_min_pu && s.pcc.frequency_hz >= this.defs.C1.freq_min_hz) {
      this._gridRestoreTimer += dtMs;
      if (this._gridRestoreTimer >= GRID_RESTORE_STABLE_S * 1000) {
        this._gridRestoreTimer = 0;
        this._transitionGridState(GRID_STATES.GRID_RESTORE_DETECTED, "Grid stable for required duration — beginning restore sequence");
      }
    } else {
      this._gridRestoreTimer = 0;
    }
  }

  _handleGridRestoreDetected(dtMs) {
    const s = this.state;

    // Stop BESS grid-forming — it must settle before C3 can be true
    if (s.bess.grid_forming_active) {
      s.bess.grid_forming_active = false;
      s.bess.mode = BESS_MODES.STANDBY;
      s.bess.transition_complete = false;
      s.bess.active_power_kw = 0;
      this._bessSettleTimer = 0;
      this.log("CONTROL", "INFO", "BESS grid-forming stopped. Waiting for settle time before C3 can clear.", {});
    }

    // Wait for BESS settle
    if (!s.bess.transition_complete) {
      this._bessSettleTimer += dtMs;
      if (this._bessSettleTimer >= BESS_SETTLE_S * 1000) {
        s.bess.transition_complete = true;
        this._bessSettleTimer = 0;
        this.log("CONTROL", "INFO", `BESS settle complete (${BESS_SETTLE_S}s). C3 now eligible.`, {});
      }
    } else {
      // Clear trip_lockout for the restore path (not for protection trip path)
      s.ems.trip_lockout = false;
      this._transitionGridState(GRID_STATES.SYNC_CHECKING, "BESS settled. EMS entering SYNC_CHECKING — awaiting C1–C7.");
    }
  }

  _handleSyncChecking() {
    const s = this.state;
    // Transition to RECLOSE_AUTHORIZED only when close_permitted is true
    if (s.close_permitted) {
      this._transitionGridState(GRID_STATES.RECLOSE_AUTHORIZED, "All C1–C7 satisfied. Operator authorization confirmed. Initiating DO2 close pulse.");
    }
  }

  _executeReclose() {
    const s = this.state;
    // Issue DO2 pulse (simulated — pulse, never latch)
    this.log("CONTROL", "INFO", `DO2 close pulse issued (${DO2_PULSE_MS}ms). Waiting for 52a confirmation.`, {});

    // Simulate breaker closing after DO2 pulse
    setTimeout(() => {
      s.breaker.position = "CLOSED";
      s.breaker.cb_52a = true;
      s.breaker.cb_52b = false;
      // Clear authorization
      s.ems.close_authorized = false;
      s.ems.close_auth_expires = null;
      s.ems.close_authorized = false;
      // Transition BESS back to normal
      s.bess.mode = BESS_MODES.STANDBY;
      s.bess.grid_forming_active = false;
      this._transitionGridState(GRID_STATES.GRID_CONNECTED, "52-U CLOSED confirmed via 52a. Grid-connected restored.");
      this.log("CONTROL", "INFO", "Reclose successful. Site is GRID_CONNECTED.", {});
    }, DO2_PULSE_MS + 100);
  }

  _transitionGridState(newState, reason) {
    const old = this.state.ems.grid_state;
    if (old === newState) return;
    this.state.ems.grid_state = newState;
    this.log("SYSTEM", "INFO", `Grid state: ${old} → ${newState}`, { reason });
  }

  // -------------------------------------------------------------------------
  // PRIVATE — OPERATIONAL LIMIT ENFORCEMENT
  // Called every tick — enforces export limit and SOC boundaries
  // -------------------------------------------------------------------------

  _enforceOperationalLimits() {
    const s = this.state;

    // Enforce zero-export every tick regardless of dispatch command
    if (s.pcc.active_power_kw < this.defs.C2.export_limit_kw && s.bess.mode === BESS_MODES.DISCHARGE) {
      // Reduce BESS discharge to eliminate reverse flow
      const maxSafeDisch = s.load.total_kw - Math.abs(this.defs.C2.export_limit_kw);
      s.bess.active_power_kw = clamp(s.bess.active_power_kw, -Math.max(0, maxSafeDisch), s.bess.available_charge_kw);
      this._updatePCC();
      this.log("CONTROL", "WARNING", "Zero-export limit enforced — BESS discharge clamped to prevent reverse power.", {
        load_kw: s.load.total_kw,
        clamped_to: fmtKW(s.bess.active_power_kw),
      });
    }

    // Enforce SOC min/max
    if (s.bess.soc_pct <= this.cfg.bess_soc_min_pct && s.bess.mode === BESS_MODES.DISCHARGE) {
      s.bess.active_power_kw = 0;
      s.bess.mode = BESS_MODES.STANDBY;
      this._updatePCC();
      this.log("CONTROL", "WARNING", `SOC minimum reached (${fmtPct(s.bess.soc_pct)}). BESS discharge halted.`, {});
    }
    if (s.bess.soc_pct >= this.cfg.bess_soc_max_pct && s.bess.mode === BESS_MODES.CHARGE) {
      s.bess.active_power_kw = 0;
      s.bess.mode = BESS_MODES.STANDBY;
      this._updatePCC();
      this.log("CONTROL", "INFO", `SOC maximum reached (${fmtPct(s.bess.soc_pct)}). BESS charging halted.`, {});
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — DEMAND TRACKING (15-min interval peak)
  // -------------------------------------------------------------------------

  _updateDemandTracking() {
    const s = this.state;
    const netLoad = s.load.total_kw + s.bess.active_power_kw; // net demand from utility

    // Rolling window: maintain last 4 readings (~15-min demand interval at 1-min resolution)
    if (s.demand_window_kw.length >= 4) s.demand_window_kw.shift();
    s.demand_window_kw.push(Math.max(0, netLoad));

    const avg = s.demand_window_kw.reduce((a, b) => a + b, 0) / s.demand_window_kw.length;
    if (avg > s.demand_peak_kw) {
      s.demand_peak_kw = avg;
    }
  }
}

// Attach to global namespace for use by page scripts
if (typeof window !== "undefined") {
  window.EnergizeOS = window.EnergizeOS || {};
  window.EnergizeOS.EmsEngine = EmsEngine;
  window.EnergizeOS.GRID_STATES = GRID_STATES;
  window.EnergizeOS.BESS_MODES = BESS_MODES;
}
