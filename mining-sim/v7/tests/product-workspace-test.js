import {
  guidedReadiness,
  selectChartSamples,
  summarizeConfig,
  updateGuidedConfig,
} from '../workspace/workspace-model.js';
import { applyRevision, buildRevisionGuidance } from '../decision/revision-guidance.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

function config() {
  return {
    id: 'MINE', name: 'Mine', simulation: { durationSeconds: 300 },
    site: { systemBaseMW: 12, baseLoadMW: 6 },
    equipment: {
      diesel: [{ id: 'DG-1', ratedMW: 3.3 }, { id: 'DG-2', ratedMW: 3.3 }],
      bess: { powerMW: 8, energyMWh: 20, initialSoc: 0.6 },
      motors: [{ id: 'M-1' }],
      productionLoads: [{ id: 'P-1', name: 'Auxiliary process', normalMW: 2, minimumMW: 1, safetyCritical: false }],
    },
    controls: { motorStart: { minimumStartIntervalSeconds: 30 } },
    disturbances: [{ id: 'TRIP', type: 'DIESEL_TRIP', timeSeconds: 120 }],
  };
}

export function testGuidedWorkspaceExplainsReadiness() {
  const base = config();
  const summary = summarizeConfig(base);
  const readiness = guidedReadiness(base);
  assert(summary.dieselRatedMW === 6.6, 'diesel summary incorrect');
  assert(summary.bessPowerMW === 8 && summary.bessEnergyMWh === 20, 'BESS summary incorrect');
  assert(readiness.readyToRun && readiness.percent === 100, 'complete configuration was not ready');
  const incomplete = structuredClone(base);
  incomplete.equipment.motors = [];
  const blocked = guidedReadiness(incomplete);
  assert(!blocked.readyToRun && /大型电机/.test(blocked.nextAction), 'missing input did not produce a clear next action');
  return { name: 'Guided workspace exposes readiness and next action', status: 'PASS' };
}

export function testGuidedWorkspaceUpdatesAreIsolated() {
  const base = config();
  const next = updateGuidedConfig(base, { bessPowerMW: 10, initialSocPercent: 55 });
  assert(base.equipment.bess.powerMW === 8, 'guided update mutated original config');
  assert(next.equipment.bess.powerMW === 10, 'guided BESS update missing');
  assert(next.equipment.bess.initialSoc === 0.55, 'guided SOC conversion incorrect');
  return { name: 'Guided workspace updates scenario config immutably', status: 'PASS' };
}

export function testRevisionGuidanceCreatesExecutableAlternative() {
  const base = config();
  const kpis = { frequencyNadirHz: 58.1, maximumAbsoluteRoCoFHzPerS: 1.4, minimumN1CoverageRatio: 0.7, eensMWh: 0, deferredProductionTons: 0 };
  const compliance = {
    feasible: false,
    violations: [
      { code: 'FREQUENCY_NADIR_BELOW_LIMIT', actual: 58.1, limit: 58.8 },
      { code: 'ROCOF_ABOVE_LIMIT', actual: 1.4, limit: 1 },
      { code: 'N1_COVERAGE_BELOW_LIMIT', actual: 0.7, limit: 1 },
    ],
  };
  const guidance = buildRevisionGuidance({ config: base, kpis, compliance });
  const suggestion = guidance.suggestions.find((item) => item.code === 'INCREASE_BESS_POWER');
  assert(guidance.verdict === 'REJECTED', 'unsafe scenario verdict missing');
  assert(suggestion?.change?.to > 8, 'BESS power revision missing');
  const alternative = applyRevision(base, suggestion);
  assert(alternative.id !== base.id, 'revision did not create a new scenario id');
  assert(alternative.equipment.bess.powerMW > base.equipment.bess.powerMW, 'revision was not applied');
  assert(base.equipment.bess.powerMW === 8, 'revision mutated the source scenario');
  return { name: 'Revision guidance creates an isolated executable alternative', status: 'PASS' };
}

export function testWorkspaceChartSamplingPreservesEndState() {
  const samples = Array.from({ length: 5000 }, (_, index) => ({ timeSeconds: index }));
  const selected = selectChartSamples(samples, 500);
  assert(selected.length <= 501, `chart sample count was ${selected.length}`);
  assert(selected[0] === samples[0], 'chart sampling lost first sample');
  assert(selected[selected.length - 1] === samples[samples.length - 1], 'chart sampling lost final sample');
  return { name: 'Simulation workspace chart sampling preserves end state', status: 'PASS' };
}
