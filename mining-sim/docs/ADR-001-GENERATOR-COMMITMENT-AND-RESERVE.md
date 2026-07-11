# ADR-001 — Generator Commitment and Reserve Architecture

Status: Accepted

## Context

A microgrid EMS must distinguish three different decisions:

1. **Unit commitment** — which generators should be OFF, STARTING, WARMUP, RUNNING, COOLDOWN, or TRIPPED.
2. **Economic / supervisory dispatch** — what steady-state MW setpoint should each synchronized unit carry.
3. **Primary response** — how an already-online governor changes mechanical power in response to frequency deviation.

These decisions operate on different time scales and have different safety consequences. Combining them in one `step()` function creates hidden coupling, repeated start requests, unrealistic instant starts, and false N-1 claims.

## Decision

V7 separates the responsibilities as follows:

### Equipment state machine

Each diesel generator owns its physical availability state:

`OFF -> STARTING -> WARMUP -> RUNNING -> COOLDOWN -> OFF`

`TRIPPED` is an independent fault state and requires an explicit reset path before restart.

The generator model owns:

- start delay;
- warmup time;
- cooldown time;
- minimum run time;
- minimum down time;
- synchronized / online status;
- EMS setpoint;
- governor response;
- mechanical power;
- actual electrical output.

### Generator commitment controller

The commitment controller decides whether a unit should be requested to START or STOP.

It does not directly set generator MW output and does not bypass equipment timing constraints.

Default safety policy:

- automatic START is allowed when enabled by the simulation engine;
- automatic STOP is disabled unless the scenario explicitly enables it;
- minimum online unit count is enforced;
- equipment startability and minimum run/down constraints remain authoritative.

### Reserve engine

Reserve assessment is independent from EMS dispatch.

It calculates at minimum:

- online rated capacity;
- online actual output;
- spinning headroom;
- BESS fast reserve;
- 10-second response capability;
- 60-second response capability;
- 10-minute / startable reserve;
- largest online contingency;
- N-1 status.

The largest online contingency is based on the actual MW being lost for dynamic screening, while rated MW is also retained as a separate engineering metric.

### N-1 screening classification

- `PASS`: fast reserve covers the largest online contingency.
- `CONDITIONAL`: fast reserve is insufficient, but the defined slower reserve horizon can cover the contingency.
- `FAIL`: available reserve cannot cover the contingency within the defined screening horizon.

This is a screening classification, not a substitute for detailed dynamic stability, protection, or reliability studies.

## Consequences

Positive:

- prevents repeated generator start requests;
- preserves physical start and synchronization delays;
- separates MW dispatch from availability decisions;
- makes reserve and N-1 claims traceable;
- supports future configuration optimization and scenario comparison.

Trade-offs:

- more state must be tracked;
- scenario initialization must explicitly define unit states;
- commitment tuning requires documented reserve policy;
- a PASS result remains scenario- and horizon-dependent.

## Governance Rule

No future implementation may:

- instantly change an OFF generator to full power;
- count an OFF or WARMUP generator as synchronized spinning reserve;
- count unavailable BESS power as fast reserve;
- claim N-1 security without identifying the contingency and response horizon;
- let UI code directly mutate generator physical state or output.
