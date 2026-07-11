# ADR-006 — UFLS and Load-Shedding Governance

## Status

Accepted.

## Context

When generation and fast reserve cannot arrest an island frequency decline, controlled load shedding may be the final containment action before system collapse. A screening simulator must distinguish connected demand, intentionally shed load, transient power mismatch, and unserved energy. These quantities are not interchangeable.

## Decision

### 1. Separate load quantities

V7 uses the following meanings:

- `demandMW` — original requested load before controlled shedding;
- `connectedLoadMW` — load still electrically connected after shedding;
- `servedLoadMW` — connected load represented in the current aggregate model;
- `shedLoadMW` — load explicitly disconnected by a recorded shedding action;
- `EENS` — time integral of explicitly unserved or shed load, expressed in MWh.

A transient negative power residual is not automatically EENS.

### 2. Staged UFLS

Each UFLS stage must define:

- frequency threshold;
- definite-time delay;
- eligible load class;
- explicit load block or priority order;
- operation evidence.

Both the frequency threshold and delay must be satisfied before operation. Timer accumulation resets when the initiating condition clears.

### 3. Load priority

Noncritical loads must be shed before critical loads unless a stage explicitly authorizes critical-load shedding. Each block must expose:

- identifier;
- MW;
- priority;
- criticality;
- shed state;
- operation time.

### 4. Authority separation

The UFLS controller may request disconnection of configured load blocks and create events. It may not directly alter:

- diesel output;
- BESS output or SOC;
- frequency state;
- generator commitment;
- forecast values.

The physical simulation responds to the reduced connected load on subsequent simulation steps.

### 5. Restoration

Automatic restoration is not part of the initial UFLS implementation. A restoration controller must separately verify:

- recovered and stable frequency;
- adequate spinning and duration-qualified reserve;
- minimum post-shed hold time;
- staged reconnection limits;
- no immediate re-trigger risk.

### 6. Protection-setting limitation

Default frequency thresholds and delays are screening assumptions only. They are not relay settings and must not be presented as approved project protection values. Project implementation requires protection coordination, generator capability, motor behavior, process constraints, and applicable code review.

### 7. Traceability

Each UFLS operation must record:

- stage;
- threshold and delay;
- operating frequency;
- pre-shed deficit;
- load block and MW;
- criticality;
- operation time.

## Consequences

- Reliability KPIs no longer conflate transient mismatch with customer energy not served.
- Load-shedding recommendations can be audited against explicit priorities.
- Critical-load interruption is visible rather than hidden inside an aggregate load reduction.
- Future restoration and process-restart logic can be added without changing UFLS authority.

## Validation

Regression tests must verify at least:

1. definite-time delay and timer reset;
2. noncritical priority before critical load;
3. explicit event evidence for every operation;
4. EENS accumulation only after explicit shedding;
5. restoration remains blocked until configured recovery conditions are met.
