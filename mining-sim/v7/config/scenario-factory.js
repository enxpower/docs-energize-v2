import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { MotorLoadBank } from '../equipment/motor-load.js';
import { ProductionLoad, ProductionLoadBank } from '../equipment/production-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler } from '../controls/motor-start-scheduler.js';
import { ProcessSequenceController } from '../controls/process-sequence.js';
import { ProductionCurtailmentController } from '../controls/production-curtailment.js';
import { ProductionEconomicsTracker } from '../economics/production-economics.js';
import { EconomicProductionSimulationEngine } from '../core/economic-production-engine.js';
import { initializeIslandSteadyState } from '../core/initial-steady-state.js';
import { compileScenarioActions, validateScenarioConfig } from './scenario-config.js';

export function createEngineFromScenarioConfig(config) {
  validateScenarioConfig(config);
  const dieselFleet = createDieselFleet(config.equipment.diesel);
  const bess = new Bess(config.equipment.bess ?? { powerMW: 0, energyMWh: 0 });
  const motorBank = new MotorLoadBank({ motors: config.equipment.motors });
  const productionLoadBank = new ProductionLoadBank({
    loads: config.equipment.productionLoads.map((loadConfig) => new ProductionLoad(loadConfig)),
  });
  const load = new AggregateLoad({
    baseMW: Number(config.site.baseLoadMW),
    shedBlocks: config.site.shedBlocks ?? [],
    dynamicLoads: [productionLoadBank, motorBank],
  });
  const motorStartController = new MotorStartController(config.controls?.motorStart ?? {});
  const motorStartScheduler = new MotorStartScheduler({
    controller: motorStartController,
    ...(config.controls?.motorScheduler ?? {}),
  });
  const processSequenceController = new ProcessSequenceController({
    id: config.process.id ?? `${config.id}-PROCESS`,
    name: config.process.name ?? config.name ?? config.id,
    steps: config.process.steps,
  });
  for (const condition of config.process.conditions ?? []) {
    processSequenceController.setCondition(condition.id, Boolean(condition.ready), 0);
  }
  const productionCurtailmentController = new ProductionCurtailmentController(
    config.controls?.productionCurtailment ?? {},
  );
  const productionEconomicsTracker = new ProductionEconomicsTracker({
    productionLoadBank,
    dieselFuelCurves: config.economics?.dieselFuelCurves ?? {},
    fuelPricePerLiter: config.economics?.fuelPricePerLiter ?? 0,
    productValuePerTon: config.economics?.productValuePerTon ?? 0,
    bessMarginalFuelLitersPerMWh: config.economics?.bessMarginalFuelLitersPerMWh ?? 0,
  });

  const initialSteadyState = initializeIslandSteadyState({
    load,
    dieselFleet,
    bess,
    nominalHz: Number(config.site.nominalHz ?? 60),
  });

  const engine = new EconomicProductionSimulationEngine({
    dtSeconds: Number(config.simulation.dtSeconds),
    nominalHz: Number(config.site.nominalHz ?? 60),
    systemBaseMW: Number(config.site.systemBaseMW),
    load,
    dieselFleet,
    bess,
    motorBank,
    motorStartScheduler,
    processSequenceController,
    productionLoadBank,
    productionCurtailmentController,
    productionEconomicsTracker,
    emsIntervalSeconds: Number(config.controls?.emsIntervalSeconds ?? 20),
    commitmentIntervalSeconds: Number(config.controls?.commitmentIntervalSeconds ?? 30),
  });
  engine.initialSteadyState = initialSteadyState;
  engine.events.push({
    timeSeconds: 0,
    type: 'INITIAL_STEADY_STATE_ESTABLISHED',
    ...initialSteadyState,
  });
  engine.scenarioConfig = structuredClone(config);
  return engine;
}

export function createScenarioDefinition(config) {
  validateScenarioConfig(config);
  return {
    id: String(config.id),
    name: config.name ?? config.id,
    createEngine: () => createEngineFromScenarioConfig(config),
    actions: compileScenarioActions(config),
    assumptions: {
      modelMaturity: config.metadata?.modelMaturity ?? 'SCREENING',
      configVersion: config.version ?? '1.0',
      ...(config.assumptions ?? {}),
    },
    capitalCostEstimate: Number.isFinite(Number(config.economics?.capitalCostEstimate))
      ? Number(config.economics.capitalCostEstimate)
      : null,
  };
}

export function createScenarioBatch(configs = []) {
  if (!Array.isArray(configs) || configs.length < 2) {
    throw new Error('At least two scenario configs are required');
  }
  const durationSeconds = Number(configs[0]?.simulation?.durationSeconds);
  for (const config of configs) {
    validateScenarioConfig(config);
    if (Math.abs(Number(config.simulation.durationSeconds) - durationSeconds) > 1e-9) {
      throw new Error('All scenario configs must use the same durationSeconds');
    }
  }
  return {
    durationSeconds,
    definitions: configs.map(createScenarioDefinition),
  };
}
