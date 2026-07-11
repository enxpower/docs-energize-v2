import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { ProcessSequenceController, PROCESS_SEQUENCE_STATE } from '../controls/process-sequence.js';
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

function createProcessEngine() {
  const motors = [
    new MotorLoad({ id: 'CONVEYOR', ratedMW: 0.35, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 1, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'CRUSHER', ratedMW: 0.50, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 1, minimumOffSeconds: 0 }),
    new MotorLoad({ id: 'SLURRY-PUMP', ratedMW: 0.40, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 1, minimumOffSeconds: 0 }),
  ];
  const motorBank = new MotorLoadBank({ motors });
  const load = new AggregateLoad({ baseMW: 7, dynamicLoads: [motorBank] });
  const dieselFleet = createDieselFleet([
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.5, rampDownMWPerS: 1, inertiaSeconds: 4, droopPU: 0.04, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
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
    minimumStartFrequencyHz: 59.4,
    maximumResidualDeficitMW: 0.25,
    minimumPostStartReserveMW: 0.5,
    minimumStartIntervalSeconds: 1,
    maximumConcurrentStarts: 1,
  });
  const scheduler = new MotorStartScheduler({ controller: startController, retryDelaySeconds: 0.5, maximumAttempts: 20 });
  const process = new ProcessSequenceController({
    id: 'CRUSHING-LINE-1',
    name: 'Crushing Line 1',
    steps: [
      {
        id: 'conveyor',
        name: 'Feed Conveyor',
        motorId: 'CONVEYOR',
        prerequisites: ['condition:lubrication', 'condition:cooling-water'],
        priority: 3,
      },
      {
        id: 'crusher',
        name: 'Primary Crusher',
        motorId: 'CRUSHER',
        prerequisites: ['step:conveyor'],
        priority: 2,
      },
      {
        id: 'slurry-pump',
        name: 'Slurry Pump',
        motorId: 'SLURRY-PUMP',
        prerequisites: ['step:conveyor'],
        priority: 1,
      },
    ],
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
    emsIntervalSeconds: 20,
  });
  return { engine, process, motors };
}

export function testProcessSequenceRespectsExternalInterlocks() {
  const { engine, process } = createProcessEngine();
  engine.setProcessCondition('lubrication', true);
  engine.requestProcessStart();
  engine.start();
  const blocked = runFor(engine, 1);

  assert(!engine.events.some((event) => event.type === 'MOTOR_START_ACCEPTED'), 'motor started without cooling-water permissive');
  const conveyor = blocked.processSequence.steps.find((step) => step.id === 'conveyor');
  assert(conveyor.state === 'BLOCKED', `conveyor was not blocked: ${conveyor.state}`);
  assert(conveyor.blockedBy.includes('condition:cooling-water'), 'missing cooling-water block evidence');
  assert(process.state === PROCESS_SEQUENCE_STATE.BLOCKED, `unexpected process state: ${process.state}`);

  engine.setProcessCondition('cooling-water', true);
  runFor(engine, 3);
  const accepted = engine.events.find((event) => event.type === 'MOTOR_START_ACCEPTED');
  assert(accepted?.motorId === 'CONVEYOR', `expected conveyor start, received ${accepted?.motorId}`);

  return {
    name: 'Process sequence respects external interlocks',
    status: 'PASS',
    metrics: { blockedBy: conveyor.blockedBy, firstAcceptedMotor: accepted.motorId },
  };
}

export function testProcessSequenceOrdersAndParallelBranches() {
  const { engine } = createProcessEngine();
  engine.setProcessCondition('lubrication', true);
  engine.setProcessCondition('cooling-water', true);
  engine.requestProcessStart('SHIFT_START');
  engine.start();
  const last = runFor(engine, 10);

  const accepted = engine.events.filter((event) => event.type === 'MOTOR_START_ACCEPTED');
  assert(accepted.length === 3, `expected 3 accepted process motors, received ${accepted.length}`);
  assert(accepted.map((event) => event.motorId).join(',') === 'CONVEYOR,CRUSHER,SLURRY-PUMP', `unexpected process order: ${accepted.map((event) => event.motorId).join(',')}`);
  assert(last.processState === PROCESS_SEQUENCE_STATE.RUNNING, `process did not reach RUNNING: ${last.processState}`);
  assert(engine.events.some((event) => event.type === 'PROCESS_SEQUENCE_RUNNING'), 'process running event missing');

  const crusherRequest = engine.events.find((event) => event.type === 'PROCESS_STEP_START_REQUESTED' && event.stepId === 'crusher');
  const pumpRequest = engine.events.find((event) => event.type === 'PROCESS_STEP_START_REQUESTED' && event.stepId === 'slurry-pump');
  assert(crusherRequest && pumpRequest, 'parallel branch requests were not generated');
  assert(Math.abs(crusherRequest.timeSeconds - pumpRequest.timeSeconds) < 1e-9, 'parallel branches were not released together');

  return {
    name: 'Process sequence orders upstream equipment and releases parallel branches',
    status: 'PASS',
    metrics: {
      acceptedOrder: accepted.map((event) => event.motorId),
      parallelReleaseSeconds: crusherRequest.timeSeconds,
      processState: last.processState,
    },
  };
}

export function testProcessPrerequisiteLossTripsDownstreamChain() {
  const { engine, motors } = createProcessEngine();
  engine.setProcessCondition('lubrication', true);
  engine.setProcessCondition('cooling-water', true);
  engine.requestProcessStart();
  engine.start();
  runFor(engine, 10);
  assert(motors.every((motor) => motor.state === MOTOR_STATE.RUNNING), 'process was not fully running before interlock loss');

  engine.setProcessCondition('cooling-water', false);
  const afterLoss = engine.step();
  const stopped = afterLoss.processEvents.filter((event) => event.type === 'PROCESS_EQUIPMENT_STOPPED');
  assert(afterLoss.processState === PROCESS_SEQUENCE_STATE.TRIPPED, `process did not trip: ${afterLoss.processState}`);
  assert(stopped.map((event) => event.motorId).join(',') === 'SLURRY-PUMP,CRUSHER,CONVEYOR', `unexpected stop order: ${stopped.map((event) => event.motorId).join(',')}`);
  assert(motors.every((motor) => motor.state === MOTOR_STATE.OFF), 'not all downstream motors were stopped');
  assert(engine.events.some((event) => event.type === 'PROCESS_SEQUENCE_TRIPPED'), 'process trip event missing');

  return {
    name: 'Critical prerequisite loss trips downstream process chain in reverse order',
    status: 'PASS',
    metrics: { stoppedOrder: stopped.map((event) => event.motorId), processState: afterLoss.processState },
  };
}

export function testProcessSequenceRejectsDependencyCycle() {
  let error = null;
  try {
    new ProcessSequenceController({
      steps: [
        { id: 'a', motorId: 'A', prerequisites: ['step:b'] },
        { id: 'b', motorId: 'B', prerequisites: ['step:a'] },
      ],
    });
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof Error, 'cyclic process configuration was not rejected');
  assert(error.message.includes('cycle'), `unexpected cycle error: ${error.message}`);

  return {
    name: 'Process sequence rejects cyclic dependencies',
    status: 'PASS',
    metrics: { error: error.message },
  };
}
