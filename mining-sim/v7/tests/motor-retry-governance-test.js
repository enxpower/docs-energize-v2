import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { MotorRetryGovernance, MOTOR_RECOVERY_STATE } from '../controls/motor-retry-governance.js';
import { MotorScheduledSimulationEngine } from '../core/motor-scheduled-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeQueue() {
  const controller = new MotorStartController({
    minimumStartFrequencyHz: 59.4,
    minimumPostStartReserveMW: 0.2,
    minimumStartIntervalSeconds: 0,
  });
  return new MotorStartScheduler({ controller, retryDelaySeconds: 0, maximumAttempts: 20 });
}

export function testAutomaticMotorRetryIsRequeued() {
  const motor = new MotorLoad({ id: 'AUTO-PUMP', ratedMW: 0.5, minimumOffSeconds: 0 });
  const scheduler = makeQueue();
  const governance = new MotorRetryGovernance({ retryDelaySeconds: 10, maximumAutomaticRetries: 2 });
  motor.fail('LOW_FREQUENCY_DURING_START');
  const scheduled = governance.handleFailure({ motor, timeSeconds: 5, requestPriority: 3 });
  assert(scheduled.type === 'MOTOR_RETRY_SCHEDULED', `unexpected event: ${scheduled.type}`);
  assert(governance.evaluate({ timeSeconds: 14.9, scheduler }).length === 0, 'retry occurred before cooldown elapsed');
  const events = governance.evaluate({ timeSeconds: 15, scheduler });
  assert(events[0]?.type === 'MOTOR_AUTOMATIC_RETRY_QUEUED', 'automatic retry was not requeued');
  assert(motor.state === MOTOR_STATE.OFF, `motor was not reset to OFF: ${motor.state}`);
  const queued = scheduler.snapshot().find((request) => request.motorId === motor.id);
  assert(queued?.state === 'QUEUED', 'automatic retry did not enter scheduler queue');
  assert(queued.priority === 3, `retry priority was not preserved: ${queued.priority}`);

  return {
    name: 'Automatic motor retry waits and re-enters scheduler',
    status: 'PASS',
    metrics: { scheduled, retryEvent: events[0], queued },
  };
}

export function testMotorProtectionTripRequiresConfirmation() {
  const motor = new MotorLoad({ id: 'PROTECTED-CRUSHER', ratedMW: 0.8, minimumOffSeconds: 0 });
  const scheduler = makeQueue();
  const governance = new MotorRetryGovernance({ retryDelaySeconds: 1 });
  motor.fail('PROTECTION_TRIP');
  const required = governance.handleFailure({ motor, timeSeconds: 1, requestPriority: 4 });
  assert(required.type === 'MOTOR_OPERATOR_CONFIRMATION_REQUIRED', `unexpected event: ${required.type}`);
  assert(governance.evaluate({ timeSeconds: 100, scheduler }).length === 0, 'protection trip retried automatically');
  assert(scheduler.snapshot().length === 0, 'manual-confirmation fault entered queue automatically');
  const confirmed = governance.acknowledge({ motorId: motor.id, timeSeconds: 101, scheduler });
  assert(confirmed?.type === 'MOTOR_OPERATOR_RETRY_CONFIRMED', 'operator confirmation did not create retry request');
  assert(scheduler.snapshot()[0]?.state === 'QUEUED', 'confirmed retry did not enter queue');

  return {
    name: 'Protection-trip motor retry requires operator confirmation',
    status: 'PASS',
    metrics: { required, confirmed, queue: scheduler.snapshot() },
  };
}

