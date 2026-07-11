# ADR-007 — Load Restoration and Cold-Load Pickup

## Status

Accepted.

## Context

UFLS can preserve an islanded power system by disconnecting load, but a complete recovery strategy must also determine when and how that load may return. Immediate bulk restoration can recreate the original deficit, produce a second frequency collapse, or cause repetitive shed-and-restore oscillation. Restored motors, transformers, HVAC loads, pumps, and process auxiliaries may temporarily demand more than their normal steady-state power.

## Decision

### 1. Restoration is slower and more conservative than shedding

UFLS may act quickly on definite-time frequency stages. Restoration requires all of the following:

- frequency above the configured restoration threshold for a continuous hold time;
- no material persistent active-power deficit;
- sufficient duration-qualified reserve;
- expiry of the minimum post-shed delay;
- expiry of the minimum interval since the previous restoration;
- no active restoration rollback lockout.

### 2. Restoration is staged

Load blocks are restored one at a time. The restoration order is explicit and deterministic. Critical or high-priority loads may be restored before lower-priority loads, but only when their pickup requirement fits the available reserve.

A bulk `restore all` action must not be used by automatic restoration control.

### 3. Cold-load pickup is part of the capacity check

Each restorable load block may define:

- normal MW;
- cold-load pickup multiplier;
- pickup decay duration.

The restoration controller must compare reserve against the estimated initial pickup:

`normal block MW + temporary cold-load pickup MW`.

The temporary pickup is represented as a time-decaying load contribution. V7 currently uses a deterministic screening curve; project-specific motor starting, transformer inrush, voltage dip, and protection behavior require higher-fidelity studies.

### 4. Post-restoration observation and rollback

After a block is restored, the controller enters an observation window. If frequency falls below the rollback threshold during that window, the most recently restored block is disconnected again.

A rollback creates a lockout period before another automatic restoration attempt. This prevents rapid shed/restore oscillation.

### 5. Separation of authority

The restoration controller may:

- evaluate restoration permissives;
- request restoration of one configured load block;
- request rollback of the most recently restored block;
- create traceable events.

It may not:

- directly change generator output;
- directly change BESS output or SOC;
- bypass UFLS logic;
- restore critical load without configured eligibility;
- silently modify measured demand.

The authority chain remains:

`System measurements → Restoration permissives → Load-block state change → EMS/Governor/BESS response → Physical simulation`.

### 6. Reliability accounting

The following quantities remain distinct:

- demand MW;
- connected load MW;
- served load MW;
- shed load MW;
- cold-load pickup MW;
- residual power imbalance MW;
- EENS MWh.

EENS accumulates only from explicitly unserved or shed load over time. A transient power residual is not automatically EENS.

### 7. Model maturity

V7 restoration thresholds, delays, reserve margins, and pickup curves are screening assumptions. They are not universal relay settings or commissioning setpoints.

Project use requires validation against:

- protection coordination;
- generator transient capability;
- PCS overload capability;
- motor starting studies;
- voltage and reactive-power limits;
- process restart constraints;
- operator procedures.

## Validation

Regression tests must verify at least:

1. deterministic staged restoration order;
2. reserve gating using normal MW plus cold-load pickup;
3. cold-load pickup decay;
4. failed restoration rollback;
5. rollback lockout preventing oscillation.
