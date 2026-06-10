/**
 * domain.js
 * EnergizeOS Commissioning Copilot V1
 *
 * Domain constants, file categories, site types, and commissioning
 * knowledge structures. This is the single source of truth for
 * domain vocabulary used by parsers, prompts, templates, and UI.
 */

"use strict";

// ---------------------------------------------------------------- site types
const SITE_TYPES = [
  { id: "bess",         label: "BESS" },
  { id: "ems-cabinet",  label: "EMS Cabinet" },
  { id: "microgrid",    label: "Microgrid" },
  { id: "solar-storage",label: "Solar + Storage" },
  { id: "ev-storage",   label: "EV Charging + Storage" },
  { id: "gen-storage",  label: "Generator + Storage" },
];

// ---------------------------------------------------------------- file categories
const FILE_CATEGORIES = [
  { id: "sld",            label: "Single Line Diagram" },
  { id: "pcs-manual",     label: "PCS Manual" },
  { id: "bms-manual",     label: "BMS Manual" },
  { id: "ems-logic",      label: "EMS Logic Document" },
  { id: "relay-settings", label: "SEL Relay Settings" },
  { id: "modbus-map",     label: "Modbus Map" },
  { id: "fat-report",     label: "FAT Report" },
  { id: "sat-report",     label: "SAT Report" },
  { id: "checklist",      label: "Commissioning Checklist" },
  { id: "alarm-log",      label: "Alarm Log" },
  { id: "site-photos",    label: "Site Photos" },
  { id: "utility-doc",    label: "Utility Interconnection Document" },
  { id: "om-manual",      label: "O&M Manual" },
  { id: "other",          label: "Other" },
];

// ---------------------------------------------------------------- commissioning knowledge
/**
 * Canonical commissioning sequences. Used by:
 *  - the AI system prompt (so the model reasons against a real workflow)
 *  - missing-step detection
 *  - checklist templates
 */
