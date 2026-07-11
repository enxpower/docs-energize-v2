import {
  compareScenarioConfigs,
  duplicateScenarioConfig,
  runScenarioConfig,
  updateScenarioValue,
  validateScenarioWorkspace,
} from '../ui/configurator-model.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createConfig(id = 'UI-BASE') {
  return {
    version: '1.0',
    id,
    name: id,
    metadata: { modelMaturity: 'SCREENING' },
    simulation: { dtSeconds: 0.1, durationSeconds: 2 },
    site: { nominalHz: 60, systemBaseMW: 4, baseLoadMW: 1, shedBlocks: [] },
    equipment: {
      diesel: [
        {
          id: 'DG-1',
          ratedMW: 3.3,
          minLoadPU: 0.35,
          rampUpMWPerS: 0.5,
          rampDownMWPerS: 1,
          droopPU: 0.04,
          inertiaSeconds: 4,
          governorTimeConstantSeconds: 0.25,
          engineTimeConstantSeconds: 0.8,
        },
      ],
      bess: {
        powerMW: 2,
        energyMWh: 4,
        initialSoc: 0.6,
        minSoc: 0.18,
        maxSoc: 0.82,
        roundTripEfficiency: 0.965,
        rampMWPerS: 2,
      },
      motors: [
        { id: 'PUMP', ratedMW: 0.2, startMode: 'VFD', accelerationSeconds: 0.5, minimumOffSeconds: 0 },
      ],
      productionLoads: [
        { id: 'PROCESS', normalMW: 0.5, minimumMW: 0.2, priority: 5, normalThroughputTPH: 10 },
      ],
    },
    process: {
      id: 'PROCESS-SEQUENCE',
      conditions: [{ id: 'PERMIT', ready: true }],
      steps: [{ id: 'pump', motorId: 'PUMP', prerequisites: ['condition:PERMIT'], priority: 5 }],
    },
    controls: {
      emsIntervalSeconds: 1,
      commitmentIntervalSeconds: 1,
      motorStart: { minimumStartIntervalSeconds: 0 },
      productionCurtailment: { triggerDeficitMW: 10, restoreDelaySeconds: 30 },
    },
    economics: {
      fuelPricePerLiter: 1,
      productValuePerTon: 10,
      bessMarginalFuelLitersPerMWh: 200,
      dieselFuelCurves: { default: { idleLitersPerHour: 20, incrementalLitersPerMWh: 200 } },
    },
    disturbances: [{ id: 'START', type: 'PROCESS_START', timeSeconds: 0 }],
  };
}

export function testConfiguratorDuplicateIsDeeplyIsolated() {
  const base = createConfig();
  const copy = duplicateScenarioConfig(base, [base.id]);
  copy.equipment.bess.powerMW = 9;
  copy.equipment.diesel[0].ratedMW = 4;
  assert(copy.id !== base.id, 'duplicated scenario id was not made unique');
  assert(base.equipment.bess.powerMW === 2, 'BESS mutation leaked into source scenario');
  assert(base.equipment.diesel[0].ratedMW === 3.3, 'diesel mutation leaked into source scenario');
  return {
    name: 'Configurator scenario duplication is deeply isolated',
    status: 'PASS',
    metrics: { sourceId: base.id, copyId: copy.id },
  };
}

export function testConfiguratorNestedUpdateIsImmutable() {
  const base = createConfig();
  const updated = updateScenarioValue(base, 'equipment.bess.energyMWh', 8);
  const arrayUpdated = updateScenarioValue(updated, 'equipment.diesel.0.ratedMW', 3.8);
  assert(base.equipment.bess.energyMWh === 4, 'nested update mutated source BESS');
  assert(updated.equipment.bess.energyMWh === 8, 'nested BESS update was not applied');
  assert(arrayUpdated.equipment.diesel[0].ratedMW === 3.8, 'nested array update was not applied');
  return {
    name: 'Configurator nested form updates preserve source configuration',
    status: 'PASS',
    metrics: { baseEnergyMWh: base.equipment.bess.energyMWh, updatedEnergyMWh: updated.equipment.bess.energyMWh },
  };
}

export function testConfiguratorRejectsMixedComparisonHorizon() {
  const first = createConfig('FIRST');
  const second = createConfig('SECOND');
  second.simulation.durationSeconds = 3;
  const validation = validateScenarioWorkspace([first, second]);
  assert(!validation.valid, 'mixed comparison duration was accepted');
  assert(validation.errors.some((error) => error.message.includes('same durationSeconds')), 'common-horizon error missing');
  return {
    name: 'Configurator workspace rejects mixed comparison horizon',
    status: 'PASS',
    metrics: { errors: validation.errors },
  };
}

export function testConfiguratorRunsRealEngineAndComparison() {
  const first = createConfig('BASE');
  const second = createConfig('MORE-BESS');
  second.equipment.bess.powerMW = 3;
  second.equipment.bess.energyMWh = 6;
  const single = runScenarioConfig(first);
  assert(single.result.samples.length > 0, 'single configurator run returned no samples');
  assert(single.kpis.id === 'BASE', `unexpected single-run KPI id: ${single.kpis.id}`);
  const compared = compareScenarioConfigs([first, second], {
    hardConstraints: {
      minimumFrequencyHz: 0,
      maximumAbsoluteRoCoFHzPerS: 999,
      maximumEensMWh: 999,
      minimumN1CoverageRatio: 0,
      criticalLoadShedAllowed: true,
    },
  });
  assert(compared.results.length === 2, `expected 2 scenario results, received ${compared.results.length}`);
  assert(compared.comparison.rankedScenarios.length === 2, 'comparison did not rank both UI scenarios');
  return {
    name: 'Configurator executes real V7 engine and decision comparison',
    status: 'PASS',
    metrics: {
      samples: single.result.samples.length,
      recommendation: compared.comparison.recommendation,
    },
  };
}
