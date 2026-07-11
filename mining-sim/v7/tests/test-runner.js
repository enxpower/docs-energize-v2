import { createBaseOffgridScenario } from '../scenarios/base-offgrid.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

function testBaseSteadyState() {
  const engine = createBaseOffgridScenario();
  engine.start();
  const last = runFor(engine, 60);
  assert(Math.abs(last.residualMW) < 0.05, `power residual too high: ${last.residualMW}`);
  assert(Math.abs(last.frequencyHz - 60) < 0.1, `frequency not stable: ${last.frequencyHz}`);
  assert(last.bessSoc > 0.18 && last.bessSoc < 0.82, `SOC outside operating band: ${last.bessSoc}`);
  return { name: 'Base off-grid steady state', status: 'PASS', metrics: last };
}

function testLoadStepRecovery() {
  const engine = createBaseOffgridScenario();
  engine.start();
  runFor(engine, 10);
  engine.load.setDemandMW(13.5);
  const disturbed = runFor(engine, 2);
  const recovered = runFor(engine, 58);
  assert(Math.abs(disturbed.residualMW) < 0.5, `BESS failed fast balance: ${disturbed.residualMW}`);
  assert(Math.abs(recovered.frequencyHz - 60) < 0.15, `frequency failed recovery: ${recovered.frequencyHz}`);
  assert(Math.abs(recovered.residualMW) < 0.1, `residual failed recovery: ${recovered.residualMW}`);
  return { name: 'Load step recovery', status: 'PASS', metrics: recovered };
}

function testEnergyConservation() {
  const engine = createBaseOffgridScenario();
  engine.start();
  runFor(engine, 120);
  const maxResidual = Math.max(...engine.history.map((sample) => Math.abs(sample.residualMW)));
  assert(maxResidual < 0.8, `max transient residual too high: ${maxResidual}`);
  return { name: 'Power-balance residual bound', status: 'PASS', metrics: { maxResidualMW: maxResidual } };
}

export function runAllTests() {
  const tests = [testBaseSteadyState, testLoadStepRecovery, testEnergyConservation];
  const results = [];
  for (const test of tests) {
    try {
      results.push(test());
    } catch (error) {
      results.push({ name: test.name, status: 'FAIL', error: error.message });
    }
  }
  return results;
}

if (typeof window !== 'undefined') {
  window.runV7Tests = runAllTests;
}