const COMMISSIONING_KNOWLEDGE = {
  bess_sequence: [
    { step: "DC insulation check",            detail: "Megger/IR test on DC bus and battery strings before first energization. Record values against manufacturer minimum." },
    { step: "Battery rack readiness",         detail: "Rack mechanical inspection, torque verification, cell voltage scan, contactor function, rack-level BMS online." },
    { step: "BMS communication",              detail: "BMS-to-PCS and BMS-to-EMS links verified. Register map confirmed against integration spec. Heartbeat and data quality validated." },
    { step: "PCS startup sequence",           detail: "Aux power, pre-charge, DC link verification, cooling system, firmware version recorded, no active faults." },
    { step: "EMS control mode verification",  detail: "EMS-to-PCS command path validated. Mode transitions (standby/charge/discharge) tested at low power." },
    { step: "Grid synchronization",           detail: "Sync-check parameters verified (voltage, frequency, phase angle). Close authority confirmed as EMS-led only. Anti-islanding verified." },
    { step: "Protection settings",            detail: "Relay settings loaded match approved settings file (checksum). Trip path verified by injection test. Trip is relay-led and EMS-independent." },
    { step: "E-stop validation",              detail: "All E-stop devices open the correct path. Recovery requires manual reset. Verified under supervision." },
    { step: "HVAC / fire system readiness",   detail: "Thermal management operational. Fire detection/suppression integrated to BMS safety chain. Alarm propagation tested." },
    { step: "Charge/discharge test",          detail: "Stepped power test per FAT/SAT script. Round-trip efficiency, SOC tracking, and limit enforcement recorded." },
    { step: "Customer handoff",               detail: "As-built documents, settings records, test evidence, O&M manual, training, and open-items list delivered." },
  ],

  ems_sequence: [
    { step: "IO check",                  detail: "All digital/analog IO points verified end-to-end against IO list. Wetting voltage sources confirmed (UPS-backed where required)." },
    { step: "Network check",             detail: "Static IPs assigned per network plan. Ping/port tests for every device. VLAN and firewall rules verified." },
    { step: "Modbus map validation",     detail: "Every mapped register read and verified against device documentation. Scaling, signedness, byte order, and units confirmed." },
    { step: "Meter data validation",     detail: "Meter kW/kvar/V/F readings cross-checked against reference instrument. CT/PT ratio and polarity verified." },
    { step: "PCS command validation",    detail: "EMS dispatch commands verified at PCS terminals. Command latency and readback confirmed. Limits enforced." },
    { step: "SOC logic",                 detail: "SOC min/max envelope, hysteresis, and end-of-charge/discharge behavior verified." },
    { step: "Demand control logic",      detail: "Peak shave threshold response verified against simulated load. Demand window calculation validated." },
    { step: "TOU strategy",              detail: "Schedule engine verified against tariff calendar. Season/DST transitions checked." },
    { step: "Alarm handling",            detail: "Alarm classes (Critical/Warning/Info) verified. Alarm flood suppression and operator notification tested." },
    { step: "Fail-safe behavior",        detail: "Comm-loss, power-loss, and watchdog behavior verified. System resolves to safe state. Recovery is supervised, never automatic close." },
  ],

  troubleshooting_categories: [
    { id: "pcs-not-ready",     label: "PCS not ready",              first_checks: ["Active fault codes on PCS HMI", "DC link voltage present", "Aux power healthy", "Cooling system status", "Run-enable interlocks satisfied"] },
    { id: "bms-not-ready",     label: "BMS not ready",              first_checks: ["Rack contactor states", "Cell voltage/temperature limits", "Safety chain continuity", "BMS-PCS handshake", "Firmware compatibility"] },
    { id: "grid-vf-issue",     label: "Grid voltage/frequency issue", first_checks: ["Meter readings vs reference", "PT fuses and wiring", "Utility event correlation", "Relay event log", "Ride-through settings vs measured disturbance"] },
    { id: "modbus-timeout",    label: "Modbus timeout",             first_checks: ["Physical layer (link lights, cabling)", "IP/port/unit-ID config", "Poll rate vs device capability", "Register address validity", "Gateway/firewall in path"] },
    { id: "soc-mismatch",      label: "SOC mismatch",               first_checks: ["BMS SOC vs EMS displayed SOC", "Scaling and register mapping", "SOC calibration date", "Rack-level vs system-level aggregation", "Recent deep cycle or long standby"] },
    { id: "meter-abnormal",    label: "Meter reading abnormal",     first_checks: ["CT polarity and ratio", "PT ratio and wiring", "Phase rotation", "Meter configuration profile", "Comparison against independent measurement"] },
    { id: "ems-cmd-rejected",  label: "EMS command rejected",       first_checks: ["PCS operating mode and permissives", "Limit violations (SOC/power/export)", "Command format and scaling", "Control authority/priority settings", "Active interlocks"] },
    { id: "relay-trip",        label: "Relay trip",                 first_checks: ["Relay event report and targets", "Which element operated (50/51/27/59/81/32)", "Settings vs approved file", "Actual electrical event vs nuisance trip", "DO NOT reset and reclose without root cause"] },
    { id: "interlock-active",  label: "Interlock active",           first_checks: ["Which specific condition is blocking (read each permissive)", "Data quality/staleness on blocking signal", "Field wiring of the permissive", "Whether condition is genuine or sensor fault"] },
    { id: "estop-active",      label: "E-stop active",              first_checks: ["Physically locate every E-stop device", "Why was it pressed — investigate before reset", "Reset procedure per site safety plan", "Verify safety chain healthy after reset"] },
    { id: "network-unreachable", label: "Network unreachable",      first_checks: ["Link layer status", "IP conflict scan", "Switch/VLAN configuration", "Recent network changes", "Device management interface locally"] },
  ],

  // Documents expected before site commissioning can start — used for
  // missing-document detection against the uploaded file list.
  required_docs_by_site: {
    "bess":          ["sld", "pcs-manual", "bms-manual", "ems-logic", "relay-settings", "modbus-map", "fat-report", "utility-doc"],
    "ems-cabinet":   ["sld", "ems-logic", "modbus-map", "fat-report"],
    "microgrid":     ["sld", "pcs-manual", "ems-logic", "relay-settings", "modbus-map", "fat-report", "utility-doc"],
    "solar-storage": ["sld", "pcs-manual", "bms-manual", "ems-logic", "relay-settings", "modbus-map", "utility-doc"],
    "ev-storage":    ["sld", "pcs-manual", "bms-manual", "ems-logic", "modbus-map", "utility-doc"],
    "gen-storage":   ["sld", "pcs-manual", "ems-logic", "relay-settings", "modbus-map"],
  },
};

// ---------------------------------------------------------------- safety
const SAFETY_DISCLAIMER =
  "AI output is engineering assistance, not stamped engineering approval. " +
  "Field work must follow site safety procedures and LOTO. Switching, energization, " +
  "relay setting changes, and live electrical work require qualified personnel. " +
  "Missing documents or incomplete data reduce confidence.";

// Attach to namespace
window.CxDomain = {
  SITE_TYPES,
  FILE_CATEGORIES,
  COMMISSIONING_KNOWLEDGE,
  SAFETY_DISCLAIMER,
  categoryLabel: (id) => (FILE_CATEGORIES.find(c => c.id === id) || {}).label || id,
  siteTypeLabel: (id) => (SITE_TYPES.find(s => s.id === id) || {}).label || id,
};
