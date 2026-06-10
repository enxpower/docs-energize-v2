/**
 * site-model.js
 * EnergizeOS Microgrid EMS — Phase 2 Copilot
 *
 * Shared site data model and seed data for all Phase 2 modules.
 *
 * Parameters are derived from a real C&I BESS deployment at a 480Y/277V
 * commercial facility in the SDG&E service territory, operating under
 * CA Rule 21 / IEEE 1547-2018. All values reflect actual engineering
 * baselines. Site identity is intentionally omitted.
 *
 * Architecture note (matches docs.energizeos.com/microgrid/architecture.html):
 *   - This file is the DATA LAYER only.
 *   - The EMS deterministic engine (ems-engine.js) reads this model.
 *   - The AI Copilot (copilot-core.js) reads this model for context.
 *   - Neither the AI layer nor the data layer writes Modbus commands.
 */

"use strict";

// ---------------------------------------------------------------------------
// SITE CONFIGURATION
// Static nameplate parameters derived from engineering baseline.
// ---------------------------------------------------------------------------

const SITE_CONFIG = {
  // Electrical system
  voltage_class: "480Y/277V",
  voltage_nominal_v: 480,
  phases: 3,
  wires: 4,
  main_bus_rating_a: 4000,
  intertie_breaker_rating_a: 1600,   // 52-U, 1600AF/1600AT LSIG
  fault_current_kaic: 100,

  // BESS
  bess_rated_power_kw: 996,          // PCS rated active power output
  bess_rated_energy_kwh: 1992,       // ~2h duration
  bess_soc_min_pct: 10,
  bess_soc_max_pct: 95,
  bess_soc_initial_pct: 55,
  bess_ramp_rate_kw_per_s: 50,       // max ramp rate

  // Site loads
  ev_l2_count: 57,
  ev_l2_kw_each: 16.6,
  ev_dcfc_count: 2,
  ev_dcfc_kw_each: 120,
  facility_base_load_kw: 280,        // non-EV facility base load (HVAC, lighting, process)
  peak_demand_kw: 1580,              // historical peak

  // Utility metering (SEL-735 class revenue meter at PCC)
  pcc_ct_ratio: "1600:5",
  pcc_pt_ratio: "277:120",
  meter_deadband_kw: 2,              // Rule 21 zero-export dead band

  // Utility / interconnection
  utility: "SDG&E",
  interconnection_program: "CA Rule 21 / IEEE 1547-2018",
  tariff: "SDG&E TOU-DR-OPT",
  site_timezone: "America/Los_Angeles",

  // Protection relay (SEL-700G class)
  relay_model: "SEL-700G",
  revenue_meter_model: "SEL-735",

  // Communication
  ems_poll_interval_ms: 1000,        // Modbus TCP poll cycle
  stale_data_timeout_ms: 3000,       // data older than this → quality = STALE
  comm_loss_timeout_ms: 10000,       // no response this long → COMM_LOSS
};

// ---------------------------------------------------------------------------
// SDG&E TOU-DR-OPT TARIFF
// On-peak / off-peak / super-off-peak periods with energy and demand rates.
// Source: SDG&E Schedule TOU-DR-OPT (commercial C&I).
// All rates in USD. Demand charges in $/kW per billing period.
// ---------------------------------------------------------------------------

const TARIFF_TOU_DR_OPT = {
  name: "SDG&E TOU-DR-OPT",
  currency: "USD",

  // Summer (June 1 – October 31)
  summer: {
    on_peak: {
      hours: [[16, 21]],             // 4:00 PM – 9:00 PM
      days: [1, 2, 3, 4, 5],        // Mon–Fri
      energy_rate_per_kwh: 0.52,
      demand_rate_per_kw: 22.40,     // $/kW of peak 15-min interval demand
    },
    off_peak: {
      hours: [[9, 16], [21, 24], [0, 9]],
      days: [1, 2, 3, 4, 5],
      energy_rate_per_kwh: 0.28,
      demand_rate_per_kw: 0,
    },
    super_off_peak: {
      hours: [[0, 9]],
      days: [0, 6],                  // Sat–Sun all day treated as super-off-peak
      energy_rate_per_kwh: 0.19,
      demand_rate_per_kw: 0,
    },
  },

  // Winter (November 1 – May 31)
  winter: {
    on_peak: {
      hours: [[16, 21]],
      days: [1, 2, 3, 4, 5],
      energy_rate_per_kwh: 0.38,
      demand_rate_per_kw: 14.80,
    },
    off_peak: {
      hours: [[9, 16], [21, 24], [0, 9]],
      days: [1, 2, 3, 4, 5],
      energy_rate_per_kwh: 0.22,
      demand_rate_per_kw: 0,
    },
    super_off_peak: {
      hours: [[9, 14]],              // Winter super-off-peak: 9 AM–2 PM weekdays
      days: [1, 2, 3, 4, 5],
      energy_rate_per_kwh: 0.14,
      demand_rate_per_kw: 0,
    },
  },

  // Monthly customer charge
  monthly_customer_charge: 280.00,

  // Non-bypassable charges (NBC) — always apply regardless of BESS offset
  nbc_per_kwh: 0.031,
};

