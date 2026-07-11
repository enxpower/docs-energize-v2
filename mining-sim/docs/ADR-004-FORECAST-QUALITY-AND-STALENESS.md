# ADR-004 — Forecast Quality and Staleness Governance

## Status

Accepted.

## Context

A load forecast can be numerically plausible while still being unsafe to use because it is stale, missing, manually estimated, or produced by a low-quality source. Forecast value, uncertainty, freshness, provenance, and quality are different engineering properties and must not be collapsed into one number.

## Decision

### 1. Forecast value and forecast quality are separate objects

The forecast layer produces load values and uncertainty envelopes. A separate quality-governance layer evaluates:

- source;
- generation time;
- validity window;
- age;
- quality grade;
- freshness status.

### 2. Standard forecast states

V7 uses the following states:

- `FRESH` — within validity window and quality grade A or B;
- `DEGRADED` — within validity window but quality grade C, D, or unknown;
- `STALE` — validity window expired;
- `MISSING` — no forecast payload;
- `INVALID` — malformed or non-finite forecast payload.

### 3. Automatic stop policy

Only a `FRESH` forecast with acceptable quality may permit normal automatic-stop evaluation.

`DEGRADED`, `STALE`, `MISSING`, and `INVALID` forecasts must block automatic generator decommitment.

This does not force a generator start by itself. It changes the planning load and removes permission for an aggressive stop decision.

### 4. Conservative fallback

When forecast quality is degraded, the commitment layer must use a deterministic conservative planning load:

- stale forecast: maximum of the stale planning value and current load plus stale margin;
- low-quality forecast: planning value plus grade-dependent quality margin;
- missing or invalid forecast: current load plus missing-data margin.

Margins are configuration parameters and must be visible in scenario configuration and test evidence.

### 5. Separation of authority

Forecast quality governance may:

- modify the planning load consumed by Generator Commitment;
- block automatic stop permission;
- create warnings, events, and traceability records.

It may not:

- directly start or stop a generator;
- directly alter generator output;
- directly alter frequency, SOC, or equipment state;
- silently replace measured load.

The authority chain remains:

`Forecast → Quality Governance → Commitment Decision → Equipment State Machine → EMS Dispatch → Governor → Physical Response`.

### 6. Traceability

Each commitment sample or event must expose, where available:

- forecast source;
- generated time;
- valid-until time;
- age;
- quality grade;
- quality status;
- effective planning load;
- whether automatic stop was blocked.

## Consequences

- The simulator cannot claim forecast-driven optimization without carrying forecast provenance and validity.
- Stale data produces a visible degraded mode rather than silent reuse.
- Economic decommitment becomes more conservative when forecast evidence is weak.
- Future real-data adapters can replace forecast sources without changing Generator Commitment logic.

## Validation

Regression tests must verify at least:

1. fresh A-grade forecast preserves normal commitment policy;
2. stale forecast blocks automatic decommitment and applies fallback margin;
3. low-quality forecast applies an additional conservative margin and blocks automatic stop.
