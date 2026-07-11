import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { ProcessSequenceController } from '../controls/process-sequence.js';
import { ProductionLoad, ProductionLoadBank } from '../equipment/production-load.js';
import { ProductionCurtailmentController } from '../controls/production-curtailment.js';
import { ProductionCurtailedSimulationEngine } from '../core/production-curtailed-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function settle(loadBank, seconds = 10) {
  loadBank.step(seconds);
}

export function testProductionCurtailmentProtectsSafetyLoads() {
  const lowValue = new ProductionLoad({ id: 'AUX-CONVEYOR', normalMW: 1.5, minimumMW: 0.5, priority: 1, productionUnitsPerMWh: 1 });
  const crusher = new ProductionLoad({ id: 'CRUSHER', normalMW: 2, minimumMW: 1, priority: 5, productionUnitsPerMWh: 5 });
  const dewatering = new ProductionLoad({ id: 'DEWATERING', normalMW: 1, minimumMW: 1, priority: 10, safetyCritical: true, productionUnitsPerMWh: 10 });
  const bank = new ProductionLoadBank({ loads: [lowValue, crusher, dewatering] });
  const controller = new ProductionCurtailmentController({ triggerDeficitMW: 0.1, maximumStepMW: 1.2, minimumActionIntervalSeconds: 0 });

  const events = controller.evaluate({ loadBank: bank, residualMW: -1.2, reserve60MW: 0, timeSeconds: 0, dtSeconds: 0 });
  assert(events.length === 2, `expected staged curtailment across 2 loads, received ${events.length}`);
  assert(events[0].loadId === 'AUX-CONVEYOR', `low-priority load was not curtailed first: ${events[0].loadId}`);
  assert(Math.abs(lowValue.targetMW - 0.5) < 1e-9, `unexpected auxiliary target: ${lowValue.targetMW}`);
  assert(Math.abs(crusher.targetMW - 1.8) < 1e-9, `unexpected crusher target: ${crusher.targetMW}`);
  assert(dewatering.targetMW === 1, 'safety-critical dewatering load was curtailed');

  return {
    name: 'Production curtailment protects safety loads and reduces low priority first',
    status: 'PASS',
    metrics: { order: events.map((event) => event.loadId), targets: bank.snapshot() },
  };
}

export function testProductionRestorationUsesPriorityAndReserve() {
  const auxiliary = new ProductionLoad({ id: 'AUX', normalMW: 1, minimumMW: 0, priority: 1, productionUnitsPerMWh: 1 });
  const crusher = new ProductionLoad({ id: 'CRUSHER', normalMW: 2, minimumMW: 1, priority: 8, productionUnitsPerMWh: 5 });
  const bank = new ProductionLoadBank({ loads: [auxiliary, crusher] });
  auxiliary.setTargetMW(0, { reason: 'TEST' });
  crusher.setTargetMW(1, { reason: 'TEST' });
  settle(bank);

  const controller = new ProductionCurtailmentController({
    restoreSurplusMW: 0.5,
    minimumPostRestoreReserveMW: 0.5,
    restoreDelaySeconds: 0,
    minimumActionIntervalSeconds: 0,
    maximumStepMW: 0.8,
  });
  controller.evaluate({ loadBank: bank, residualMW: 2, reserve60MW: 3, timeSeconds: 1, dtSeconds: 0 });
  const events = controller.evaluate({ loadBank: bank, residualMW: 2, reserve60MW: 3, timeSeconds: 1.1, dtSeconds: 0 });
  assert(events.length === 1, `expected one restoration event, received ${events.length}`);
  assert(events[0].loadId === 'CRUSHER', `high-priority crusher was not restored first: ${events[0].loadId}`);
  assert(Math.abs(crusher.targetMW - 1.8) < 1e-9, `unexpected crusher restoration target: ${crusher.targetMW}`);
  assert(auxiliary.targetMW === 0, 'low-priority auxiliary load restored before crusher');

  return {
    name: 'Production restoration prioritizes high-value load and preserves reserve',
    status: 'PASS',
    metrics: { restoredLoad: events[0].loadId, targetMW: crusher.targetMW },
  };
}

