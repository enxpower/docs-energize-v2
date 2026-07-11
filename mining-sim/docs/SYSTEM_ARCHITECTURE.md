# SYSTEM ARCHITECTURE

## 1. Architecture Objective

V7 must separate engineering truth from presentation. The core must be reusable across mine, port, industrial, and microgrid scenarios without rewriting physical logic.

## 2. Layered Architecture

### Layer 1 — Scenario

Defines external context:

- off-grid / grid-connected / islandable;
- mine / port / processing / smelter;
- coastal / desert / tropical / high-altitude / cold climate;
- weather resource profiles;
- production schedule;
- grid strength and availability;
- environmental derating assumptions.

Scenario data does not directly alter equipment state. It supplies conditions and parameters.

### Layer 2 — System Configuration

Defines topology and installed assets:

- source types and quantities;
- ratings;
- network connection points;
- critical and noncritical loads;
- reserve requirements;
- charging infrastructure;
- operating constraints.

### Layer 3 — Equipment Models

Each asset exposes a common engineering interface:

- identity;
- configuration;
- state;
- command;
- measurement;
- capability;
- limits;
- faults;
- events.

Required initial equipment classes:

- Grid
- DieselGenerator
- BESS
- PCS
- PVPlant
- WindPlant
- ProcessLoad
- MotorLoad
- Transformer
- Feeder
- Breaker
- Charger

### Layer 4 — Physics

Owns physical equations and conservation laws:

- power balance;
- energy balance;
- frequency dynamics;
- voltage/network approximation;
- losses;
- fuel consumption;
- battery SOC and efficiency;
- environmental derating.

Physics receives equipment outputs and network conditions. It does not know about UI.

### Layer 5 — Control and Protection

Controls:

- EMS dispatch;
- unit commitment;
- governor;
- AVR;
- BESS GFM/GFL control;
- PV/Wind curtailment;
- charging control;
- load management.

Protection:

- UFLS;
- over/under frequency;
- over/under voltage;
- RoCoF;
- reverse power;
- sync check;
- dead bus;
- breaker interlocks.

Protection is independent and may override control.

### Layer 6 — Simulation and Optimization

Contains:

- Energy Simulation Engine;
- Dynamic Simulation Engine;
- Scenario Runner;
- Comparison Engine;
- Rule Engine;
- Optimization Engine;
- Monte Carlo Runner.

### Layer 7 — UI and Reporting

Responsible only for:

- data entry;
- scenario selection;
- configuration editing;
- control-strategy editing;
- visualization;
- comparison;
- report generation.

The UI must never directly manipulate physics or device internal state.

## 3. Simulation Domains

### Energy Domain

Typical time step: 1 s to 15 min depending on study.

Typical horizon: 24 h, 7 d, 30 d, 8760 h.

Used for:

- fuel;
- dispatch;
- SOC;
- renewable utilization;
- curtailment;
- cycling;
- operating cost;
- unit commitment;
- charging schedules.

### Dynamic Domain

Typical time step: 20 ms to 500 ms for simplified RMS-style screening.

Typical horizon: 30 s to 300 s around an event.

Used for:

- generator trip;
- grid loss;
- motor start;
- load step;
- cloud transient;
- black-start sequence;
- frequency nadir;
- RoCoF;
- voltage dip;
- UFLS response.

Energy and dynamic simulations may exchange initial conditions but must not be conflated into one uncontrolled time-scale model.

## 4. Core Data Flow

`Scenario → Configuration → State Initialization → EMS Command → Local Controllers → Equipment Response → Physics → Measurements → Protection → State Update → KPI / Rules / Optimization → UI`

## 5. Required Directory Direction

```text
mining-sim/
  AGENTS.md
  docs/
  v7/
    core/
    physics/
    equipment/
    controls/
    protection/
    scenarios/
    rules/
    optimization/
    tests/
    ui/
```

V6.x remains in the existing root runtime until V7 passes release gates.

## 6. Boundary Rules

- No UI module imports equipment internals directly.
- No EMS module writes frequency, voltage, SOC, or breaker state directly.
- No equipment model decides system-level economic dispatch.
- No physics module decides commercial optimization.
- No optimization module bypasses engineering constraints.
- No protection module depends on UI state.

## 7. Extensibility

New scenarios should be added primarily through configuration and profiles. New equipment should implement the common equipment contract. New recommendations should be implemented through rules or optimization logic, not hard-coded UI text.