// ---------------------------------------------------------------------------
// INTERLOCK DEFINITIONS  (C1 – C7)
// Each interlock maps to an engineering condition from the EMS control spec.
// "source" identifies the physical measurement origin.
// ---------------------------------------------------------------------------

const INTERLOCK_DEFS = {
  C1: {
    id: "C1",
    label: "Grid Voltage & Frequency Normal",
    description: "Utility voltage and frequency within IEEE 1547-2018 Category B ride-through limits measured at PCC via SEL-735.",
    source: "SEL-735 Revenue Meter @ PCC",
    // Thresholds (ANSI 27/59/81)
    voltage_min_pu: 0.88,
    voltage_max_pu: 1.10,
    freq_min_hz: 59.3,
    freq_max_hz: 60.5,
  },
  C2: {
    id: "C2",
    label: "Zero Export / No Reverse Power",
    description: "Active power flow at PCC is net import (positive). Net export to utility ≥ dead-band threshold is prohibited per CA Rule 21 and site interconnection agreement.",
    source: "SEL-735 Revenue Meter @ PCC",
    // Positive = import from utility. Export limit = -2 kW (dead band).
    export_limit_kw: -2,             // kW; more negative = exporting more
    reverse_power_32_pct: 0.1,       // ANSI 32: 0.1% of transformer kVA
    transformer_kva: 2000,           // site service transformer
  },
  C3: {
    id: "C3",
    label: "BESS Stopped / Standby / Charge-Only",
    description: "BESS is confirmed in a safe non-grid-forming state. Requires multiple Modbus register confirmations with minimum stable time.",
    source: "BESS PLC Modbus TCP",
    // Registers that must all be true for C3 = TRUE
    required_registers: [
      "BESS_READY",
      "BESS_FAULT_ACTIVE = false",
      "BESS_FIRE_ALARM_ACTIVE = false",
      "BESS_SAFETY_CHAIN_HEALTHY = true",
      "PCS_READY = true",
      "PCS_GRID_FORMING_ACTIVE = false",
      "TRANSITION_COMPLETE_FLAG = true",
      "BESS_COMM_HEALTHY = true",
    ],
    min_stable_time_s: 10,           // all conditions must hold for ≥10 s
  },
  C4: {
    id: "C4",
    label: "EMS Close Authorization",
    description: "EMS internal logic has completed its pre-close sequence and issued a positive close authorization token.",
    source: "EMS Internal",
  },
  C5: {
    id: "C5",
    label: "Synchronism Check",
    description: "Voltage magnitude, phase angle, and frequency differences across the open breaker are within limits for safe close. Sync data must not be stale.",
    source: "SEL-700G / Vsync / SEL-735",
    // IEEE C37.011-class sync-check parameters
    voltage_diff_max_pct: 5,
    phase_angle_max_deg: 10,
    freq_diff_max_hz: 0.1,
    sync_data_max_age_ms: 200,       // data older than 200ms is rejected for close
  },
  C6: {
    id: "C6",
    label: "Breaker Open Confirmed + Spring Charged",
    description: "52-U auxiliary contacts confirm breaker is open (52b active). Spring charge indicator confirms mechanical energy stored for close operation.",
    source: "52-U Breaker Aux Contacts → EMS DI",
    // Both sub-conditions required
    requires_52b_active: true,
    requires_spring_charge: true,
    requires_no_52a_52b_mismatch: true,
  },
  C7: {
    id: "C7",
    label: "Operator Authorization",
    description: "An authenticated operator with appropriate role (admin or operator with close permission) has explicitly authorized this close operation within the authorization window.",
    source: "EMS HMI / User Session",
    authorization_window_s: 300,     // authorization expires after 5 minutes
  },
};

// ---------------------------------------------------------------------------
// LOAD PROFILE
// Synthetic 24-hour load profile derived from facility type and EV charger
// utilization patterns. Resolution: 15-minute intervals (96 points).
// Units: kW (positive = load consuming power from bus).
// ---------------------------------------------------------------------------

