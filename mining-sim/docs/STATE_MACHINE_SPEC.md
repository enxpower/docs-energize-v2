# STATE MACHINE SPECIFICATION

## 1. Principle

Every material asset and the overall power system must evolve through explicit states. Direct state mutation outside the owning state machine is prohibited.

Each transition must define:

- source state;
- destination state;
- trigger;
- permissives;
- transition action;
- timeout;
- failure state;
- recovery path.

## 2. System-Level States

Recommended initial system states:

- OFF
- INITIALIZING
- GRID_CONNECTED
- ISLAND_TRANSITION
- ISLAND_STABLE
- DEGRADED
- BLACK_START
- RECOVERY
- PROTECTIVE_TRIP
- BLACKOUT

### Example: Grid Loss

`GRID_CONNECTED → ISLAND_TRANSITION`

Required permissives:

- islanding enabled;
- PCC open confirmed;
- GFM source available;
- sufficient fast reserve;
- control power available.

Successful outcome:

`ISLAND_TRANSITION → ISLAND_STABLE`

Failure outcome:

`ISLAND_TRANSITION → BLACKOUT` or `PROTECTIVE_TRIP`

## 3. Diesel Generator States

- OFF
- PRELUBE
- CRANK
- FIRE
- WARMUP
- READY_TO_SYNC
- SYNCHRONIZING
- RUNNING
- COOLDOWN
- LOCKOUT
- FAULT

Minimum transition controls:

- minimum down time;
- start permissive;
- start timeout;
- warm-up duration;
- sync permissive;
- minimum run time;
- cooldown;
- restart lockout after trip where applicable.

The generator is not considered online until synchronized and breaker-closed state is confirmed.

## 4. BESS / PCS States

- OFF
- INIT
- STANDBY
- GRID_FOLLOWING
- GRID_FORMING
- CHARGING
- DISCHARGING
- LIMITED
- FAULT
- RECOVERY

State must reflect operating role, not only power sign.

Examples:

- `GRID_FORMING` may have positive, zero, or negative active power while regulating voltage/frequency.
- `LIMITED` means a capability constraint is active: SOC, thermal, current, voltage, or apparent-power limit.

## 5. PV Plant States

- NIGHT
- INIT
- AVAILABLE
- MPPT
- CURTAILED
- FREQUENCY_SUPPORT
- FAULT
- RECOVERY

## 6. Wind Plant States

- BELOW_CUT_IN
- MPPT
- RATED
- CURTAILED
- FREQUENCY_SUPPORT
- ABOVE_CUT_OUT
- FAULT
- RECOVERY

## 7. Breaker States

- OPEN
- CLOSING
- CLOSED
- OPENING
- TRIPPED
- LOCKOUT

Breaker state must not be inferred solely from power flow.

## 8. Large Motor States

- STOPPED
- START_REQUESTED
- START_PERMISSIVE_WAIT
- STARTING
- RUNNING
- FAILED_START
- TRIPPED

The motor-start transient begins only after `START_PERMISSIVE_WAIT → STARTING`.

## 9. Black Start Sequence

Recommended initial sequence:

1. BLACKOUT
2. DC/UPS AVAILABLE
3. BESS AUXILIARIES READY
4. GFM SOURCE ENABLED
5. DEAD BUS CHECK
6. MAIN BUS ENERGIZED
7. ESSENTIAL AUXILIARIES RESTORED
8. DG START REQUEST
9. DG WARMUP
10. DG SYNCHRONIZE
11. CRITICAL LOAD RESTORE
12. NONCRITICAL LOAD RESTORE
13. ISLAND_STABLE

Each stage must have permissives, timeout, and failure handling.

## 10. Fault and Recovery

Fault state is distinct from transient disturbance.

A fault transition must record:

- initiating event;
- protection function;
- tripped device;
- timestamp;
- latched / auto-reset behavior;
- recovery permissives.

## 11. State Ownership

- System coordinator owns system state.
- Equipment model owns equipment state.
- Protection may request or force trip transitions.
- EMS may request operating transitions but may not directly force physical completion.
- UI may request commands but cannot set state directly.

## 12. Event Log Requirements

State transitions must produce structured events with:

- event type;
- previous state;
- new state;
- trigger;
- timestamp;
- cause code;
- related asset ID.
