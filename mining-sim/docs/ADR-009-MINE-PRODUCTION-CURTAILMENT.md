# ADR-009 — Mine Production Curtailment

## Status
Accepted for V7 screening and operational simulation.

## Decision
Production curtailment is a deterministic supervisory layer ahead of emergency UFLS.

The authority chain is:

1. physical power balance and reserve assessment;
2. production curtailment controller;
3. process and motor permissives;
4. emergency UFLS if controlled production reduction is insufficient.

## Rules

- Safety-critical dewatering, ventilation and other declared safety loads are not automatically curtailed by this controller.
- Curtailment order is explicit and deterministic: lower production priority and lower production value are reduced first.
- Restoration order is the reverse business priority and must preserve post-restoration reserve.
- Continuous reduction is allowed only for loads explicitly configured as continuously curtailable.
- Non-continuous loads may move only between normal and minimum operating points.
- Production loss is accumulated separately from EENS.
- A production reduction is not an outage unless an explicitly unserved load is created by another protection layer.
- All actions create timestamped events and expose before/after MW targets.

## Model boundary
This is a Concept/Screening model. Actual minimum stable operating points, process throughput curves, equipment ramp rates and safety classifications require mine-operator and vendor confirmation.
