# CONTROL PHILOSOPHY

## 1. Principle

Control is hierarchical. No controller should fight another controller for the same variable on the same time scale.

The governing chain is:

`EMS → Local Controller → Equipment → Physics → Measurement → Protection`

EMS does not directly set frequency, voltage, SOC, breaker state, or actual equipment output.

## 2. Time-Scale Hierarchy

### Level 0 — Device Inner Control
Typical scale: milliseconds to sub-second.

Examples:

- PCS current loop;
- voltage loop;
- inverter current limiting;
- generator excitation inner response.

Usually represented by simplified capability and response limits in the screening model.

### Level 1 — Fast Frequency / Voltage Support
Typical scale: 0.1–2 s.

Examples:

- BESS fast frequency response;
- virtual inertia;
- GFM voltage/frequency support;
- fast reactive-power response.

### Level 2 — Primary Control
Typical scale: 1–30 s.

Examples:

- diesel governor droop;
- generator AVR response;
- renewable active-power reserve response.

### Level 3 — Secondary Restoration
Typical scale: 30 s–10 min.

Examples:

- frequency restoration to nominal;
- BESS dispatch recovery toward reserve target;
- generator setpoint redistribution.

### Level 4 — Supervisory EMS Dispatch
Typical scale: minutes to hours.

Examples:

- unit commitment;
- SOC target management;
- economic dispatch;
- renewable curtailment strategy;
- PCC peak limit;
- charging schedule;
- reserve scheduling.

## 3. Grid-Connected Philosophy

When PCC is closed and the grid is available:

- grid frequency is the reference;
- EMS manages PCC import/export, demand limit, tariff, reserve, and asset operating cost;
- BESS may perform peak shaving, zero-export, frequency support, or SOC management;
- diesel operation depends on selected strategy: standby, base load, economic dispatch, or resilience reserve.

Local generation must not create artificial island-frequency dynamics while grid-connected.

## 4. Islanded Philosophy

Priority order:

1. Maintain energized system safely.
2. Maintain frequency and voltage.
3. Protect critical load.
4. Maintain fast reserve.
5. Restore BESS reserve and frequency.
6. Optimize diesel loading and renewable utilization.

Typical division of responsibility:

- BESS/GFM source: fast balance and voltage/frequency support;
- diesel governor: primary sustained frequency response;
- EMS: secondary restoration, commitment, reserve, and energy balance;
- PV/Wind: maximum production unless curtailed for stability, minimum-load, SOC, or reserve constraints.

## 5. Transition Philosophy

Grid loss transition must verify:

- PCC breaker status;
- islanding permission;
- GFM source availability;
- sufficient SOC / fast reserve;
- critical-load priority;
- transition state before normal island control is enabled.

Reconnection must verify:

- utility available;
- voltage within limit;
- frequency within limit;
- phase-angle / sync-check criteria;
- breaker permissive;
- controlled transfer of power after closure.

## 6. BESS Control Priorities

BESS priorities must be configurable but deterministic.

Default island priority:

1. Protection and hardware limits
2. Grid-forming stability
3. Fast frequency response
4. Critical-load support
5. Reserve preservation
6. SOC recovery
7. Economic optimization

Default grid-connected priority:

1. Protection and hardware limits
2. PCC contractual limits
3. Peak shaving / zero export
4. Reserve requirement
5. SOC management
6. Economic optimization

## 7. Diesel Control Priorities

- obey protection and machine limits;
- respect minimum stable load;
- provide committed reserve;
- primary governor response around dispatched setpoint;
- avoid excessive starts and stops;
- respect minimum run and down times;
- avoid prolonged inefficient low-load operation where possible.

## 8. Renewable Control Priorities

Default objective is maximum useful renewable energy, subject to:

- system stability;
- BESS charge capability;
- diesel minimum-load constraints;
- reserve strategy;
- PCC export limits;
- equipment limits.

Curtailment must be attributed by cause.

## 9. Large Motor Start Philosophy

A start request becomes an allowed start only after checking:

- system state;
- frequency;
- voltage;
- fast reserve;
- spinning reserve where required;
- BESS availability;
- simultaneous-start lockout;
- start method.

If conditions fail, the start is deferred or blocked. The simulator must distinguish request, permit, active start, complete, and failed start.

## 10. Protection Supremacy

Protection may trip equipment regardless of EMS objective. EMS may not suppress a valid protection action for economic reasons.

## 11. Anti-Hunting Rule

Any controller or dispatcher that changes discrete commitment state must include hysteresis, dwell time, or equivalent anti-hunting logic.

## 12. Control Traceability

For each material action, the system should be able to report:

- controller name;
- trigger;
- command;
- active constraint;
- resulting equipment response;
- resulting KPI impact where applicable.