export function testRepeatedMotorFailureLocksOut() {
  const motor = new MotorLoad({ id: 'REPEAT-FAIL-MOTOR', ratedMW: 0.4, minimumOffSeconds: 0 });
  const scheduler = makeQueue();
  const governance = new MotorRetryGovernance({
    retryDelaySeconds: 0,
    maximumAutomaticRetries: 1,
    lockoutAfterConsecutiveFailures: 3,
  });
  motor.fail('LOW_FREQUENCY_DURING_START');
  governance.handleFailure({ motor, timeSeconds: 0 });
  governance.evaluate({ timeSeconds: 0, scheduler });
  motor.fail('LOW_FREQUENCY_DURING_START');
  const locked = governance.handleFailure({ motor, timeSeconds: 1 });
  assert(locked.type === 'MOTOR_LOCKED_OUT', `repeated failure did not lock out: ${locked.type}`);
  assert(governance.snapshot()[0].state === MOTOR_RECOVERY_STATE.LOCKED_OUT, 'lockout state not exposed');
  const reset = governance.resetLockout({ motorId: motor.id, timeSeconds: 2 });
  assert(reset?.type === 'MOTOR_LOCKOUT_RESET', 'manual lockout reset failed');
  assert(governance.snapshot()[0].state === MOTOR_RECOVERY_STATE.READY, 'lockout reset did not restore READY state');

  return {
    name: 'Repeated motor start failure locks equipment out',
    status: 'PASS',
    metrics: { locked, reset, recovery: governance.snapshot()[0] },
  };
}

function createIntegratedRetryEngine() {
  const motor = new MotorLoad({
    id: 'RETRY-FAN',
    ratedMW: 0.3,
    startMode: MOTOR_START_MODE.VFD,
    accelerationSeconds: 1,
    minimumOffSeconds: 0,
    abortFrequencyHz: 60.1,
    abortDelaySeconds: 0.2,
  });
  const motorBank = new MotorLoadBank({ motors: [motor] });
  const load = new AggregateLoad({ baseMW: 4, dynamicLoads: [motorBank] });
  const dieselFleet = createDieselFleet([
    { ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
  ]);
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = 2;
    dg.governorCommandMW = 2;
    dg.mechanicalMW = 2;
    dg.outputMW = 2;
  }
  const bess = new Bess({ powerMW: 4, energyMWh: 8, initialSoc: 0.6, rampMWPerS: 4 });
  const controller = new MotorStartController({ minimumStartIntervalSeconds: 0, minimumPostStartReserveMW: 0.2 });
  const scheduler = new MotorStartScheduler({ controller, retryDelaySeconds: 0.1, maximumAttempts: 20 });
  const governance = new MotorRetryGovernance({ retryDelaySeconds: 0.5, maximumAutomaticRetries: 2 });
  const engine = new MotorScheduledSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 6.6,
    load,
    dieselFleet,
    bess,
    motorBank,
    motorStartScheduler: scheduler,
    motorRetryGovernance: governance,
  });
  return { engine, motor, governance };
}

export function testIntegratedMotorRecoveryEvidence() {
  const { engine, motor } = createIntegratedRetryEngine();
  engine.requestMotorStart({ motorId: motor.id, priority: 2, deadlineSeconds: 20 });
  engine.start();
  for (let i = 0; i < 10; i += 1) engine.step();
  assert(engine.events.some((event) => event.type === 'MOTOR_RETRY_SCHEDULED'), 'integrated failure did not schedule retry');
  let sample = engine.history.at(-1);
  const recovery = sample.motorRecovery.find((record) => record.motorId === motor.id);
  assert(recovery?.state === MOTOR_RECOVERY_STATE.WAITING_RETRY, `recovery state not exposed: ${recovery?.state}`);

  motor.abortFrequencyHz = 58;
  for (let i = 0; i < 30; i += 1) sample = engine.step();
  assert(engine.events.some((event) => event.type === 'MOTOR_AUTOMATIC_RETRY_QUEUED'), 'automatic retry queue event missing');
  assert(engine.events.some((event) => event.type === 'MOTOR_START_COMPLETED'), 'retried motor did not complete start');
  assert(motor.state === MOTOR_STATE.RUNNING, `retried motor not RUNNING: ${motor.state}`);
  assert(sample.motorRecovery[0].state === MOTOR_RECOVERY_STATE.READY, 'successful retry did not clear recovery state');

  return {
    name: 'Integrated motor retry produces complete recovery evidence',
    status: 'PASS',
    metrics: {
      finalState: motor.state,
      recovery: sample.motorRecovery[0],
      recoveryEvents: engine.events.filter((event) => event.type.includes('RETRY') || event.type.includes('RECOVERY')),
    },
  };
}
