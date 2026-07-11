import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { MotorScheduledSimulationEngine } from '../core/motor-scheduled-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createEngine({ baseMW = 8, motors, minimumStartIntervalSeconds = 3 } = {}) {
  const motorBank = new MotorLoadBank({ motors });
  const load = new AggregateLoad({ baseMW, dynamicLoads: [motorBank] });
  const dieselFleet = createDieselFleet([
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
  ]);
  const share = baseMW / dieselFleet.length;
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = share;
    dg.governorCommandMW = share;
    dg.mechanicalMW = share;
    dg.outputMW = share;
  }
  const bess = new Bess({ powerMW: 8, energyMWh: 20, initialSoc: 0.6, rampMWPerS: 8 });
  const controller = new MotorStartController({
    minimumStartFrequencyHz: 59.4,
    maximumResidualDeficitMW: 0.25,
    minimumPostStartReserveMW: 0.5,
    minimumStartIntervalSeconds,
    maximumConcurrentStarts: 1,
  });
  const scheduler = new MotorStartScheduler({ controller, retryDelaySeconds: 1, maximumAttempts: 20 });
  const engine = new MotorScheduledSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    motorBank,
    motorStartScheduler: scheduler,
    emsIntervalSeconds: 20,
  });
  return { engine, motorBank, scheduler };
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

export function testIntegratedMotorStartsAreStaggered() {
  const motors = [
    new MotorLoad({ id: 'CRUSHER', ratedMW: 0.5, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 2, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'SLURRY-PUMP', ratedMW: 0.4, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 2, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'VENT-FAN', ratedMW: 0.3, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 2, minimumOffSeconds: 0 }),
  ];
  const { engine } = createEngine({ motors });
  engine.requestMotorStart({ motorId: 'VENT-FAN', priority: 1, deadlineSeconds: 30 });
  engine.requestMotorStart({ motorId: 'SLURRY-PUMP', priority: 2, deadlineSeconds: 30 });
  engine.requestMotorStart({ motorId: 'CRUSHER', priority: 3, deadlineSeconds: 30 });
  engine.start();
  const last = runFor(engine, 15);

  const accepted = engine.events.filter((event) => event.type === 'MOTOR_START_ACCEPTED');
  const completed = engine.events.filter((event) => event.type === 'MOTOR_START_COMPLETED');
  assert(accepted.length === 3, `expected 3 accepted starts, received ${accepted.length}`);
  assert(completed.length === 3, `expected 3 completed starts, received ${completed.length}`);
  assert(accepted.map((event) => event.motorId).join(',') === 'CRUSHER,SLURRY-PUMP,VENT-FAN', `unexpected order: ${accepted.map((event) => event.motorId).join(',')}`);
  assert(accepted[1].timeSeconds - accepted[0].timeSeconds >= 3 - 1e-9, 'second motor was not staggered');
  assert(accepted[2].timeSeconds - accepted[1].timeSeconds >= 3 - 1e-9, 'third motor was not staggered');
  assert(last.runningMotorCount === 3, `expected 3 running motors, received ${last.runningMotorCount}`);
  assert(Math.abs(last.motorLoadMW - 1.2) < 1e-6, `unexpected settled motor load: ${last.motorLoadMW}`);

  return {
    name: 'Integrated motor starts are priority-ordered and staggered',
    status: 'PASS',
    metrics: {
      acceptedOrder: accepted.map((event) => event.motorId),
      acceptedTimes: accepted.map((event) => event.timeSeconds),
      completedCount: completed.length,
      settledMotorLoadMW: last.motorLoadMW,
    },
  };
}

export function testIntegratedMotorStartFailureIsTraceable() {
  const motor = new MotorLoad({
    id: 'FAULTED-PUMP',
    ratedMW: 0.4,
    startMode: MOTOR_START_MODE.VFD,
    accelerationSeconds: 5,
    minimumOffSeconds: 0,
    abortFrequencyHz: 60.1,
    abortDelaySeconds: 0.2,
  });
  const { engine } = createEngine({ motors: [motor], minimumStartIntervalSeconds: 0 });
  engine.requestMotorStart({ motorId: motor.id, priority: 1, deadlineSeconds: 10 });
  engine.start();
  runFor(engine, 2);

  const accepted = engine.events.find((event) => event.type === 'MOTOR_START_ACCEPTED');
  const failed = engine.events.find((event) => event.type === 'MOTOR_START_FAILED');
  assert(accepted, 'motor start was not accepted');
  assert(failed, 'motor failure event was not recorded');
  assert(failed.failureReason === 'LOW_FREQUENCY_DURING_START', `unexpected failure reason: ${failed.failureReason}`);
  assert(motor.state === MOTOR_STATE.FAILED, `motor did not remain FAILED: ${motor.state}`);

  return {
    name: 'Integrated motor start failure is traceable',
    status: 'PASS',
    metrics: { accepted, failed, finalState: motor.state },
  };
}

export function testMotorQueueStateIsExposedInSamples() {
  const motor = new MotorLoad({ id: 'DELAYED-CONVEYOR', ratedMW: 0.3, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 2, minimumOffSeconds: 0 });
  const { engine } = createEngine({ motors: [motor] });
  engine.requestMotorStart({ motorId: motor.id, priority: 2, earliestStartSeconds: 5, deadlineSeconds: 20 });
  engine.start();
  const before = runFor(engine, 2);
  assert(before.motorStartQueue[0].state === 'QUEUED', `request not exposed as QUEUED: ${before.motorStartQueue[0].state}`);
  assert(before.startingMotorCount === 0, 'motor started before earliest start time');
  const after = runFor(engine, 5);
  assert(after.motorStartQueue[0].state === 'STARTED', `request not exposed as STARTED: ${after.motorStartQueue[0].state}`);
  assert(engine.events.some((event) => event.type === 'MOTOR_START_ACCEPTED'), 'accepted event missing');

  return {
    name: 'Motor queue state is exposed in simulation samples',
    status: 'PASS',
    metrics: { beforeQueue: before.motorStartQueue, afterQueue: after.motorStartQueue },
  };
}
