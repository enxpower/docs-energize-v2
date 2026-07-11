# PRODUCT CONSTITUTION

## 1. Mission

Mining Sim is a mine electrification and microgrid engineering decision-support platform for system configuration, operating strategy evaluation, dynamic risk screening, and option comparison.

It exists to help users reduce wrong CAPEX, fuel consumption, reliability risk, commissioning surprises, and avoidable redesign.

## 2. What the Product Is

The product is a pre-engineering and decision-support system that may support:

- configuration screening;
- scenario comparison;
- control strategy assessment;
- dynamic event screening;
- energy balance and dispatch analysis;
- engineering rule evaluation;
- optimization recommendations;
- preparation for later detailed studies.

## 3. What the Product Is Not

The product does not replace final:

- load-flow studies;
- short-circuit studies;
- protection coordination studies;
- EMT studies;
- harmonic studies;
- arc-flash studies;
- grounding studies;
- cable ampacity and voltage-drop design;
- transformer final sizing;
- OEM controller validation;
- formal utility interconnection studies;
- code compliance certification;
- guaranteed fuel savings, production, or payback.

## 4. Non-Negotiable Engineering Principles

1. Every power result must satisfy a defined power-balance equation within tolerance.
2. Every energy result must satisfy energy conservation and explicit efficiency assumptions.
3. Equipment state changes must occur through state machines.
4. EMS issues commands; it does not directly alter physical state.
5. Controllers act on commands and measurements; physics produces the resulting state.
6. Protection is independent from EMS and may override control.
7. Grid-connected, islanded, transition, and black-start modes must use distinct operating logic.
8. No instability may be hidden solely through arbitrary numerical clamps.
9. Every KPI must have a formal definition, units, source variables, and interpretation.
10. Every recommendation must be traceable to an engineering rule or optimization objective.
11. Model assumptions and limitations must be visible and versioned.
12. Changes to theory require regression testing and model-version traceability.

## 5. Product Decision Hierarchy

When objectives conflict, prioritize in this order:

1. Personnel and electrical safety
2. Protection and compliance
3. Production continuity and critical-load service
4. Dynamic stability and power quality
5. Reliability and reserve adequacy
6. Asset operating limits and equipment life
7. Fuel and energy cost reduction
8. Renewable-energy utilization
9. Capital efficiency
10. User-interface convenience

## 6. Truthfulness Standard

The product must distinguish among:

- measured data;
- user input;
- manufacturer data;
- engineering assumption;
- simplified model;
- inferred result;
- optimization recommendation.

These categories must never be presented as equivalent.

## 7. Configuration Before Optimization

The product must not optimize a technically invalid topology. The sequence is:

`Validate topology → Validate asset capability → Validate control feasibility → Simulate → Evaluate risk → Optimize`

## 8. Explainability

A user must be able to answer:

- Why did this result occur?
- Which constraint became active?
- Which controller acted?
- Which protection operated?
- Which assumption materially affected the answer?
- Why was a recommendation produced?

## 9. Versioning

Any change that affects equations, assumptions, state transitions, control hierarchy, KPI definitions, or recommendation logic requires a model-version increment and comparison note.

## 10. Release Gate

A release may not be considered engineering-valid unless:

- mandatory governance documents are current;
- required regression scenarios pass;
- known limitations are documented;
- no unresolved P0 model-integrity defect remains.
