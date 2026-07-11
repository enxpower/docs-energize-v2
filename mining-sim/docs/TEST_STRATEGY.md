# TEST STRATEGY

## 1. Purpose

The simulator must be validated through deterministic tests and scenario regression, not by visual impression alone.

## 2. Test Layers

### Unit Tests

Test isolated equations and state transitions:

- power balance;
- SOC update;
- efficiency direction;
- governor droop;
- ramp limits;
- state-machine transitions;
- protection pickup / delay / reset;
- P-Q capability;
- rule triggers.

### Component Tests

Test complete equipment behavior:

- diesel start, sync, run, stop;
- BESS charge/discharge and SOC limits;
- PV availability vs actual output;
- wind power-curve behavior;
- motor-start permit and transient;
- breaker transitions.

### Integration Tests

Test interactions:

- DG + BESS + Load;
- Grid + BESS + Load;
- DG + PV + BESS + Load;
- island transition;
- black start;
- EMS + protection interaction.

### Scenario Regression Tests

Minimum mandatory scenarios:

1. Base Off-Grid
2. Base Grid-Connected
3. Islandable Hybrid
4. Largest DG Trip
5. Grid Loss
6. PV Cloud / Renewable Ramp
7. Large Motor Start
8. Low SOC
9. High SOC / Renewable Surplus
10. Black Start
11. Generation N-1 Failure

## 3. Mandatory Invariants

Every applicable run must verify:

- power-balance residual within tolerance;
- SOC within physical hard limits;
- energy conservation within tolerance;
- no NaN or Infinity;
- no impossible breaker state;
- no equipment output above active capability unless a documented short-time overload model is active;
- no protection action before pickup and delay conditions are satisfied;
- no state transition without valid trigger.

## 4. Example Acceptance Criteria

### Base Off-Grid

PASS if:

- simulation completes;
- no blackout;
- power-balance residual remains within configured tolerance;
- SOC remains within hard limits;
- frequency remains within the scenario screening band;
- no unexplained protection operation.

### Largest DG Trip

Example screening criteria, scenario-configurable:

- no numerical instability;
- event is recorded;
- lost generation matches tripped unit output;
- BESS fast response occurs within modeled response time;
- governor response follows;
- frequency nadir recorded;
- UFLS behavior matches thresholds and delays;
- post-event recovery reaches a stable state or explicitly fails.

### Motor Start

PASS if:

- start request is separated from start permit;
- reserve and bus checks execute;
- transient follows configured start method;
- voltage minimum is recorded;
- start completes or fails through state logic;
- no one-step artificial spike bypasses the equipment model.

### Grid Loss

PASS if:

- PCC state changes explicitly;
- islanding permission is checked;
- GFM source availability is checked;
- system transitions through island-transition state;
- success or blackout outcome is explicit;
- no grid power remains after confirmed PCC opening.

## 5. Baseline Comparison Discipline

Economic comparisons must use a defined baseline with the same:

- load profile;
- simulation horizon;
- reliability requirement;
- reserve requirement;
- EENS treatment;
- environmental assumptions.

## 6. Golden Results

For stable releases, store expected KPI ranges rather than exact floating-point traces where appropriate.

Example:

```text
scenario: base-offgrid-v1
fuel_L: 45,000–48,000
final_SOC_pct: 52–62
EENS_MWh: <= 0.05
max_power_residual_MW: <= 0.05
```

Any change outside approved range requires engineering review.

## 7. Model-Change Regression Matrix

A change to:

- diesel model → rerun all scenarios containing DG;
- BESS model → rerun all BESS scenarios;
- frequency model → rerun all island and transition scenarios;
- voltage model → rerun motor-start and reactive-support scenarios;
- protection → rerun every affected protection event;
- KPI definition → compare historical outputs and document non-comparability.

## 8. Release Gates

### P0 Gate

No release with:

- syntax/runtime failure;
- persistent unexplained power imbalance;
- invalid SOC behavior;
- impossible state transition;
- hidden numerical instability;
- broken mandatory scenario.

### Engineering Release Gate

Requires:

- all mandatory regression scenarios executed;
- failures reviewed;
- known limitations documented;
- model version updated if theory changed.

## 9. UI Tests

The interface must also verify:

- desktop, tablet, and mobile layouts;
- no horizontal page overflow;
- controls clearly show enabled, disabled, active, completed, and fault states;
- exported metadata matches the running model version;
- charts do not resize recursively;
- social preview metadata and favicon remain valid.

## 10. Future Automation

V7 should include a test runner that returns structured results:

```text
PASS / FAIL
scenario
criterion
measured value
required value
model version
```

A screenshot may reveal a problem, but screenshots are not the acceptance test.
