# ADR-002 — Predictive Generator Commitment

Status: Accepted

## Context

Reactive generator commitment starts a unit only after current capacity or reserve becomes insufficient. In isolated and islandable microgrids, a diesel generator may require start delay and warmup time before it can synchronize and accept load. Waiting for the shortage to occur can make the start command physically too late.

## Decision

Predictive generator commitment shall be implemented as four separate responsibilities:

1. `forecast/` produces a time-indexed load forecast and forecast-window peak.
2. `controls/generator-commitment.js` compares current and forecast firm-capacity requirements with equipment availability.
3. The diesel equipment state machine determines actual start delay, warmup and readiness.
4. `reliability/reserve-engine.js` evaluates time-qualified contingency response.

The commitment controller shall not generate its own forecast and shall not bypass the equipment state machine.

## Required behavior

- A forecast capacity shortfall shall trigger a start request before the forecast load arrives.
- A start candidate shall expose `secondsUntilRunning`.
- The decision shall state whether the selected unit is predicted to be ready on time.
- If no unit can be ready within the forecast horizon, the controller shall still request the earliest feasible start and explicitly mark the result as late.
- BESS contribution to forecast firm capacity shall be duration-qualified. Instantaneous MW shall not be treated as unlimited-duration firm capacity.
- Automatic stop decisions must preserve both current and forecast firm-capacity margins.
- Forecast output, decision basis and readiness result must be retained in simulation history or events.

## Safety policy

Predictive start is allowed by default when enabled by the scenario. Predictive stop remains disabled by default until forecast uncertainty, minimum run/down constraints and N-1 preservation are fully validated.

## Consequences

The simulator can distinguish:

- adequate current capacity but inadequate future capacity;
- a unit that can be ready before the expected load increase;
- a unit that has been requested but will be late;
- current BESS power adequacy versus duration-qualified forecast support.

## Non-goals

The initial deterministic forecast interface is not a statistical forecasting model and does not claim probabilistic accuracy. Later implementations may consume mine production schedules, charging plans, weather forecasts or measured forecasting services without changing the commitment contract.
