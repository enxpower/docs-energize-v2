# ADR-005 — Forecast Source Failover and Recovery Governance

## Status

Accepted.

## Context

A production EMS may receive load forecasts from several sources, including machine-learning services, operating schedules, manually maintained plans, and current-load fallback logic. A source can become stale, unavailable, invalid, or low quality. Selecting the highest-priority configured source without health checks is unsafe, while switching immediately back to a recovered primary source can cause repeated source oscillation.

## Decision

### 1. Forecast sources are ordered but not blindly trusted

Each source has:

- a stable source identifier;
- a priority tier;
- a forecast provider;
- forecast provenance and quality metadata.

Priority is evaluated only among sources that pass forecast-quality eligibility checks.

### 2. Standard source chain

The intended hierarchy is:

1. primary operational forecast;
2. secondary operating or shift schedule;
3. current-load hold forecast;
4. conservative emergency fallback.

Projects may configure additional sources, but each source must use the same quality and traceability contract.

### 3. Failure behavior

If the active source becomes stale, missing, invalid, or otherwise ineligible, the source manager must immediately select the highest-priority eligible lower-tier source.

Failure-driven downgrade does not wait for the minimum hold timer.

### 4. Recovery behavior

A recovered higher-priority source must not immediately replace the active fallback source. Failback requires both:

- the active source minimum hold time to have elapsed;
- the recovered source to remain continuously eligible for the configured recovery-qualification time.

This hysteresis prevents source flapping and unstable commitment decisions.

### 5. Separation of authority

The source manager may:

- select which forecast payload is presented to forecast-quality governance;
- emit source-switch events;
- expose source tier, switch count, and selection reason.

It may not:

- directly start or stop generators;
- directly modify EMS setpoints;
- alter measured load;
- alter frequency, SOC, or physical equipment state.

The authority chain remains:

`Forecast Sources → Source Manager → Quality Governance → Commitment → Equipment State Machine → EMS Dispatch → Governor → Physical Response`.

### 6. Switch-event traceability

Every source change must record:

- event time;
- previous source;
- new source;
- source tier;
- reason;
- cumulative switch count.

Commitment samples must expose the active source, source tier, selection reason, and switch count.

### 7. No eligible source

If no source is eligible, the source manager returns an explicit no-source payload. Forecast-quality governance then applies the configured missing-data fallback policy and blocks automatic decommitment.

The system must never silently reuse an expired forecast as though it were current.

## Consequences

- Forecast failure produces deterministic degradation rather than undefined behavior.
- Primary-source recovery is deliberate and stable rather than immediate.
- Source switching can be audited independently from generator commitment actions.
- Current-load and emergency fallbacks remain conservative and visibly lower quality.

## Validation

Regression tests must verify at least:

1. active primary source failure causes immediate secondary-source selection;
2. recovered primary source does not fail back before hold and recovery timers are satisfied;
3. failure of primary, secondary, and hold sources selects the emergency fallback;
4. each actual switch produces exactly one source-switch event.
