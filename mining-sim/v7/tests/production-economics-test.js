import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { ProcessSequenceController } from '../controls/process-sequence.js';
import { ProductionLoad, ProductionLoadBank } from '../equipment/production-load.js';
import { ProductionCurtailmentController } from '../controls/production-curtailment.js';
import { ProductionEconomicsTracker } from '../economics/production-economics.js';
import { EconomicProductionSimulationEngine } from '../core/economic-production-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function testProductionThroughputPowerLaw() {
  const load = new ProductionLoad({
    id: 'MILL',
    normalMW: 4,
    minimumMW: 1,
    normalThroughputTPH: 800,
    throughputExponent: 1.2,
  });
  load.setTargetMW(2, { reason: 'TEST' });
  load.step(1);
  const expected = 800 * (0.5 ** 1.2);
  assert(Math.abs(load.throughputTPH - expected) < 1e-9, `unexpected throughput: ${load.throughputTPH}`);
  assert(Math.abs(load.deferredThroughputTPH - (800 - expected)) < 1e-9, 'deferred throughput mismatch');
  return {
    name: 'Production throughput follows configured power curve',
    status: 'PASS',
    metrics: { throughputTPH: load.throughputTPH, deferredTPH: load.deferredThroughputTPH },
  };
}

export function testDieselFuelAndCostAccounting() {
  const bank = new ProductionLoadBank({
    loads: [new ProductionLoad({ id: 'CRUSHER', normalMW: 2, normalThroughputTPH: 400 })],
  });
  const tracker = new ProductionEconomicsTracker({
    productionLoadBank: bank,
    dieselFuelCurves: {
      'DG-1': { idleLitersPerHour: 20, incrementalLitersPerMWh: 200 },
      'DG-2': { idleLitersPerHour: 10, incrementalLitersPerMWh: 180 },
    },
    fuelPricePerLiter: 1.5,
    productValuePerTon: 50,
  });
  const snapshot = tracker.step({
    dtSeconds: 3600,
    sample: {
      dieselStates: [
        { id: 'DG-1', state: 'RUNNING', outputMW: 2 },
        { id: 'DG-2', state: 'RUNNING', outputMW: 1 },
        { id: 'DG-3', state: 'OFF', outputMW: 0 },
      ],
      bessMW: 0,
    },
  });
  const expectedLiters = 20 + 2 * 200 + 10 + 1 * 180;
  assert(Math.abs(snapshot.dieselFuelLiters - expectedLiters) < 1e-9, `unexpected fuel liters: ${snapshot.dieselFuelLiters}`);
  assert(Math.abs(snapshot.dieselFuelCost - expectedLiters * 1.5) < 1e-9, 'fuel cost mismatch');
  assert(Math.abs(snapshot.actualProductionTons - 400) < 1e-9, 'actual production mismatch');
  return {
    name: 'Diesel fuel and operating cost use explicit unit curves',
    status: 'PASS',
    metrics: { liters: snapshot.dieselFuelLiters, cost: snapshot.dieselFuelCost },
  };
}

export function testBessEstimatedFuelDisplacementValue() {
  const bank = new ProductionLoadBank({ loads: [] });
  const tracker = new ProductionEconomicsTracker({
    productionLoadBank: bank,
    fuelPricePerLiter: 2,
    bessMarginalFuelLitersPerMWh: 220,
  });
  const snapshot = tracker.step({
    dtSeconds: 1800,
    sample: { dieselStates: [], bessMW: 2 },
  });
  assert(Math.abs(snapshot.bessDischargeMWh - 1) < 1e-9, 'BESS discharge energy mismatch');
  assert(Math.abs(snapshot.bessEstimatedAvoidedFuelLiters - 220) < 1e-9, 'avoided fuel estimate mismatch');
  assert(Math.abs(snapshot.bessEstimatedAvoidedFuelCost - 440) < 1e-9, 'avoided fuel cost mismatch');
  assert(snapshot.assumptions.bessValueMethod === 'ESTIMATED_DIESEL_FUEL_DISPLACEMENT_ONLY', 'BESS valuation boundary missing');
  return {
    name: 'BESS value is limited to estimated diesel fuel displacement',
    status: 'PASS',
    metrics: { dischargeMWh: snapshot.bessDischargeMWh, avoidedFuelCost: snapshot.bessEstimatedAvoidedFuelCost },
  };
}