export function testProductionLossIsSeparateFromEens() {
  const load = new ProductionLoad({ id: 'MILL', normalMW: 3, minimumMW: 2, priority: 4, productionUnitsPerMWh: 7 });
  const bank = new ProductionLoadBank({ loads: [load] });
  load.setTargetMW(2, { reason: 'POWER_DEFICIT' });
  settle(bank);
  const controller = new ProductionCurtailmentController({ triggerDeficitMW: 10 });
  controller.evaluate({ loadBank: bank, residualMW: 0, reserve60MW: 0, timeSeconds: 3600, dtSeconds: 3600 });
  const snapshot = controller.snapshot(bank);
  assert(Math.abs(snapshot.productionLossUnits - 7) < 1e-9, `unexpected production loss: ${snapshot.productionLossUnits}`);
  assert(snapshot.totalCurtailedMW === 1, `unexpected curtailed MW: ${snapshot.totalCurtailedMW}`);

  return {
    name: 'Production curtailment records production loss without treating it as EENS',
    status: 'PASS',
    metrics: { productionLossUnits: snapshot.productionLossUnits, curtailedMW: snapshot.totalCurtailedMW },
  };
}

function createIntegratedEngine() {
  const productionBank = new ProductionLoadBank({
    loads: [
      new ProductionLoad({ id: 'AUX-PUMP', normalMW: 1, minimumMW: 0.2, priority: 1, curtailRampMWPerS: 5 }),
      new ProductionLoad({ id: 'PRIMARY-CRUSHER', normalMW: 2, minimumMW: 1, priority: 5, curtailRampMWPerS: 5 }),
      new ProductionLoad({ id: 'DEWATERING', normalMW: 0.8, minimumMW: 0.8, priority: 10, safetyCritical: true }),
    ],
  });
  const dummyMotor = new MotorLoad({ id: 'DUMMY', ratedMW: 0.1, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 1, minimumOffSeconds: 0 });
  const motorBank = new MotorLoadBank({ motors: [dummyMotor] });
  const load = new AggregateLoad({ baseMW: 6, dynamicLoads: [productionBank, motorBank] });
  const dieselFleet = createDieselFleet([
    { id: 'DG-1', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { id: 'DG-2', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { id: 'DG-3', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { id: 'DG-4', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
  ]);
  const totalMW = load.baseMW + productionBank.outputMW;
  for (const dg of dieselFleet) {
    const share = totalMW / dieselFleet.length;
    dg.emsSetpointMW = share;
    dg.governorCommandMW = share;
    dg.mechanicalMW = share;
    dg.outputMW = share;
  }
  const bess = new Bess({ powerMW: 8, energyMWh: 20, initialSoc: 0.6, rampMWPerS: 8 });
  bess.trip();
  const motorStartScheduler = new MotorStartScheduler({ controller: new MotorStartController({ minimumStartIntervalSeconds: 0 }) });
  const processSequenceController = new ProcessSequenceController({ steps: [{ id: 'dummy', motorId: 'DUMMY' }] });
  const productionCurtailmentController = new ProductionCurtailmentController({
    triggerDeficitMW: 0.1,
    maximumStepMW: 1,
    minimumActionIntervalSeconds: 0,
    restoreDelaySeconds: 60,
  });
  const engine = new ProductionCurtailedSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    motorBank,
    motorStartScheduler,
    processSequenceController,
    productionLoadBank: productionBank,
    productionCurtailmentController,
    emsIntervalSeconds: 20,
  });
  return { engine, dieselFleet, productionBank };
}

export function testIntegratedProductionCurtailmentEvidence() {
  const { engine, dieselFleet, productionBank } = createIntegratedEngine();
  engine.start();
  engine.step();
  dieselFleet[0].trip();
  let sample;
  for (let i = 0; i < 20; i += 1) sample = engine.step();

  assert(engine.events.some((event) => event.type === 'PRODUCTION_LOAD_CURTAILED'), 'production curtailment event missing');
  assert(sample.productionCurtailedMW > 0, 'sample did not expose active production curtailment');
  assert(sample.productionOutputMW < sample.productionNormalMW, 'production output did not decrease');
  assert(Array.isArray(sample.productionCurtailment.loads), 'production load details missing from sample');
  const dewatering = productionBank.loads.find((load) => load.id === 'DEWATERING');
  assert(dewatering.targetMW === dewatering.normalMW, 'integrated controller curtailed safety-critical dewatering');

  return {
    name: 'Integrated production curtailment exposes load state and event evidence',
    status: 'PASS',
    metrics: {
      productionNormalMW: sample.productionNormalMW,
      productionOutputMW: sample.productionOutputMW,
      productionCurtailedMW: sample.productionCurtailedMW,
      eventCount: sample.productionEventCount,
    },
  };
}