function generateLoadProfile() {
  // Base facility load by hour (facility + limited EV background)
  const hourlyBase = [
    220, 210, 205, 200, 205, 220,   // 00:00 – 05:00  (overnight low)
    260, 380, 520, 640, 710, 760,   // 06:00 – 11:00  (morning ramp)
    780, 820, 850, 890, 980, 1180,  // 12:00 – 17:00  (afternoon + pre-peak)
    1380, 1480, 1320, 1060, 820, 580, // 18:00 – 23:00 (peak + ramp down)
  ];

  const profile = [];
  for (let h = 0; h < 24; h++) {
    for (let q = 0; q < 4; q++) {
      // Add small random variation ±3% within each 15-min slot
      const variation = (Math.random() - 0.5) * 0.06 * hourlyBase[h];
      profile.push(Math.round(hourlyBase[h] + variation));
    }
  }
  return profile; // 96 x 15-min values
}

// ---------------------------------------------------------------------------
// REAL-TIME SIMULATION STATE
// This object is the single source of truth for all Phase 2 module simulations.
// The EMS engine reads and writes this state. The AI Copilot reads it (read-only).
// ---------------------------------------------------------------------------

const SIM_STATE = {
  // Timestamp
  sim_time: new Date(),
  sim_running: false,
  sim_speed: 1,                      // 1 = real-time, 60 = 60x accelerated

  // Grid / PCC measurements (from SEL-735)
  pcc: {
    voltage_pu: 1.003,               // per-unit (1.0 = nominal 480V)
    frequency_hz: 60.02,
    active_power_kw: 0,              // positive = site importing, negative = exporting
    reactive_power_kvar: 0,
    power_factor: 0.97,
    data_age_ms: 0,                  // ms since last poll
    quality: "GOOD",                 // GOOD | STALE | COMM_LOSS | FAULT
  },

  // BESS state
  bess: {
    soc_pct: 55.0,
    active_power_kw: 0,              // positive = charging, negative = discharging
    reactive_power_kvar: 0,
    available_charge_kw: 996,
    available_discharge_kw: 996,
    mode: "STANDBY",                 // STANDBY | CHARGE | DISCHARGE | GRID_FORMING | FAULT | OFFLINE
    grid_forming_active: false,
    transition_complete: true,
    ready: true,
    fault_active: false,
    fire_alarm: false,
    safety_chain_healthy: true,
    comm_healthy: true,
    data_age_ms: 0,
    quality: "GOOD",
    rack_count: 4,
    rack_temps_c: [28, 29, 27, 28],
  },

  // 52-U breaker
  breaker: {
    position: "CLOSED",              // OPEN | CLOSED | MISMATCH | UNKNOWN
    cb_52a: true,                    // Closed-position confirmed
    cb_52b: false,                   // Open-position confirmed (active when OPEN)
    spring_charged: true,
    data_age_ms: 0,
    quality: "GOOD",
  },

  // Protection relay
  relay: {
    healthy: true,
    trip_active: false,
    out301_enabled: true,            // protection trip output
    out302_disabled: true,           // must always be disabled (no close authority)
    data_age_ms: 0,
    quality: "GOOD",
  },

  // Site load
  load: {
    total_kw: 620,
    ev_l2_active: 20,               // number of active L2 chargers
    ev_dcfc_active: 1,              // number of active DCFC chargers
    facility_base_kw: 280,
  },

  // EMS control
  ems: {
    mode: "GRID_CONNECTED",
    // Grid-Island-Grid state machine state
    grid_state: "GRID_CONNECTED",   // see STATE MACHINE in ems-engine.js
    trip_lockout: false,
    close_authorized: false,
    close_auth_expires: null,       // Date or null
    operator_id: null,
    operator_role: null,            // "admin" | "operator" | null
    active_mode: "PEAK_SHAVE",      // PEAK_SHAVE | TOU_OPT | STANDBY | MANUAL | ISLAND
  },

  // Interlock chain — evaluated each poll cycle by ems-engine.js
  interlocks: {
    C1: { value: true,  raw_value: null, blocking_reason: null, data_age_ms: 0 },
    C2: { value: true,  raw_value: null, blocking_reason: null, data_age_ms: 0 },
    C3: { value: true,  raw_value: null, blocking_reason: null, data_age_ms: 0 },
    C4: { value: false, raw_value: null, blocking_reason: "No active EMS authorization", data_age_ms: 0 },
    C5: { value: false, raw_value: null, blocking_reason: "Breaker is closed — sync check not applicable", data_age_ms: 0 },
    C6: { value: false, raw_value: null, blocking_reason: "Breaker is CLOSED (52b not active)", data_age_ms: 0 },
    C7: { value: false, raw_value: null, blocking_reason: "No operator authorization active", data_age_ms: 0 },
  },

  // Close authority — true only when ALL of C1–C7 are true AND in correct grid state
  close_permitted: false,

  // Event log — ring buffer, last 200 entries
  event_log: [],
  MAX_EVENTS: 200,

  // Dispatch plan — current day (96 x 15-min slots)
  dispatch_plan: null,
  dispatch_results: [],

  // Demand tracking — rolling peak for billing period
  demand_peak_kw: 0,
  demand_window_kw: [],             // last 4 x 15-min readings for 15-min average
};

