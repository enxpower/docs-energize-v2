import { ScenarioComparisonEngine } from '../decision/scenario-comparison.js';
import { ScenarioBatchRunner } from '../decision/scenario-batch-runner.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function scenario({
  id,
  frequencyHz = 59.5,
  rocofHzPerS = 0.2,
  n1CoverageRatio = 1.2,
  eensMWh = 0,
  dieselFuelCost = 100,
  dieselFuelLiters = 100,
  deferredProductionTons = 0,
  bessEstimatedAvoidedFuelCost = 0,
  criticalLoadShed = false,
} = {}) {
  const events = criticalLoadShed
    ? [{ type: 'LOAD_BLOCK_SHED', critical: true }]
    : [];
  return {
    id,
    samples: [
      {
        timeSeconds: 1,
        frequencyHz,
        rocofHzPerS,
        residualMW: 0.1,
        n1CoverageRatio,
        n1Status: n1CoverageRatio >= 1 ? 'PASS' : 'FAIL',
        eensMWh,
        dieselFuelCost,
        dieselFuelLiters,
        deferredProductionTons,
        bessEstimatedAvoidedFuelCost,
      },
    ],
    events,
  };
}

export function testHardConstraintsOverrideCheapScenario() {
  const comparison = new ScenarioComparisonEngine().compare([
    scenario({ id: 'CHEAP-UNSAFE', frequencyHz: 58.2, dieselFuelCost: 10 }),
    scenario({ id: 'SAFE', frequencyHz: 59.4, dieselFuelCost: 120 }),
  ]);

  assert(comparison.recommendation.scenarioId === 'SAFE', `unsafe cheap scenario was recommended: ${comparison.recommendation.scenarioId}`);
  assert(comparison.rejectedScenarioIds.includes('CHEAP-UNSAFE'), 'unsafe scenario was not rejected');
  const rejected = comparison.rankedScenarios.find((item) => item.id === 'CHEAP-UNSAFE');
  assert(rejected.compliance.violations.some((item) => item.code === 'FREQUENCY_NADIR_BELOW_LIMIT'), 'frequency violation missing');

  return {
    name: 'Scenario hard constraints override lower operating cost',
    status: 'PASS',
    metrics: {
      recommended: comparison.recommendation.scenarioId,
      rejected: comparison.rejectedScenarioIds,
    },
  };
}

export function testScenarioParetoFrontierPreservesTradeoffs() {
  const comparison = new ScenarioComparisonEngine({
    hardConstraints: { minimumFrequencyHz: 58.5 },
  }).compare([
    scenario({ id: 'LOW-COST', frequencyHz: 59.0, n1CoverageRatio: 1.05, dieselFuelCost: 70, deferredProductionTons: 10 }),
    scenario({ id: 'HIGH-RELIABILITY', frequencyHz: 59.7, n1CoverageRatio: 1.4, dieselFuelCost: 150, deferredProductionTons: 0 }),
    scenario({ id: 'DOMINATED', frequencyHz: 58.9, n1CoverageRatio: 1.01, dieselFuelCost: 180, deferredProductionTons: 12 }),
  ]);

  assert(comparison.paretoScenarioIds.includes('LOW-COST'), 'low-cost tradeoff missing from Pareto frontier');
  assert(comparison.paretoScenarioIds.includes('HIGH-RELIABILITY'), 'high-reliability tradeoff missing from Pareto frontier');
  assert(!comparison.paretoScenarioIds.includes('DOMINATED'), 'dominated scenario was retained on Pareto frontier');

  return {
    name: 'Scenario comparison preserves non-dominated engineering tradeoffs',
    status: 'PASS',
    metrics: { paretoScenarioIds: comparison.paretoScenarioIds },
  };
}

export function testScenarioRankingIsDeterministic() {
  const engine = new ScenarioComparisonEngine();
  const inputs = [
    scenario({ id: 'B', dieselFuelCost: 100 }),
    scenario({ id: 'A', dieselFuelCost: 100 }),
  ];
  const first = engine.compare(inputs);
  const second = engine.compare(inputs);
  const firstOrder = first.rankedScenarios.map((item) => item.id).join(',');
  const secondOrder = second.rankedScenarios.map((item) => item.id).join(',');
  assert(firstOrder === 'A,B', `unexpected deterministic tie order: ${firstOrder}`);
  assert(secondOrder === firstOrder, `ranking changed between identical runs: ${secondOrder}`);

  return {
    name: 'Scenario comparison ranking is deterministic for identical evidence',
    status: 'PASS',
    metrics: { order: firstOrder },
  };
}

class FakeEngine {
  constructor(label) {
    this.label = label;
    this.dtSeconds = 1;
    this.timeSeconds = 0;
    this.events = [];
    this.disturbanceCount = 0;
  }

  start() {
    this.started = true;
  }

  step() {
    this.timeSeconds += this.dtSeconds;
    return {
      timeSeconds: this.timeSeconds,
      frequencyHz: 60 - this.disturbanceCount * 0.1,
      rocofHzPerS: 0,
      residualMW: 0,
      n1CoverageRatio: 1.1,
      n1Status: 'PASS',
    };
  }
}

export function testScenarioBatchRunnerIsolationAndCommonActions() {
  const created = [];
  const runner = new ScenarioBatchRunner({
    durationSeconds: 3,
    actions: [
      {
        id: 'COMMON-DISTURBANCE',
        timeSeconds: 1,
        apply(engine) {
          engine.disturbanceCount += 1;
          engine.events.push({ type: 'TEST_DISTURBANCE', timeSeconds: engine.timeSeconds });
        },
      },
    ],
  });
  const results = runner.runAll([
    { id: 'BASE', createEngine: () => { const engine = new FakeEngine('BASE'); created.push(engine); return engine; } },
    { id: 'OPTION', createEngine: () => { const engine = new FakeEngine('OPTION'); created.push(engine); return engine; } },
  ]);

  assert(created.length === 2 && created[0] !== created[1], 'scenario runner reused an engine instance');
  assert(results.every((result) => result.execution.executedActions.length === 1), 'common action was not executed once per scenario');
  assert(results.every((result) => result.execution.sampleCount === 3), 'scenarios did not use the same simulation horizon');
  assert(results.every((result) => result.events.filter((event) => event.type === 'TEST_DISTURBANCE').length === 1), 'disturbance evidence missing or duplicated');

  return {
    name: 'Scenario batch runner isolates engines and applies common disturbances',
    status: 'PASS',
    metrics: {
      scenarioIds: results.map((result) => result.id),
      samples: results.map((result) => result.execution.sampleCount),
    },
  };
}
