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

function testBessTripWhileIdle() {
  const engine = createBaseOffgridScenario();
  engine.bess.energyMWhStored = engine.bess.energyMWh * 0.55;
  engine.start();
  runFor(engine, 20);
  const tripTime = engine.timeSeconds;
  const event = engine.tripBess();
  assert(event, 'BESS was not available to trip');

  const c = ACCEPTANCE.bessTripIdle;
  runFor(engine, c.recoveryWindowSeconds);
  const postTrip = sliceSince(engine, tripTime);
  const final = postTrip.at(-1);
  const fMin = Math.min(...postTrip.map((sample) => sample.frequencyHz));
  const maxRoCoF = Math.max(...postTrip.map((sample) => Math.abs(sample.rocofHzPerS)));

  assert(Math.abs(event.preTripMW) < 0.1, `BESS was not idle before trip: ${event.preTripMW}`);
  assert(fMin >= c.minimumFrequencyNadirHz, `idle BESS trip caused excessive frequency dip: ${fMin}`);
  assert(maxRoCoF <= c.maximumRoCoFHzPerS, `idle BESS trip caused excessive RoCoF: ${maxRoCoF}`);
  assert(final.bessAvailable === false, 'BESS availability did not remain false after trip');
  assert(Math.abs(final.frequencyHz - 60) < c.maximumRecoveredFrequencyErrorHz, `frequency failed recovery: ${final.frequencyHz}`);
  assert(Math.abs(final.residualMW) < c.maximumRecoveredResidualMW, `residual failed recovery: ${final.residualMW}`);

  return {
    name: 'BESS trip while idle',
    status: 'PASS',
    metrics: {
      preTripBessMW: event.preTripMW,
      frequencyNadirHz: fMin,
      peakRoCoFHzPerS: maxRoCoF,
      finalFrequencyHz: final.frequencyHz,
      finalResidualMW: final.residualMW,
    },
  };
}

function testBessTripWhileSupporting() {
  const engine = createBaseOffgridScenario();
  engine.bess.energyMWhStored = engine.bess.energyMWh * 0.55;
  engine.start();
  runFor(engine, 20);

  const c = ACCEPTANCE.bessTripSupporting;
  engine.load.setDemandMW(c.supportLoadMW);
  runFor(engine, c.preTripSupportWindowSeconds);
  const preTripBessMW = engine.history.at(-1).bessMW;
  const tripTime = engine.timeSeconds;
  const event = engine.tripBess();
  assert(event, 'BESS was not available to trip');
  assert(preTripBessMW >= c.minimumPreTripBessMW, `BESS was not providing required support before trip: ${preTripBessMW}`);

  runFor(engine, c.observationWindowSeconds);
  const postTrip = sliceSince(engine, tripTime);
  const final = postTrip.at(-1);
  const fMin = Math.min(...postTrip.map((sample) => sample.frequencyHz));
  const maxRoCoF = Math.max(...postTrip.map((sample) => Math.abs(sample.rocofHzPerS)));
  const persistentDeficitMW = Math.max(0, -final.residualMW);

  assert(fMin >= c.minimumFrequencyNadirHz, `BESS trip frequency nadir below emergency screening limit: ${fMin}`);
  assert(maxRoCoF <= c.maximumRoCoFHzPerS, `BESS trip RoCoF exceeds emergency screening limit: ${maxRoCoF}`);
  assert(final.bessAvailable === false, 'BESS availability did not remain false after trip');
  assert(persistentDeficitMW >= c.expectedMinimumPersistentDeficitMW, `expected generation adequacy shortfall not detected: ${persistentDeficitMW}`);
  assert(final.state === c.expectedState, `expected ${c.expectedState} state, received ${final.state}`);

  return {
    name: 'BESS trip during active support',
    status: 'PASS',
    metrics: {
      preTripBessMW,
      frequencyNadirHz: fMin,
      peakRoCoFHzPerS: maxRoCoF,
      persistentDeficitMW,
      finalFrequencyHz: final.frequencyHz,
      finalState: final.state,
      interpretation: 'Controlled degradation detected: installed synchronous generation is insufficient for the imposed 13.5 MW load without BESS support.',
    },
  };
}

export function runAllTests() {
  const tests = [
    testBaseSteadyState,
    testLoadStepRecovery,
    testEnergyConservation,
    testLargestDieselTrip,
    testBessTripWhileIdle,
    testBessTripWhileSupporting,
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