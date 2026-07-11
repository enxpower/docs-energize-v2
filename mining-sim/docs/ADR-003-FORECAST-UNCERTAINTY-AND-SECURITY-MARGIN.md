# ADR-003 — Forecast Uncertainty and Security Margin

## Status
Accepted

## Context
A point forecast is not sufficient for secure generator commitment. A single P50 value can support economic planning, but it must not be treated as a guaranteed upper limit. Mine loads, motor starts, production schedules, weather-dependent auxiliaries, and telemetry quality introduce uncertainty.

## Decision
The V7 commitment architecture separates four values:

1. **P50 Forecast** — expected load used for reporting and economic reference.
2. **Forecast Error Band** — uncertainty expressed in MW or per-unit.
3. **Planning Upper Bound** — P50 plus forecast error.
4. **Security Margin** — an explicit additional engineering margin independent of forecast error.

The secure planning load is:

`Planning Load = P50 Forecast + Forecast Error + Security Margin`

Generator start and stop decisions shall use the Planning Load, not the P50 Forecast alone.

## Control Boundaries
- Forecast modules generate P50 and uncertainty envelopes.
- Commitment consumes the envelope and decides START / STOP / NO ACTION.
- Equipment state machines determine when requested capacity becomes physically available.
- Reserve Engine remains responsible for contingency response by time horizon.
- UI displays these values but does not invent or override them.

## Risk Classification
Forecast relative uncertainty is classified for screening:

- LOW: less than 7%
- MEDIUM: 7% to less than 15%
- HIGH: 15% or greater

These thresholds are screening defaults and must be configurable and validated for each project.

## Safety Rules
- Automatic stop is prohibited when remaining capacity covers P50 but not the Planning Load.
- A preventive start triggered only by uncertainty shall be marked `uncertaintyDriven=true`.
- Forecast uncertainty does not replace N-1 reserve requirements.
- Security Margin must not be silently embedded inside the forecast error band.
- Missing or stale forecast quality data must lead to conservative assumptions, not zero uncertainty.

## Consequences
The system may run additional generators compared with a deterministic P50-only strategy. This is intentional: fuel optimization cannot override adequacy and readiness requirements.

## Model Maturity
This implementation is a deterministic screening framework. It is not yet a probabilistic unit commitment optimizer and does not establish project-specific reliability without calibration and validation.
