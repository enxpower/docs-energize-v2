# ADR-011 — Scenario Comparison and Decision Governance

## Status

Accepted for V7 screening and pre-FEED scenario comparison.

## Decision

Scenario alternatives shall be evaluated through a deterministic two-stage process:

1. hard engineering constraints;
2. weighted multi-objective ranking among compliant scenarios only.

A scenario that violates a hard safety or reliability constraint cannot be recommended because it has lower fuel cost, lower estimated capital cost, or higher production value.

## Comparison evidence

Every scenario comparison must use:

- a newly created simulation engine instance;
- the same simulation horizon;
- the same time-step basis unless explicitly documented;
- the same common disturbance schedule;
- the same KPI extraction rules;
- explicit scenario assumptions and changed parameters.

Scenario engines must not be reused between alternatives because internal state would contaminate results.

## Hard constraints

The configurable hard-constraint layer includes, at minimum:

- minimum frequency nadir;
- maximum absolute RoCoF;
- maximum EENS;
- minimum N-1 coverage ratio;
- prohibition of critical-load shedding unless explicitly authorized.

Rejected scenarios retain their violation evidence and remain visible in comparison output.

## Ranking

Compliant scenarios may be ranked using configurable weights for:

- reliability;
- production continuity;
- diesel operating cost;
- fuel consumption;
- estimated BESS diesel-fuel displacement value.

Weights do not override hard constraints.

## Pareto frontier

The comparison output shall identify non-dominated compliant scenarios. This preserves legitimate tradeoffs such as:

- lower operating cost versus higher N-1 margin;
- higher production continuity versus higher fuel use;
- larger BESS value versus higher assumed capital cost.

A single weighted recommendation does not erase the Pareto alternatives.

## Recommendation boundary

The recommendation is deterministic and evidence-based. It is not a final investment decision, protection study, financial model, or vendor guarantee.

If every scenario violates a hard constraint, the engine returns `NO_COMPLIANT_SCENARIO` rather than selecting the least-bad unsafe alternative.
