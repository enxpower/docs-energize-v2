# ADR-008 — Motor Start and Large-Load Pickup

## Status

Accepted.

## Context

Large motors can dominate the short-duration active-power demand of an islanded mining microgrid. Crushers, slurry pumps, ventilation fans, conveyors, and process auxiliaries may be started direct-on-line, through a soft starter, or through a variable-frequency drive. Treating every start as a simple steady-state load step can materially understate reserve requirements and frequency risk.

## Decision

### 1. Motor starting is a separate equipment state

Each modeled motor has explicit states:

- `OFF`;
- `STARTING`;
- `RUNNING`;
- `FAILED`.

A start request does not instantly place the motor at its steady-state MW.

### 2. Starting method is explicit

V7 supports configurable screening profiles for:

- direct-on-line;
- soft starter;
- variable-frequency drive.

Each profile carries at least:

- rated MW;
- initial starting-power multiplier;
- acceleration duration;
- low-frequency abort threshold and delay;
- minimum off time.

Default profiles are engineering screening assumptions, not vendor-guaranteed curves.

### 3. Start permissives are independent of the motor model

The Motor Start Controller evaluates:

- system frequency;
- existing active-power deficit;
- duration-qualified reserve;
- required initial pickup MW;
- minimum post-start reserve;
- concurrent starts;
- minimum interval between starts.

The controller may accept or block a start request. It may not directly modify generator, BESS, or frequency states.

### 4. Motor demand enters the physical load balance

Starting and running motor MW must be included in aggregate connected load. A motor-start event that does not alter the physical power balance is invalid.

### 5. Failed starts are explicit

Sustained low frequency during acceleration may abort the start and move the motor to `FAILED`. Reset is explicit; automatic repeated restart is not permitted without a separate retry policy.

### 6. Model maturity

The current model is suitable for Concept and Screening work only. Project-specific validation may require:

- motor and driven-load torque-speed curves;
- voltage-dependent current and torque;
- transformer and cable impedance;
- voltage dip and reactive-power studies;
- generator subtransient capability;
- PCS overload and current limits;
- starter/VFD vendor data;
- protection coordination;
- process restart constraints.

## Validation

Regression tests must verify at least:

1. DOL, soft-starter, and VFD profiles remain distinguishable;
2. insufficient reserve blocks a start;
3. low frequency blocks or aborts a start;
4. starting MW enters aggregate system load;
5. acceleration converges to rated running MW.