// ---------------------------------------------------------------------------
// UTILITY HELPERS
// ---------------------------------------------------------------------------

/**
 * Determine current season from a Date object.
 * Summer: June (5) through October (9) inclusive.
 * @param {Date} dt
 * @returns {"summer"|"winter"}
 */
function getSeason(dt) {
  const month = dt.getMonth(); // 0-indexed
  return (month >= 5 && month <= 9) ? "summer" : "winter";
}

/**
 * Get current TOU period label for a given Date.
 * @param {Date} dt
 * @returns {"on_peak"|"off_peak"|"super_off_peak"}
 */
function getTOUPeriod(dt) {
  const season = getSeason(dt);
  const tariff = TARIFF_TOU_DR_OPT[season];
  const hour = dt.getHours();
  const dow = dt.getDay(); // 0=Sun, 6=Sat

  // Check super_off_peak first (higher priority in some seasons)
  for (const [start, end] of tariff.super_off_peak.hours) {
    if (hour >= start && hour < end) {
      if (tariff.super_off_peak.days.includes(dow)) return "super_off_peak";
    }
  }
  // On-peak
  for (const [start, end] of tariff.on_peak.hours) {
    if (hour >= start && hour < end) {
      if (tariff.on_peak.days.includes(dow)) return "on_peak";
    }
  }
  return "off_peak";
}

/**
 * Get energy rate ($/kWh) for a given Date.
 * @param {Date} dt
 * @returns {number}
 */
function getEnergyRate(dt) {
  const season = getSeason(dt);
  const period = getTOUPeriod(dt);
  return TARIFF_TOU_DR_OPT[season][period].energy_rate_per_kwh;
}

/**
 * Get demand rate ($/kW) for a given Date.
 * @param {Date} dt
 * @returns {number}
 */
function getDemandRate(dt) {
  const season = getSeason(dt);
  const period = getTOUPeriod(dt);
  return TARIFF_TOU_DR_OPT[season][period].demand_rate_per_kw;
}

/**
 * Append an event to the SIM_STATE event log.
 * Trims to MAX_EVENTS (ring buffer behaviour).
 * @param {string} category  - "SYSTEM"|"INTERLOCK"|"CONTROL"|"ALARM"|"AI"
 * @param {string} severity  - "INFO"|"WARNING"|"CRITICAL"
 * @param {string} message
 * @param {object} [data]    - optional structured payload
 */
function logEvent(category, severity, message, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    category,
    severity,
    message,
    data,
  };
  SIM_STATE.event_log.unshift(entry); // newest first
  if (SIM_STATE.event_log.length > SIM_STATE.MAX_EVENTS) {
    SIM_STATE.event_log.length = SIM_STATE.MAX_EVENTS;
  }
}

/**
 * Format a kW value for display.
 * @param {number} kw
 * @returns {string}
 */
function fmtKW(kw) {
  if (Math.abs(kw) >= 1000) return (kw / 1000).toFixed(2) + " MW";
  return kw.toFixed(1) + " kW";
}

/**
 * Format a percentage for display.
 * @param {number} pct
 * @returns {string}
 */
function fmtPct(pct) {
  return pct.toFixed(1) + "%";
}

/**
 * Clamp a value between min and max.
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Export for use by ems-engine.js, copilot-core.js, and page scripts
// (In a module system these would be ES module exports; here we attach to window)
if (typeof window !== "undefined") {
  window.EnergizeOS = window.EnergizeOS || {};
  Object.assign(window.EnergizeOS, {
    SITE_CONFIG,
    TARIFF_TOU_DR_OPT,
    INTERLOCK_DEFS,
    SIM_STATE,
    getSeason,
    getTOUPeriod,
    getEnergyRate,
    getDemandRate,
    logEvent,
    fmtKW,
    fmtPct,
    clamp,
    generateLoadProfile,
  });
}
