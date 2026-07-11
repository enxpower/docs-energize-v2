# ENGINEERING MODEL SPECIFICATION

## 1. Purpose

This document defines the minimum engineering theory that V7 implementations must follow. Detailed equations may evolve, but sign conventions, model boundaries, and physical relationships must remain explicit and testable.

## 2. Global Sign Conventions

### Active Power

- Generation to the system: positive.
- Load consumption: positive demand.
- BESS power: positive = discharge, negative = charge.
- Grid power: positive = import, negative = export.

System balance:

`Pgrid + Pdg + Ppv + Pwind + Pbess - Pload - Ploss = Presidual`

Acceptance target for solved operating points:

`|Presidual| <= configured numerical tolerance`

### Reactive Power

- Positive Q injection supports bus voltage.
- Positive load Q is consumption.

## 3. Grid Model

### Grid-Connected Mode

The external grid is the frequency reference. Local active-power imbalance changes PCC import/export subject to capacity and contractual limits.

Local frequency must not be computed as a free island swing response while PCC remains connected to a stiff grid.

Required parameters may include:

- grid available state;
- PCC breaker state;
- import limit;
- export limit;
- grid strength / SCR for advanced models;
- grid voltage and frequency profile.

### Islanded Mode

Frequency is determined by power imbalance and dynamic response from:

- synchronous inertia;
- virtual inertia;
- load damping;
- governor response;
- BESS fast frequency response;
- secondary frequency restoration.

## 4. Diesel Generator Model

Minimum model elements:

- unit state machine;
- rated MW;
- minimum stable load;
- governor droop;
- governor deadband;
- fuel actuator / rack dynamics;
- prime-mover / turbo lag;
- asymmetric ramp limits;
- minimum run time;
- minimum down time;
- start delay;
- warm-up and synchronization states;
- spinning and non-spinning reserve;
- fuel-consumption curve;
- optional environmental derating.

The EMS provides setpoint and commitment intent. The governor and prime mover determine actual electrical output.

## 5. BESS / PCS Model

Minimum model elements:

- MW rating;
- MWh rating;
- SOC;
- charge/discharge efficiency;
- SOC operating range;
- reserve band;
- active-power ramp rate;
- apparent-power limit;
- P-Q capability;
- GFM/GFL operating mode;
- fast frequency response;
- droop;
- virtual inertia where enabled;
- thermal / availability derating when modeled.

SOC update must follow energy conservation.

For positive discharge power:

`dE/dt = -Pdischarge / eta_discharge`

For negative charging power:

`dE/dt = -Pcharge * eta_charge`

The controller must not command power beyond instantaneous SOC, MW, MWh, current, or apparent-power capability.

## 6. PV Model

Minimum model elements:

- installed AC capacity;
- available irradiance profile;
- cloud variability;
- temperature or environmental derating where enabled;
- ramp limit;
- curtailment;
- optional active reserve;
- inverter availability.

Separate:

- available power;
- commanded power;
- actual power;
- curtailed energy.

## 7. Wind Model

Minimum model elements:

- cut-in wind speed;
- power curve;
- rated region;
- cut-out wind speed;
- gust / turbulence profile;
- curtailment;
- optional active reserve and frequency support.

Separate available power from actual dispatched power.

## 8. Load Model

Mine load must not be represented only by a repeated sine wave.

Minimum load composition may include:

- continuous process load;
- crusher cycles;
- mill load;
- pumping load;
- conveyor load;
- shift effects;
- charging load;
- random production disturbance;
- large motor events;
- critical and noncritical load classes.

Each load class should define:

- active power;
- reactive power or power factor;
- priority;
- interruptibility;
- startup characteristics where relevant.

## 9. Motor-Start Model

A motor start must be a stateful event, not a one-step variable spike.

The minimum screening model should include:

- start request;
- start permission;
- reserve check;
- bus-voltage check;
- frequency check;
- start method: DOL / soft starter / VFD;
- active and reactive power transient profile;
- acceleration duration;
- completion or failed-start state.

## 10. Frequency Model

### Islanded Screening Equation

A simplified aggregate swing representation may be used for RMS-style screening:

`2 H_eq S_base / f0 * df/dt = Pimbalance - Pdumping - Pcontrol`

The implementation must define:

- base power;
- equivalent inertia;
- virtual inertia contribution;
- load damping;
- control contributions;
- numerical integration method.

RoCoF limits used for protection must not be used to artificially clamp the physical state.

## 11. Voltage Model

V7 initial releases may use an equivalent-bus or reduced-network RMS approximation, but the model must clearly state its scope.

A reduced network model should progressively include:

- source bus;
- process-load bus;
- transformer impedance;
- feeder R/X;
- active and reactive load;
- PCS reactive-power capability;
- generator reactive support.

A single-bus model must not be presented as a full-system voltage-compliance study.

## 12. Protection Model

Protection acts independently from EMS.

Minimum initial functions:

- under-frequency;
- over-frequency;
- UFLS;
- under-voltage;
- over-voltage;
- RoCoF;
- sync-check;
- dead-bus logic;
- breaker state and interlocks.

Every protection function must define:

- pickup;
- delay;
- reset;
- latching behavior;
- trip target;
- recovery requirement.

## 13. Fuel Model

Fuel calculation must be based on actual generator output and a documented SFC curve or manufacturer data.

Baseline comparisons must use:

- the same load profile;
- the same reliability requirement;
- the same reserve requirement;
- comparable EENS constraints.

## 14. KPI Definitions

Every KPI must have an explicit formula.

Minimum KPIs:

- Fuel Used
- Fuel Saved vs Defined Baseline
- Renewable Energy Available
- Renewable Energy Served
- Curtailment by Cause
- EENS by Cause
- Frequency Nadir / Zenith
- Peak RoCoF
- Voltage Minimum / Maximum
- BESS Throughput and Equivalent Cycles
- DG Run Hours and Starts
- Reserve Margin
- N-1 Screening Result
- Power-Balance Residual

## 15. Model Fidelity Labels

Each model must declare one of:

- Conceptual
- Screening
- RMS Approximation
- Detailed Engineering Interface

No output may imply greater fidelity than the underlying model.
