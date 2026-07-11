import { AggregateLoad } from '../equipment/load.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { createBaseOffgridScenario } from '../scenarios/base-offgrid.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function testMotorStartModePickupHierarchy() {
  const dol = new MotorLoad({ id: 'DOL', ratedMW: 1, startMode: MOTOR_START_MODE.DOL, minimumOffSeconds: 0 });
  const soft = new MotorLoad({ id: 'SOFT', ratedMW: 1, startMode: MOTOR_START_MODE.SOFT_STARTER, minimumOffSeconds: 0 });
  const vfd = new MotorLoad({ id: 'VFD', ratedMW: 1, startMode: MOTOR_START_MODE.VFD, minimumOffSeconds: 0 });

  assert(dol.initialPickupMW > soft.initialPickupMW, 'DOL pickup should exceed soft-starter pickup');
  assert(soft.initialPickupMW > vfd.initialPickupMW, 'soft-starter pickup should exceed VFD pickup');
  assert(vfd.initialPickupMW >= vfd.ratedMW, 'VFD pickup cannot be below rated MW in the default screening profile');

  return {
    name: 'Motor start-mode pickup hierarchy',
    status: 'PASS',
    metrics: {
      dolPickupMW: dol.initialPickupMW,
      softStarterPickupMW: soft.initialPickupMW,
      vfdPickupMW: vfd.initialPickupMW,
    },
  };
}

export function testMotorStartPermissiveAndReserveGate() {
  const motor = new MotorLoad({ id: 'CRUSHER-MOTOR', ratedMW: 1.5, startMode: MOTOR_START_MODE.VFD, minimumOffSeconds: 0 });
  const bank = new MotorLoadBank({ motors: [motor] });
  const controller = new MotorStartController({
    minimumStartFrequencyHz: 59.5,
    minimumPostStartReserveMW: 0.5,
    minimumStartIntervalSeconds: 0,
  });

  const blockedReserve = controller.requestStart({
    motor,
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 1.0,
    timeSeconds: 0,
  });
  assert(blockedReserve.type === 'MOTOR_START_BLOCKED', 'insufficient reserve did not block motor start');
  assert(blockedReserve.reasons.includes('INSUFFICIENT_60_SECOND_RESERVE'), 'reserve rejection reason missing');

  const blockedFrequency = controller.requestStart({
    motor,
    motorBank: bank,
    frequencyHz: 59.2,
    residualMW: 0,
    reserve60MW: 4,
    timeSeconds: 1,
  });
  assert(blockedFrequency.reasons.includes('FREQUENCY_BELOW_START_PERMISSIVE'), 'low-frequency rejection reason missing');

  const accepted = controller.requestStart({
    motor,
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 4,
    timeSeconds: 2,
  });
  assert(accepted.type === 'MOTOR_START_ACCEPTED', `motor start was not accepted: ${accepted.type}`);
  assert(motor.state === MOTOR_STATE.STARTING, `motor did not enter STARTING: ${motor.state}`);

  return {
    name: 'Motor start permissive and reserve gate',
    status: 'PASS',
    metrics: { blockedReserve, blockedFrequency, accepted },
  };
}

export function testMotorLowFrequencyAbort() {
  const motor = new MotorLoad({
    id: 'PUMP-MOTOR',
    ratedMW: 1,
    startMode: MOTOR_START_MODE.SOFT_STARTER,
    minimumOffSeconds: 0,
    abortFrequencyHz: 58.5,
    abortDelaySeconds: 0.3,
  });
  assert(motor.requestStart(0), 'motor start request failed');
  motor.step(0.1, { frequencyHz: 58.0 });
  motor.step(0.1, { frequencyHz: 58.0 });
  motor.step(0.1, { frequencyHz: 58.0 });

  assert(motor.state === MOTOR_STATE.FAILED, `motor did not fail after sustained low frequency: ${motor.state}`);
  assert(motor.outputMW === 0, 'failed motor still consumes start power');
  assert(motor.lastFailureReason === 'LOW_FREQUENCY_DURING_START', `unexpected failure reason: ${motor.lastFailureReason}`);

  return {
    name: 'Motor start low-frequency abort',
    status: 'PASS',
    metrics: { finalState: motor.state, failureReason: motor.lastFailureReason, outputMW: motor.outputMW },
  };
}

export function testMotorDynamicLoadIntegration() {
  const motor = new MotorLoad({
    id: 'VENT-FAN',
    ratedMW: 1,
    startMode: MOTOR_START_MODE.VFD,
    minimumOffSeconds: 0,
    accelerationSeconds: 2,
  });
  const bank = new MotorLoadBank({ motors: [motor] });
  const load = new AggregateLoad({ baseMW: 5, dynamicLoads: [bank] });

  assert(motor.requestStart(0), 'motor start request failed');
  const firstLoadMW = load.step(0.1, { frequencyHz: 60 });
  for (let i = 0; i < 20; i += 1) load.step(0.1, { frequencyHz: 60 });
  const finalLoadMW = load.actualMW;

  assert(firstLoadMW > 6, `initial motor pickup did not enter aggregate load: ${firstLoadMW}`);
  assert(Math.abs(finalLoadMW - 6) < 1e-6, `motor did not settle at rated aggregate load: ${finalLoadMW}`);
  assert(motor.state === MOTOR_STATE.RUNNING, `motor did not reach RUNNING: ${motor.state}`);

  return {
    name: 'Motor dynamic-load integration',
    status: 'PASS',
    metrics: { firstLoadMW, finalLoadMW, motorState: motor.state },
  };
}

export function testMotorReceivesSimulationFrequency() {
  const engine = createBaseOffgridScenario();
  const motor = new MotorLoad({
    id: 'SYSTEM-PUMP',
    ratedMW: 0.5,
    startMode: MOTOR_START_MODE.VFD,
    minimumOffSeconds: 0,
    abortFrequencyHz: 58.5,
    abortDelaySeconds: 0.3,
    accelerationSeconds: 5,
  });
  const bank = new MotorLoadBank({ motors: [motor] });
  engine.load.attachDynamicLoad(bank);
  assert(motor.requestStart(0), 'system motor start request failed');

  engine.frequencyHz = 58.0;
  engine.start();
  let final;
  for (let i = 0; i < 3; i += 1) {
    engine.frequencyHz = 58.0;
    final = engine.step();
  }

  assert(final.loadStepContextFrequencyHz === 58.0, `load step did not receive system frequency: ${final.loadStepContextFrequencyHz}`);
  assert(motor.state === MOTOR_STATE.FAILED, `system-integrated motor did not abort at low frequency: ${motor.state}`);
  assert(motor.lastFailureReason === 'LOW_FREQUENCY_DURING_START', `unexpected system failure reason: ${motor.lastFailureReason}`);

  return {
    name: 'Motor receives simulation frequency context',
    status: 'PASS',
    metrics: {
      loadStepContextFrequencyHz: final.loadStepContextFrequencyHz,
      motorState: motor.state,
      failureReason: motor.lastFailureReason,
    },
  };
}
