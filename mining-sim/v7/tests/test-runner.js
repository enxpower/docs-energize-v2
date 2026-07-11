import { createBaseOffgridScenario } from '../scenarios/base-offgrid.js';
import { ACCEPTANCE } from './acceptance-criteria.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

function sliceSince(engine, timeSeconds) {
  return engine.history.filter((sample) => sample.timeSeconds >= timeSeconds);
}

function testBaseSteadyState() {
  const engine = createBaseOffgridScenario();
  engine.start();
  const last = runFor(engine, 60);
  const c = ACCEPTANCE.steadyState;
  assert(Math.abs(last.residualMW) < c.maxPowerResidualMW, `power residual too high: ${last.residualMW}`);
  assert(Math.abs(last.frequencyHz - 60) < c.maxFrequencyErrorHz, `frequency not stable: ${last.frequencyHz}`);
  assert(last.bessSoc > 0.18 && last.bessSoc < 0.82, `SOC outside operating band: ${last.bessSoc}`);
  return { name: 'Base off-grid steady state', status: 'PASS', metrics: last };
}

function testLoadStepRecovery() {
  const engine = createBaseOffgridScenario();
  engine.start();
  runFor(engine, 10);
  engine.load.setDemandMW(13.5);
  const disturbed = runFor(engine, 2);
  const recovered = runFor(engine, ACCEPTANCE.loadStep.recoveryWindowSeconds - 2);
  const c = ACCEPTANCE.loadStep;
  assert(Math.abs(disturbed.residualMW) < c.maxFastResidualMW, `BESS failed fast balance: ${disturbed.residualMW}`);
  assert(Math.abs(recovered.frequencyHz - 60) < c.maxRecoveredFrequencyErrorHz, `frequency failed recovery: ${recovered.frequencyHz}`);
  assert(Math.abs(recovered.residualMW) < c.maxRecoveredResidualMW, `residual failed recovery: ${recovered.residualMW}`);
  return { name: 'Load step recovery', status: 'PASS', metrics: recovered };
}

function testEnergyConservation() {
  const engine = createBaseOffgridScenario();
  engine.start();
  runFor(engine, 120);
  const maxResidual = Math.max(...engine.history.map((sample) => Math.abs(sample.residualMW)));
  assert(maxResidual < ACCEPTANCE.powerBalance.maximumTransientResidualMW, `max transient residual too high: ${maxResidual}`);
  return { name: 'Power-balance residual bound', status: 'PASS', metrics: { maxResidualMW: maxResidual } };
}

function testLargestDieselTrip() {
  const engine = createBaseOffgridScenario();
  engine.start();
  runFor(engine, 20);
  const tripTime = engine.timeSeconds;
  const event = engine.tripLargestDiesel();
  assert(event, 'no online diesel generator available to trip');

  const c = ACCEPTANCE.largestDieselTrip;
  runFor(engine, c.recoveryWindowSeconds);
  const postTrip = sliceSince(engine, tripTime);
  const firstResponseWindow = postTrip.filter((sample) => sample.timeSeconds <= tripTime + c.bessResponseWindowSeconds);
  const final = postTrip.at(-1);
  const fMin = Math.min(...postTrip.map((sample) => sample.frequencyHz));
  const maxRoCoF = Math.max(...postTrip.map((sample) => Math.abs(sample.rocofHzPerS)));
  const maxBessResponse = Math.max(...firstResponseWindow.map((sample) => sample.bessMW));
  const maxResidual = Math.max(...postTrip.map((sample) => Math.abs(sample.residualMW)));

  assert(fMin >= c.minimumFrequencyNadirHz, `frequency nadir below screening limit: ${fMin}`);
  assert(maxRoCoF <= c.maximumRoCoFHzPerS, `RoCoF exceeds screening limit: ${maxRoCoF}`);
  assert(maxBessResponse >= c.minimumBessResponseMW, `BESS fast response insufficient: ${maxBessResponse}`);
  assert(final.onlineDieselCount === 3, `unexpected online diesel count after trip: ${final.onlineDieselCount}`);
  assert(Math.abs(final.frequencyHz - 60) < c.maximumRecoveredFrequencyErrorHz, `frequency failed to recover: ${final.frequencyHz}`);
  assert(Math.abs(final.residualMW) < c.maximumRecoveredResidualMW, `power balance failed to recover: ${final.residualMW}`);

  return {
    name: 'Largest diesel trip response',
    status: 'PASS',
    metrics: {
      trippedUnit: event.equipmentId,
      trippedRatedMW: event.ratedMW,
      preTripMW: event.preTripMW,
      frequencyNadirHz: fMin,
      peakRoCoFHzPerS: maxRoCoF,
      maxBessResponseMW: maxBessResponse,
      maxResidualMW: maxResidual,
      finalFrequencyHz: final.frequencyHz,
      finalResidualMW: final.residualMW,
    },
  };
}

export function runAllTests() {
  const tests = [
    testBaseSteadyState,
    testLoadStepRecovery,
    testEnergyConservation,
    testLargestDieselTrip,
  ];
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
