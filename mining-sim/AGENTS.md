# Mining Sim — AI Engineering Operating Rules

This directory is governed as an engineering product, not as an ad-hoc webpage.

## Mandatory Review Before Any Change

Before coding, reviewing, commenting, changing architecture, tuning a model, or altering UI behavior, read in this order:

1. `docs/OWNER_INTENT.md`
2. `docs/PRODUCT_CONSTITUTION.md`
3. `docs/SYSTEM_ARCHITECTURE.md`
4. `docs/ENGINEERING_MODEL_SPEC.md`
5. `docs/CONTROL_PHILOSOPHY.md`
6. `docs/STATE_MACHINE_SPEC.md`
7. `docs/ENGINEERING_RULES.md`
8. `docs/TEST_STRATEGY.md`
9. `docs/ENGINEERING_GOVERNANCE.md`

If a required document is missing, stop implementation and report the gap.

## Authority Order

1. Owner Intent
2. Product Constitution
3. System Architecture
4. Engineering Model Specification
5. Control Philosophy
6. State Machine Specification
7. Engineering Rules
8. Test Strategy
9. Engineering Governance
10. Existing Code

Code never overrides governance. Implementation never overrides engineering theory.

## Non-Negotiable Rule

> Do not code to make the chart look right. Code the engineering model correctly, then let the chart reveal the result.

## Change Discipline

Every engineering change must state:

- what engineering principle changed;
- why the change is required;
- which model, controller, state machine, KPI, or rule is affected;
- which scenarios may change;
- which tests must be rerun;
- whether historical results become non-comparable.

## Prohibited Practices

- Directly changing physical state from the UI.
- Letting EMS bypass device controllers.
- Mixing grid-connected and islanded frequency physics.
- Hiding instability through arbitrary clamps.
- Tuning coefficients only to make curves visually attractive.
- Adding a KPI without a definition, units, source variables, and acceptance criteria.
- Adding an optimization recommendation without a traceable engineering rule or objective function.
- Shipping a model change without regression tests.

## V6 Status

V6.x is a legacy reference and live prototype. It may receive critical fixes, but new architecture and durable engineering capability belong in V7.

## V7 Principle

V7 must separate:

- scenario;
- system configuration;
- equipment models;
- physics;
- controls;
- protection;
- simulation;
- optimization;
- engineering rules;
- UI and reporting.

The UI is a client of the engineering core, never the owner of engineering logic.
