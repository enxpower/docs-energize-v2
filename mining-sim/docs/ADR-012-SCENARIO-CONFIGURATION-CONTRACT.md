# ADR-012: Scenario Configuration Contract

## Status
Accepted.

## Decision
Mine design scenarios are defined as versioned, JSON-serializable configuration objects. Configuration contains data only and must not contain executable functions.

The configuration pipeline is:

1. validate ids, ranges and references;
2. create fresh equipment and controller instances;
3. compile only approved disturbance types into executable actions;
4. run each scenario with an isolated engine;
5. preserve configuration version, model maturity and assumptions with the result.

## Required separation

- equipment parameters describe physical screening assumptions;
- control parameters describe deterministic policy settings;
- process parameters describe dependencies and priorities;
- economic parameters describe explicit valuation assumptions;
- disturbances describe scheduled events;
- decision constraints are applied after simulation.

## Safety rules

- unsupported action types are rejected;
- unknown equipment references are rejected before simulation;
- duplicate ids are rejected;
- scenarios in one comparison batch must use a common duration;
- configuration does not override equipment state machines, start permissives, protection governance or hard decision constraints.

## Model boundary

The configurator improves repeatability and usability. It does not increase model fidelity. Screening configurations remain screening models until calibrated with project and vendor data.
