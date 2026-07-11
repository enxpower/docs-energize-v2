import { createEngineFromScenarioConfig, createScenarioBatch, createScenarioDefinition } from '../config/scenario-factory.js';
import { validateScenarioConfig } from '../config/scenario-config.js';
import { ScenarioBatchRunner } from '../decision/scenario-batch-runner.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

function baseConfig(id = 'BASE') {
  return {
    version: '1.0',
    id,
    name: `Mine ${id}`,
    metadata: { modelMaturity: 'SCREENING' },
    simulation: { dtSeconds: 0.1, durationSeconds: 1 },
    site: { nominalHz: 60, systemBaseMW: 5, baseLoadMW: 1 },
    equipment: {
      diesel: [
        { id: 'DG-1', ratedMW: 2, minLoadPU: 0.2, rampUpMWPerS: 1, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
        { id: 'DG-2', ratedMW: 2, minLoadPU: 0.2, rampUpMWPerS: 1, governorTimeConstantSeconds: 0.25, engineTimeConstantSeconds: 0.8 },
      ],
      bess: { powerMW: 2, energyMWh: 4, initialSoc: 0.6, rampMWPerS: 2 },
      motors: [{ id: 'PUMP-1', ratedMW: 0.1, startMode: 'VFD', minimumOffSeconds: 0 }],
      productionLoads: [{ id: 'CRUSHER', normalMW: 0.5, minimumMW: 0.2, normalThroughputTPH: 100 }],
    },
    process: { steps: [{ id: 'pump', motorId: 'PUMP-1' }] },
    controls: { emsIntervalSeconds: 1, commitmentIntervalSeconds: 1 },
    economics: { fuelPricePerLiter: 1.5, productValuePerTon: 20 },
    disturbances: [],
  };
}

export function testScenarioConfigCreatesRunnableEngine() {
  const config = baseConfig();
  const engine = createEngineFromScenarioConfig(config);
  engine.start();
  const sample = engine.step();
  assert(sample.timeSeconds === 0.1, `unexpected first sample time ${sample.timeSeconds}`);
  assert(engine.scenarioConfig.id === config.id, 'scenario config evidence missing from engine');
  assert(sample.productionEconomics, 'economic production layer was not created');
  return { name: 'Structured scenario config creates runnable full-stack engine', status: 'PASS' };
}

export function testScenarioConfigRejectsInvalidReferences() {
  const duplicate = baseConfig('DUPLICATE');
  duplicate.equipment.motors.push({ ...duplicate.equipment.motors[0] });
  let duplicateRejected = false;
  try { validateScenarioConfig(duplicate); } catch (error) { duplicateRejected = /unique/.test(error.message); }
  const unknown = baseConfig('UNKNOWN');
  unknown.process.steps[0].motorId = 'MISSING-MOTOR';
  let unknownRejected = false;
  try { validateScenarioConfig(unknown); } catch (error) { unknownRejected = /unknown motor/.test(error.message); }
  assert(duplicateRejected, 'duplicate equipment id was not rejected');
  assert(unknownRejected, 'unknown process motor reference was not rejected');
  return { name: 'Scenario config rejects duplicate ids and unknown references', status: 'PASS' };
}

export function testScenarioJsonActionsCompileAndExecute() {
  const config = baseConfig('ACTIONS');
  config.disturbances = [
    { id: 'LOAD-UP', type: 'SET_BASE_LOAD', timeSeconds: 0.2, valueMW: 1.3 },
    { id: 'BESS-LOSS', type: 'BESS_TRIP', timeSeconds: 0.4 },
  ];
  const runner = new ScenarioBatchRunner({ durationSeconds: config.simulation.durationSeconds });
  const result = runner.runScenario(createScenarioDefinition(config));
  assert(result.execution.executedActions.length === 2, 'not all JSON actions executed');
  assert(result.execution.executedActions[0].id === 'LOAD-UP', 'actions did not execute in scheduled order');
  assert(result.execution.unexecutedActionIds.length === 0, 'scheduled actions remained unexecuted');
  return {
    name: 'Scenario JSON actions compile and execute on schedule',
    status: 'PASS',
    metrics: { executed: result.execution.executedActions.map((action) => action.id) },
  };
}

export function testScenarioBatchConfigIsolationAndCommonHorizon() {
  const first = baseConfig('FIRST');
  const second = baseConfig('SECOND');
  second.equipment.bess.powerMW = 3;
  const batch = createScenarioBatch([first, second]);
  const engineA = batch.definitions[0].createEngine();
  const engineB = batch.definitions[0].createEngine();
  assert(engineA !== engineB, 'scenario definition reused an engine instance');
  engineA.bess.trip();
  assert(engineB.bess.isAvailable, 'device state leaked across scenario engines');
  second.simulation.durationSeconds = 2;
  let mismatchRejected = false;
  try { createScenarioBatch([first, second]); } catch (error) { mismatchRejected = /same durationSeconds/.test(error.message); }
  assert(mismatchRejected, 'mismatched scenario horizon was not rejected');
  return { name: 'Scenario config batch isolates engines and enforces common horizon', status: 'PASS' };
}
