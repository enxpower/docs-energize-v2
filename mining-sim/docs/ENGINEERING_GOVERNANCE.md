# ENGINEERING GOVERNANCE

## 1. Purpose

This document governs how engineering theory, software architecture, code, tests, and releases are changed.

The objective is to prevent model drift, hidden assumptions, curve-tuning, and repeated regression.

## 2. Change Classes

### Class A — Documentation Only

No model behavior change.

Examples:

- wording;
- diagrams;
- comments;
- explanatory documentation.

### Class B — UI / Presentation

No engineering result change.

Examples:

- layout;
- chart rendering;
- button styling;
- responsive behavior.

Must not alter model state or calculations.

### Class C — Parameter / Configuration

Changes defaults or scenario configuration but not equations.

Requires:

- affected scenario review;
- regression comparison;
- explanation of changed default.

### Class D — Engineering Model Change

Changes equations, state transitions, controller behavior, protection, KPI definitions, or optimization logic.

Requires:

- engineering rationale;
- source specification update;
- model-version increment;
- affected regression tests;
- historical comparability note.

### Class E — Architecture Change

Changes layer boundaries, contracts, data flow, or module ownership.

Requires review against `SYSTEM_ARCHITECTURE.md` and must not violate the Product Constitution.

## 3. Mandatory Change Record

Every Class C–E change must document:

1. Problem statement
2. Engineering basis
3. Existing behavior
4. Proposed behavior
5. Affected modules
6. Affected scenarios
7. Tests to run
8. Expected KPI changes
9. Known limitations
10. Rollback path

## 4. Prohibited Development Behavior

Do not:

- change a coefficient only because a screenshot looks wrong;
- hide an unstable result by clipping it without modeling the protection or physical limit;
- modify a KPI definition without versioning it;
- let UI events directly set frequency, voltage, SOC, or equipment output;
- add an equipment feature without defining state, limits, and failure behavior;
- add optimization recommendations without constraint checks;
- claim engineering fidelity above the implemented model.

## 5. Model Source of Truth

For every model, the source of truth must identify whether it is based on:

- first-principles equation;
- industry-standard simplified model;
- OEM/manufacturer data;
- project-specific data;
- engineering assumption;
- calibration data.

Unknown provenance must be marked as an assumption.

## 6. Calibration Policy

Calibration is permitted only when:

- target data is identified;
- calibrated parameters have physical meaning;
- pre/post calibration behavior is documented;
- calibration does not violate known physical limits.

Calibration to make a plot aesthetically pleasing is prohibited.

## 7. Numerical Stability Policy

Numerical safeguards are allowed, but must be distinguished from physical limits.

Examples:

- solver guardrail;
- protection threshold;
- equipment capability limit;
- plotting range.

These must never be represented as the same thing.

## 8. Release Versioning

Recommended version semantics:

- major: architecture or model-generation change;
- minor: new engineering capability or material model update;
- patch: bug fix without intended theoretical change.

Every export must include:

- model version;
- build identifier;
- timestamp;
- scenario version;
- configuration hash where available;
- assumptions profile.

## 9. Legacy Policy

V6.x is a legacy live prototype. It may receive critical fixes, but should not accumulate V7 architecture.

V7 development must occur under a separate `v7/` structure until release gates are passed.

## 10. Review Domains

Material changes should be reviewed through applicable engineering domains:

- electrical;
- power systems;
- microgrid;
- EMS controls;
- BESS/PCS integration;
- utility interconnection;
- protection;
- SCADA/PLC;
- industrial controls;
- commissioning;
- O&M;
- electrical safety;
- root-cause analysis;
- reliability;
- system integration;
- industrial communications;
- battery systems;
- generator / black start;
- energy dispatch;
- codes and standards;
- HVAC / thermal management;
- industrial product design;
- DFM/DFA;
- EPC / construction;
- engineering risk.

Not every change requires all domains, but the change record must identify which are applicable.

## 11. Decision Priority

When technical options conflict, use the priority order in the Product Constitution. Safety, protection, production continuity, and stability outrank cosmetic performance and economic optimization.

## 12. Stop Conditions

Implementation must stop and escalate when:

- governing documents conflict;
- required model theory is undefined;
- a result cannot be explained;
- a P0 integrity defect is discovered;
- requested UI behavior would violate engineering truth;
- the available model fidelity cannot support the requested claim.

## 13. Definition of Done

A change is done only when:

- implementation is complete;
- governing documentation remains consistent;
- applicable tests pass;
- exports identify the correct model version;
- limitations are updated;
- no new P0 defect is known.

## 14. Core Principle

> First define what is correct. Then implement it. Then test it. Only then optimize it.