function createEconomicEngine() {
  const productionBank = new ProductionLoadBank({
    loads: [
      new ProductionLoad({ id: 'PRIMARY-CRUSHER', normalMW: 2, minimumMW: 1, priority: 5, normalThroughputTPH: 500, throughputExponent: 1 }),
      new ProductionLoad({ id: 'AUX', normalMW: 1, minimumMW: 0.2, priority: 1, normalThroughputTPH: 100, throughputExponent: 1 }),
    ],
  });
  const dummyMotor = new MotorLoad({ id: 'DUMMY', ratedMW: 0.1, startMode: MOTOR_START_MODE.VFD, accelerationSeconds: 1, minimumOffSeconds: 0 });
  const motorBank = new MotorLoadBank({ motors: [dummyMotor] });
  const load = new AggregateLoad({ baseMW: 5, dynamicLoads: [productionBank, motorBank] });
  const dieselFleet = createDieselFleet([
    { id: 'DG-1', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { id: 'DG-2', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
    { id: 'DG-3', ratedMW: 3.3, rampUpMWPerS: 0.5, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
  ]);
  const totalMW = load.baseMW + productionBank.outputMW;
  for (const dg of dieselFleet) {
    const share = totalMW / dieselFleet.length;
    dg.emsSetpointMW = share;
    dg.governorCommandMW = share;
    dg.mechanicalMW = share;
    dg.outputMW = share;
  }
  const bess = new Bess({ powerMW: 4, energyMWh: 8, initialSoc: 0.6, rampMWPerS: 4 });
  const motorStartScheduler = new MotorStartScheduler({ controller: new MotorStartController({ minimumStartIntervalSeconds: 0 }) });
  const processSequenceController = new ProcessSequenceController({ steps: [{ id: 'dummy', motorId: 'DUMMY' }] });
  const productionCurtailmentController = new ProductionCurtailmentController({ triggerDeficitMW: 0.1, maximumStepMW: 1, minimumActionIntervalSeconds: 0 });
  const economics = new ProductionEconomicsTracker({
    productionLoadBank: productionBank,
    dieselFuelCurves: { default: { idleLitersPerHour: 15, incrementalLitersPerMWh: 190 } },
    fuelPricePerLiter: 1.4,
    productValuePerTon: 60,
    bessMarginalFuelLitersPerMWh: 190,
  });
  const engine = new EconomicProductionSimulationEngine({
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
    productionEconomicsTracker: economics,
    emsIntervalSeconds: 20,
  });
  return { engine, dieselFleet };
}

export function testIntegratedProductionEconomicsEvidence() {
  const { engine, dieselFleet } = createEconomicEngine();
  engine.start();
  let sample;
  for (let i = 0; i < 10; i += 1) sample = engine.step();
  dieselFleet[0].trip();
  for (let i = 0; i < 30; i += 1) sample = engine.step();

  assert(sample.productionEconomics, 'production economics snapshot missing');
  assert(Number.isFinite(sample.productionThroughputTPH), 'throughput not exposed');
  assert(sample.actualProductionTons > 0, 'actual production did not accumulate');
  assert(sample.dieselFuelLiters > 0, 'diesel fuel did not accumulate');
  assert(sample.dieselFuelCost > 0, 'diesel cost did not accumulate');
  assert(sample.productionGrossValue > 0, 'production value did not accumulate');
  assert(sample.productionEconomics.assumptions.throughputModel === 'PER_LOAD_POWER_LAW', 'throughput model boundary missing');
  assert((sample.eensMWh ?? 0) === 0, 'economic curtailment was incorrectly treated as EENS');

  return {
    name: 'Integrated simulation exposes throughput and economic evidence',
    status: 'PASS',
    metrics: {
      throughputTPH: sample.productionThroughputTPH,
      actualTons: sample.actualProductionTons,
      deferredTons: sample.deferredProductionTons,
      dieselFuelCost: sample.dieselFuelCost,
    },
  };
}
