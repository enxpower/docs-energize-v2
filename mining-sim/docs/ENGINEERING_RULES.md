# ENGINEERING RULES

## 1. Purpose

Engineering rules convert model results into traceable findings and recommendations. A recommendation must never be free-form opinion only.

Each rule must define:

- rule ID;
- title;
- engineering domain;
- inputs;
- condition;
- severity;
- interpretation;
- recommendation;
- exclusions;
- references or engineering basis;
- affected KPIs;
- confidence / model-fidelity requirement.

## 2. Rule Severity

- INFO — observation or design note
- ADVISORY — improvement opportunity
- WARNING — material design or operating risk
- CRITICAL — unacceptable condition requiring redesign, protection, or operational restriction

## 3. Initial Rule Families

### Reliability

- N1-GEN-001 — generation capacity N-1 failure
- RESERVE-FAST-001 — insufficient 10-second fast reserve
- RESERVE-SPIN-001 — insufficient 60-second spinning reserve
- EENS-001 — unserved-energy target exceeded

### Diesel

- DG-LOW-LOAD-001 — excessive low-load operation
- DG-STARTS-001 — excessive starts per period
- DG-RESERVE-001 — insufficient governor/spinning headroom
- DG-COMMIT-001 — unit commitment hunting

### BESS

- BESS-POWER-001 — power-limited response
- BESS-ENERGY-002 — energy capacity insufficient
- BESS-SOC-003 — excessive time near SOC boundary
- BESS-CYCLE-004 — excessive throughput / cycling
- BESS-PQ-005 — apparent-power conflict between active and reactive support

### Renewable Energy

- RE-CURTAIL-001 — high curtailment
- PV-SIZE-001 — PV oversizing relative to absorption capability
- WIND-RESERVE-001 — wind reserve unavailable when frequency support is expected

### Frequency

- FREQ-NADIR-001 — frequency nadir below criterion
- FREQ-ZENITH-001 — over-frequency criterion exceeded
- ROCOF-001 — RoCoF criterion exceeded
- FREQ-RECOVERY-001 — secondary restoration too slow

### Voltage / Reactive Power

- VOLT-DIP-001 — motor-start voltage dip excessive
- VOLT-STEADY-001 — steady-state voltage outside screening band
- Q-LIMIT-001 — PCS reactive support limited by apparent-power capability

### Motor Start

- MOTOR-PERMIT-001 — start requested without sufficient reserve
- MOTOR-VOLT-002 — predicted voltage dip unacceptable
- MOTOR-CONCURRENT-003 — simultaneous-start risk

### Grid / PCC

- PCC-IMPORT-001 — import capacity exceeded
- PCC-EXPORT-001 — export limit exceeded
- PCC-ISLAND-001 — insufficient island-transition capability

### Environment

- ENV-DERATE-001 — thermal or altitude derating materially affects available capacity
- ENV-HVAC-002 — auxiliary thermal-management load materially affects net energy

## 4. Example Rule

```text
ID: BESS-ENERGY-002
Domain: BESS
Condition:
  SOC at lower operating boundary for > 5% of simulation horizon
  AND BESS power is not continuously at discharge MW limit
Interpretation:
  The system is primarily energy-capacity limited rather than power limited.
Recommendation:
  Evaluate increasing BESS MWh before increasing MW.
Severity: WARNING
```

## 5. Recommendation Discipline

Recommendations must distinguish among:

- increase MW;
- increase MWh;
- change control strategy;
- change unit commitment;
- add reserve;
- change topology;
- reduce renewable capacity;
- add flexible load;
- defer a large motor start;
- perform a detailed external study.

## 6. Rule Conflict Handling

Rules may conflict. Example:

- increasing BESS MWh reduces curtailment;
- reducing BESS cycling protects life;
- maintaining high SOC improves resilience;
- lower SOC target improves renewable absorption.

The system must not silently choose. Conflicts should be exposed and resolved by selected optimization objective or user priority.

## 7. Machine-Readable Direction

V7 rules should progressively move into structured data under `v7/rules/` so they can be executed, tested, versioned, and explained.

## 8. Rule Governance

A new rule requires:

- engineering rationale;
- test case;
- expected trigger and non-trigger examples;
- severity review;
- wording review to avoid false certainty.
