import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { ProcessSequenceController } from '../controls/process-sequence.js';
import {
  ProcessRestartGovernance,
  PROCESS_TRIP_CLASS,
  PROCESS_RECOVERY_STATE,
} from '../controls/process-restart-governance.js';
import { ProcessSequencedSimulationEngine } from '../core/process-sequenced-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

function createGovernedEngine({ automaticRestartDelaySeconds = 1, stableConditionSeconds = 0.5, maximumAutomaticRestarts = 2 } = {}) {
  const motors = [
    new MotorLoad({ id: 'CONVEYOR', ratedMW: 0.25, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 0.5, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'CRUSHER', ratedMW: 0.30, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 0.5, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'SLURRY-PUMP', ratedMW: 0.25, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 0.5, minimumOffSeconds: 0 }),
  ];
  const motorBank = new MotorLoadBank({ motors });
  const load = new AggregateLoad({ baseMW: 6, dynamicLoads: [motorBank] });
  const dieselFleet = createDieselFleet([
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.8, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.8, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.8, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
  ]);
  const share = load.baseMW / dieselFleet.length;
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = share;
    dg.governorCommandMW = share;
    dg.mechanicalMW = share;
    dg.outputMW = share;
  }
  const bess = new Bess({ powerMW: 8, energyMWh: 20, initialSoc: 0.6, rampMWPerS: 8 });
  const startController = new MotorStartController({
    minimumStartFrequencyHz: 59.3,
    maximumResidualDeficitMW: 0.3,
    minimumPostStartReserveMW: 0.4,
    minimumStartIntervalSeconds: 0.5,
    maximumConcurrentStarts: 1,
  });
  const scheduler = new MotorStartScheduler({ controller: startController, retryDelaySeconds: 0.2, maximumAttempts: 30 });
  const process = new ProcessSequenceController({
    id: 'CRUSHING-LINE-RESTART',
    steps: [
      { id: 'conveyor', motorId: 'CONVEYOR', prerequisites: ['condition:lubrication', 'condition:cooling-water'], priority: 3 },
      { id: 'crusher', motorId: 'CRUSHER', prerequisites: ['step:conveyor'], priority: 2 },
      { id: 'slurry-pump', motorId: 'SLURRY-PUMP', prerequisites: ['step:conveyor'], priority: 1 },
    ],
  });
  const governance = new ProcessRestartGovernance({
    automaticRestartDelaySeconds,
    stableConditionSeconds,
    maximumAutomaticRestarts,
  });
  const engine = new ProcessSequencedSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    motorBank,
    motorStartScheduler: scheduler,
    processSequenceController: process,
    processRestartGovernance: governance,
    emsIntervalSeconds: 20,
  });
  engine.setProcessCondition('lubrication', true);
  engine.setProcessCondition('cooling-water', true);
  engine.start();
  return { engine, process, governance, motors };
}

function startAndReachRunning(engine, motors) {
  engine.requestProcessStart('TEST_START');
  runFor(engine, 6);
  assert(motors.every((motor) => motor.state === MOTOR_STATE.RUNNING), 'process did not reach running before trip');
}

export function testConditionHoldAutomaticallyRestartsProcess() {
  const { engine, governance, motors } = createGovernedEngine();
  startAndReachRunning(engine, motors);
  engine.setProcessCondition('cooling-water', false);
  engine.step();
  assert(governance.state === PROCESS_RECOVERY_STATE.AUTO_HOLD, `unexpected hold state: ${governance.state}`);
  engine.setProcessCondition('cooling-water', true);
  const last = runFor(engine, 7);
  assert(last.processState === 'RUNNING', `process did not automatically restart: ${last.processState}`);
  assert(engine.events.some((event) => event.type === 'PROCESS_RESTART_AUTHORIZED' && event.automatic), 'automatic restart authorization missing');
  assert(engine.events.some((event) => event.type === 'PROCESS_RESTART_COMPLETED'), 'restart completion evidence missing');

  return {
    name: 'Condition hold automatically restarts process after stable recovery',
    status: 'PASS',
    metrics: { recoveryState: governance.state, automaticRestartCount: governance.automaticRestartCount },
  };
}

