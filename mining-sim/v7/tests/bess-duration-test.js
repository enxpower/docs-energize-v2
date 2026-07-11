import { createBaseOffgridScenario } from '../scenarios/base-offgrid.js';
import { evaluateBessEnergyAdequacy } from '../rules/reliability.js';
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

export function testBessEnergyDurationDepletion() {
  const c = ACCEPTANCE.bessDuration;
  const engine = createBaseOffgridScenario();
  engine.bess.energyMWhStored = engine.bess.energyMWh * c.initialSoc;

  const predictedDurationMinutes = engine.bess.supportDurationMinutes(c.requiredSupportMW);
  const rule = evaluateBessEnergyAdequacy({
    soc: engine.bess.soc,
    minSoc: engine.bess.minSoc,
    availableDischargeMW: engine.bess.availableDischargeMW(),
    requiredSupportMW: c.requiredSupportMW,
    supportDurationMinutes: predictedDurationMinutes,
    requiredDurationMinutes: c.requiredDurationMinutes,
  });

  assert(rule.id === c.expectedRuleId, `expected ${c.expectedRuleId}, received ${rule.id}`);

  engine.start();
  engine.load.setDemandMW(c.supportLoadMW);

  let depletionTimeSeconds = null;
  const maxSeconds = (predictedDurationMinutes + c.observationMarginMinutes) * 60;
  const steps = Math.ceil(maxSeconds / engine.dtSeconds);
  let last;

  for (let i = 0; i < steps; i += 1) {
    last = engine.step();
    if (depletionTimeSeconds === null && last.residualMW < -c.minimumPostDepletionShortfallMW) {
      depletionTimeSeconds = last.timeSeconds;
      break;
    }
  }

  assert(depletionTimeSeconds !== null, 'BESS support shortfall did not emerge within the predicted duration window');
  const observedDurationMinutes = depletionTimeSeconds / 60;
  const predictionErrorMinutes = Math.abs(observedDurationMinutes - predictedDurationMinutes);
  assert(predictionErrorMinutes <= c.predictionToleranceMinutes, `duration prediction error too high: ${predictionErrorMinutes} min`);

  last = runFor(engine, 30);
  const postDepletionShortfallMW = Math.max(0, -last.residualMW);
  assert(postDepletionShortfallMW >= c.minimumPostDepletionShortfallMW, `post-depletion shortfall not detected: ${postDepletionShortfallMW}`);
  assert(last.state === c.expectedPostDepletionState, `expected ${c.expectedPostDepletionState}, received ${last.state}`);

  return {
    name: 'BESS energy-duration depletion',
    status: 'PASS',
    metrics: {
      initialSoc: c.initialSoc,
      requiredSupportMW: c.requiredSupportMW,
      predictedDurationMinutes,
      observedDurationMinutes,
      predictionErrorMinutes,
      postDepletionShortfallMW,
      finalSoc: last.bessSoc,
      finalFrequencyHz: last.frequencyHz,
      finalState: last.state,
      engineeringRule: rule,
    },
  };
}
