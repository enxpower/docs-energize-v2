/**
 * templates.js
 * EnergizeOS Commissioning Copilot V1
 *
 * Built-in commissioning templates as structured objects.
 * Each template: { id, label, kind: "checklist"|"troubleshooting"|"report",
 *                  sections: [{ title, items: string[] }] }
 *
 * Templates serve three purposes:
 *   1. Direct use — rendered as interactive checklists in the UI.
 *   2. AI grounding — injected into prompts so generated reports follow
 *      the company's canonical structure.
 *   3. Gap detection — uploaded FAT/SAT reports are compared against
 *      these expected workflows.
 */

"use strict";

const TEMPLATES = [
  {
    id: "bess-commissioning",
    label: "BESS Commissioning Checklist",
    kind: "checklist",
    sections: [
      { title: "Pre-Energization", items: [
        "Site safety plan reviewed; LOTO procedure in place",
        "DC insulation resistance test completed and recorded (vs. manufacturer minimum)",
        "Battery rack torque verification complete",
        "Cell voltage scan — all cells within delta limit",
        "Rack contactors functional; safety chain continuity verified",
        "Grounding system verified; ground resistance recorded",
        "HVAC operational; setpoints configured",
        "Fire detection/suppression system online and integrated to BMS safety chain",
      ]},
      { title: "Communication & Controls", items: [
        "BMS online; firmware version recorded",
        "BMS-to-PCS link verified against integration spec",
        "BMS-to-EMS Modbus map validated register-by-register",
        "PCS firmware version recorded; no active faults",
        "EMS-to-PCS command path verified at low power",
        "All E-stop devices tested; recovery requires manual reset",
      ]},
      { title: "Grid Connection", items: [
        "Protection relay settings match approved settings file (checksum verified)",
        "Trip path verified by secondary injection — relay-led, EMS-independent",
        "Close authority confirmed as EMS-led only; no relay autonomous close path",
        "Sync-check parameters verified (ΔV, Δθ, ΔF)",
        "Anti-islanding behavior verified per interconnection requirements",
        "Zero-export / export-limit function verified with meter feedback",
      ]},
      { title: "Performance", items: [
        "Stepped charge test per script; SOC tracking verified",
        "Stepped discharge test per script; limits enforced",
        "Round-trip efficiency recorded",
        "Comm-loss and watchdog fail-safe behavior verified",
      ]},
      { title: "Handoff", items: [
        "As-built documents delivered",
        "As-loaded settings records with checksums delivered",
        "Test evidence package compiled",
        "O&M manual and training delivered",
        "Open-items / punch list issued with owners and due dates",
      ]},
    ],
  },
  {
    id: "ems-fat",
    label: "EMS Cabinet FAT Checklist",
    kind: "checklist",
    sections: [
      { title: "Cabinet Hardware", items: [
        "Cabinet wiring matches drawings; labels verified",
        "Terminal torque check complete",
        "Power supplies and UPS verified; runtime test recorded",
        "DI wetting sources verified (UPS-backed where required)",
        "Relay outputs verified — pulse behavior, no unintended latch",
      ]},
      { title: "Software & IO", items: [
        "EMS software build ID recorded",
        "Every DI/DO/AI/AO point exercised end-to-end against IO list",
        "Modbus map validated against device documentation (scaling, signedness, byte order)",
        "Watchdog and comm-loss behavior verified",
        "Event/alarm logging verified with correct timestamps",
      ]},
      { title: "Control Logic", items: [
        "Operating mode transitions tested",
        "All permissive/interlock conditions tested individually — each FALSE blocks action",
        "All-TRUE condition enables action only with authorization",
        "Limit enforcement tested (SOC, power, export)",
        "Manual override tested with authorization and logging",
      ]},
    ],
  },
  {
    id: "ems-sat",
    label: "EMS Cabinet SAT Checklist",
    kind: "checklist",
    sections: [
      { title: "Site Integration", items: [
        "Static IP assignments match network plan; all devices reachable",
        "Field wiring to breaker aux contacts (52a/52b) verified",
        "CT/PT polarity and ratio verified against meter readings",
        "Relay-to-EMS status points verified live",
        "BESS PLC register readback verified live",
      ]},
      { title: "Functional Verification", items: [
        "Meter kW/V/F readback cross-checked against reference instrument",
        "PCS command and readback verified at site",
        "Each interlock condition forced FALSE → action blocked (witnessed)",
        "Trip initiated → EMS enters lockout; no auto-reclose (witnessed)",
        "Lockout clear requires authorized user; full permissive re-evaluation",
        "Communication loss to each critical device → safe behavior verified",
      ]},
      { title: "Acceptance", items: [
        "All test steps signed by commissioning lead and witness",
        "Deviations recorded with disposition",
        "As-left settings and software versions recorded",
      ]},
    ],
  },
  {
    id: "pcs-grid-troubleshoot",
    label: "PCS Grid Connection Troubleshooting",
    kind: "troubleshooting",
    sections: [
      { title: "Symptom → First Checks", items: [
        "Read PCS fault/alarm codes before anything else — record exact codes",
        "Verify grid voltage and frequency at PCS terminals vs. ride-through settings",
        "Verify run-enable / external interlock inputs are satisfied",
        "Check DC link voltage present and within range",
        "Verify grid synchronization parameters and sync source",
        "Check EMS command state — is EMS commanding standby?",
        "Verify protection relay is not asserting a block/trip output",
        "Check phase rotation if first energization",
      ]},
      { title: "Escalation", items: [
        "If relay trip caused disconnection: do NOT reset and retry — pull relay event report first",
        "If fault codes indicate internal PCS failure: contact PCS vendor with codes and event log",
        "If grid measurements are abnormal: verify PT circuits before suspecting utility",
      ]},
    ],
  },
  {
    id: "bms-comm-troubleshoot",
    label: "BMS Communication Troubleshooting",
    kind: "troubleshooting",
    sections: [
      { title: "Symptom → First Checks", items: [
        "Physical layer: link lights, cabling, connector seating",
        "Ping BMS controller from EMS host; verify IP/subnet/VLAN",
        "Verify Modbus unit ID, port, and function codes against register map",
        "Confirm register map version matches BMS firmware version",
        "Check poll rate vs. BMS documented capability — slow device, fast poll = timeouts",
        "Verify byte order and scaling on a known-good register (e.g., pack voltage)",
        "Check for IP conflict on the control network",
      ]},
      { title: "Data Quality", items: [
        "Confirm timestamps update — frozen values with good comms = stale data trap",
        "Verify quality/heartbeat register if available",
        "Stale or bad-quality data must evaluate as FALSE in any permissive logic",
      ]},
    ],
  },
  {
    id: "modbus-checklist",
    label: "Modbus Integration Checklist",
    kind: "checklist",
    sections: [
      { title: "Per Device", items: [
        "IP address, port, unit ID recorded and match network plan",
        "Register map document version recorded",
        "Each mapped register read and value sanity-checked",
        "Scaling factor, signedness, and byte/word order verified",
        "Units confirmed (kW vs W, V vs kV)",
        "Write registers tested with readback where applicable",
        "Timeout, retry, and poll interval configured per device capability",
        "Comm-loss detection and stale-data timeout configured",
        "Heartbeat/watchdog register configured if supported",
      ]},
    ],
  },
  {
    id: "sel-relay-review",
    label: "SEL Relay Review Checklist",
    kind: "checklist",
    sections: [
      { title: "Settings Review", items: [
        "As-loaded settings file exported; checksum recorded",
        "Settings match the EOR-approved settings document — line by line for enabled elements",
        "Firmware version recorded and matches approved baseline",
        "Enabled protection elements documented (e.g., 27/59/81/32/25) with setpoints",
        "Disabled elements documented with written justification",
        "Output contact mapping verified — trip outputs to trip path only",
        "No relay output has autonomous close authority unless explicitly approved",
      ]},
      { title: "Verification", items: [
        "Secondary injection test per element; operate times recorded",
        "Trip path verified end-to-end to breaker trip coil",
        "Event report retrieval verified",
        "Time sync verified for SOE accuracy",
      ]},
    ],
  },
  {
    id: "site-readiness",
    label: "Site Readiness Checklist",
    kind: "checklist",
    sections: [
      { title: "Before Mobilizing", items: [
        "All required documents received (SLD, manuals, register maps, settings, interconnection docs)",
        "Static IP table issued",
        "Utility witness test requirements and notice period confirmed",
        "Field wiring complete per drawings; ECOs closed",
        "Permanent power available to control cabinet",
        "Network infrastructure installed and tested",
        "Safety orientation and site access arranged",
        "Open engineering questions resolved or documented as known risks",
      ]},
    ],
  },
  {
    id: "customer-handoff",
    label: "Customer Handoff Report",
    kind: "report",
    sections: [
      { title: "Structure", items: [
        "Project summary and system description",
        "Commissioning scope completed (dated)",
        "Test results summary with pass/fail",
        "As-left settings and software versions",
        "Open items / punch list with owners and due dates",
        "Operating instructions summary",
        "O&M recommendations and periodic test plan",
        "Warranty and support contacts",
      ]},
    ],
  },
  {
    id: "issue-report",
    label: "Commissioning Issue Report",
    kind: "report",
    sections: [
      { title: "Structure", items: [
        "Issue ID, date, reporter",
        "System / equipment affected",
        "Symptom description (observed, not interpreted)",
        "Evidence (codes, logs, measurements, photos)",
        "Root cause analysis (or current hypothesis with confidence)",
        "Impact on commissioning schedule",
        "Corrective action taken or recommended",
        "Owner and due date",
        "Status (Open / In Progress / Closed)",
      ]},
    ],
  },
];

// ---------------------------------------------------------------- report types
const REPORT_TYPES = [
  { id: "summary",     label: "Commissioning Summary",   desc: "Overall status, completed work, findings, and next steps." },
  { id: "open-issues", label: "Open Issues List",        desc: "Structured punch list extracted from uploaded documents and chat findings." },
  { id: "risk",        label: "Risk Register",            desc: "Identified risks with severity, likelihood, and mitigation." },
  { id: "fat",         label: "FAT Checklist",            desc: "Factory acceptance checklist tailored to this project's equipment." },
  { id: "sat",         label: "SAT Checklist",            desc: "Site acceptance checklist tailored to this project." },
  { id: "handoff",     label: "Customer Handoff Report",  desc: "Customer-facing completion and transition document." },
  { id: "troubleshoot",label: "Troubleshooting Report",   desc: "Symptom → evidence → root cause → action, from the current chat context." },
];

window.CxTemplates = { TEMPLATES, REPORT_TYPES };