export function testProtectionTripRequiresOperatorConfirmation() {
  const { engine, governance, motors } = createGovernedEngine();
  startAndReachRunning(engine, motors);
  engine.tripProcessSequence({ tripClass: PROCESS_TRIP_CLASS.PROTECTION_TRIP, reason: 'PROTECTION_TRIP:CRUSHER' });
  runFor(engine, 3);
  assert(governance.state === PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED, `protection trip did not require confirmation: ${governance.state}`);
  assert(!engine.events.some((event) => event.type === 'PROCESS_RESTART_AUTHORIZED'), 'protection trip restarted without confirmation');
  engine.confirmProcessRestart('SHIFT_SUPERVISOR_CONFIRMATION');
  const last = runFor(engine, 7);
  assert(last.processState === 'RUNNING', `confirmed protection restart did not complete: ${last.processState}`);
  assert(engine.events.some((event) => event.type === 'PROCESS_RESTART_OPERATOR_CONFIRMED'), 'operator confirmation event missing');

  return {
    name: 'Protection trip blocks restart until operator confirmation',
    status: 'PASS',
    metrics: { finalRecoveryState: governance.state, finalProcessState: last.processState },
  };
}

export function testEmergencyStopRequiresLockoutReset() {
  const { engine, governance, motors } = createGovernedEngine();
  startAndReachRunning(engine, motors);
  engine.tripProcessSequence({ tripClass: PROCESS_TRIP_CLASS.EMERGENCY_STOP, reason: 'EMERGENCY_STOP:FIELD_PULLCORD' });
  engine.confirmProcessRestart('OPERATOR_ACKNOWLEDGED');
  runFor(engine, 3);
  assert(governance.state === PROCESS_RECOVERY_STATE.LOCKED_OUT, `emergency stop confirmation improperly cleared lockout: ${governance.state}`);
  assert(!engine.events.some((event) => event.type === 'PROCESS_RESTART_AUTHORIZED'), 'emergency stop restarted without lockout reset');
  engine.resetProcessLockout('FIELD_INSPECTION_COMPLETE');
  const last = runFor(engine, 7);
  assert(last.processState === 'RUNNING', `lockout-reset process did not restart: ${last.processState}`);
  assert(engine.events.some((event) => event.type === 'PROCESS_RESTART_LOCKOUT_RESET'), 'lockout reset event missing');

  return {
    name: 'Emergency stop requires explicit lockout reset before restart',
    status: 'PASS',
    metrics: { finalRecoveryState: governance.state, finalProcessState: last.processState },
  };
}

export function testAutomaticRestartLimitEscalatesToOperator() {
  const governance = new ProcessRestartGovernance({
    automaticRestartDelaySeconds: 0,
    stableConditionSeconds: 0,
    maximumAutomaticRestarts: 1,
  });
  governance.handleTrip({ timeSeconds: 0, tripClass: PROCESS_TRIP_CLASS.CONDITION_HOLD, reason: 'CONDITION_LOST' });
  const first = governance.evaluate({ timeSeconds: 0, conditionsHealthy: true });
  assert(first?.type === 'PROCESS_RESTART_AUTHORIZED', 'first automatic restart was not authorized');
  governance.handleRestarted({ timeSeconds: 1 });
  governance.handleTrip({ timeSeconds: 2, tripClass: PROCESS_TRIP_CLASS.CONDITION_HOLD, reason: 'CONDITION_LOST_AGAIN' });
  const second = governance.evaluate({ timeSeconds: 2, conditionsHealthy: true });
  assert(second?.type === 'PROCESS_AUTOMATIC_RESTART_LIMIT_REACHED', `restart limit did not escalate: ${second?.type}`);
  assert(governance.state === PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED, `unexpected escalation state: ${governance.state}`);

  return {
    name: 'Automatic process restart limit escalates to operator confirmation',
    status: 'PASS',
    metrics: { automaticRestartCount: governance.automaticRestartCount, recoveryState: governance.state },
  };
}
