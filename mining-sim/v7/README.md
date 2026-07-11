# Mining Sim V7 Engineering Core

V7 is the governed engineering core for mine power-system configuration, simulation, and optimization.

## Current scope

Phase 1 intentionally implements only:

- Diesel generator fleet
- BESS / PCS active-power model
- Aggregate mine load
- Power balance
- Island frequency dynamics
- EMS dispatch command layer
- System state machine
- Deterministic automated tests

No PV, wind, utility grid, motor starting, optimization, or production UI is added until the minimum core passes its regression suite.

## Authority

All work under this directory is governed by:

1. `../AGENTS.md`
2. `../docs/OWNER_INTENT.md`
3. `../docs/PRODUCT_CONSTITUTION.md`
4. `../docs/SYSTEM_ARCHITECTURE.md`
5. `../docs/ENGINEERING_MODEL_SPEC.md`
6. `../docs/CONTROL_PHILOSOPHY.md`
7. `../docs/STATE_MACHINE_SPEC.md`
8. `../docs/TEST_STRATEGY.md`
9. `../docs/ENGINEERING_GOVERNANCE.md`

## Non-negotiable rule

Do not tune code to make a chart look right. Implement the engineering model correctly and let the result reveal itself.
