# ADR-013 — Mine Design Configurator UI

## Status

Accepted.

## Context

Mining Sim V7 now has a governed engineering core, a versioned JSON scenario contract, deterministic scenario execution, production and operating-economics evidence, and hard-constraint-first comparison. The next product layer must make those capabilities usable without editing JavaScript.

A UI that directly mutates simulation objects would create a second, ungoverned control path. A UI that maintains a separate validation system would also allow browser and test behavior to diverge.

## Decision

The configurator uses this authority chain:

```text
Engineering Form
→ Versioned Scenario JSON
→ Shared Scenario Validator
→ Scenario Factory
→ Fresh Simulation Engine
→ Batch Runner
→ KPI Extraction
→ Hard Constraints
→ Pareto / Weighted Ranking
```

The browser does not directly construct or mutate diesel generators, BESS, motors, process controllers, production loads, or decision results.

## UI scope

The first production UI supports:

- site and simulation basis;
- diesel fleet;
- BESS power, energy and SOC limits;
- large motors and startup methods;
- production and safety loads;
- process conditions and dependency steps;
- deterministic disturbance schedules;
- economic assumptions;
- hard engineering constraints and compliant-scenario weights;
- scenario duplication, import and export;
- single-scenario execution;
- multi-scenario comparison.

## Safety and decision rules

1. Invalid configuration blocks execution.
2. Scenario IDs must be unique.
3. Compared scenarios must use a common duration.
4. Every run creates a fresh engine instance.
5. Hard constraints are evaluated before weighted scoring.
6. A lower-cost but noncompliant scenario cannot be recommended.
7. UI labels must preserve model maturity and engineering limitations.
8. Screening results must not be presented as protection settings, vendor guarantees, final design, NPV or IRR.

## Testing

The Node and browser test registries remain shared. UI data functions are covered by regression tests for:

- deep scenario isolation;
- immutable nested updates;
- common-horizon enforcement;
- real-engine single and comparison runs.

CI also performs JavaScript syntax checks on browser UI modules before running the full V7 regression suite.

## Deployment

The existing V6 public simulator remains independent. V7 is exposed under:

```text
/mining-sim/v7/
/mining-sim/v7/ui/
/mining-sim/v7/tests/
```

V6 will not be replaced until V7 UI behavior, responsive layout and engineering workflows are separately accepted.
