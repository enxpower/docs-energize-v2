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

export function testMultiTimescaleControl() {
  const c = ACCEPTANCE.multiTimescaleControl;
  const engine = createBaseOffgridScenario();
  engine.start();

  runFor(engine, c.disturbanceAtSeconds);
  const baseline = engine.history.at(-1);
  const baselineEmsSetpointMW = baseline.dieselEmsSetpointMW;

  engine.load.setDemandMW(c.disturbanceLoadMW);
  const disturbanceTime = engine.timeSeconds;
  runFor(engine, c.fastWindowSeconds);

  const fastWindow = engine.history.filter(
    (sample) => sample.timeSeconds > disturbanceTime
      && sample.timeSeconds <= disturbanceTime + c.fastWindowSeconds + 1e-9,
  );
  const maxFastBessMW = Math.max(...fastWindow.map((sample) => sample.bessMW));
  const maxEmsSetpointDuringFastWindow = Math.max(...fastWindow.map((sample) => sample.dieselEmsSetpointMW));
  const minEmsSetpointDuringFastWindow = Math.min(...fastWindow.map((sample) => sample.dieselEmsSetpointMW));

  assert(maxFastBessMW >= c.minimumFastBessResponseMW, `BESS fast response too small: ${maxFastBessMW}`);
  assert(
    Math.abs(maxEmsSetpointDuringFastWindow - baselineEmsSetpointMW) < 1e-6
      && Math.abs(minEmsSetpointDuringFastWindow - baselineEmsSetpointMW) < 1e-6,
    'EMS changed supervisory setpoint inside the fast-response window',
  );

  runFor(engine, c.primaryWindowSeconds - c.fastWindowSeconds);
  const primaryWindow = engine.history.filter(
    (sample) => sample.timeSeconds > disturbanceTime
      && sample.timeSeconds <= disturbanceTime + c.primaryWindowSeconds + 1e-9,
  );
  const maxGovernorPrimaryMW = Math.max(...primaryWindow.map((sample) => sample.dieselPrimaryResponseMW));

  assert(
    maxGovernorPrimaryMW >= c.minimumGovernorPrimaryResponseMW,
    `governor primary response too small: ${maxGovernorPrimaryMW}`,
  );

  const secondsToNextEms = Math.max(0, c.emsIntervalSeconds - engine.timeSeconds + 0.2);
  runFor(engine, secondsToNextEms);
  const afterEms = engine.history.at(-1);
  const emsSetpointChangeMW = afterEms.dieselEmsSetpointMW - baselineEmsSetpointMW;

  assert(
    emsSetpointChangeMW >= c.minimumEmsSetpointChangeAfterDispatchMW,
    `EMS did not assume the sustained load change after its supervisory interval: ${emsSetpointChangeMW}`,
  );

  return {
    name: 'Multi-timescale EMS / governor / BESS coordination',
    status: 'PASS',
    metrics: {
      baselineEmsSetpointMW,
      maxFastBessMW,
      maxGovernorPrimaryResponseMW: maxGovernorPrimaryMW,
      postDispatchEmsSetpointMW: afterEms.dieselEmsSetpointMW,
      emsSetpointChangeMW,
      finalFrequencyHz: afterEms.frequencyHz,
      finalResidualMW: afterEms.residualMW,
    },
  };
}
