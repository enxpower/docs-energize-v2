import { readFileSync } from 'node:fs';
import { createScenarioDefinition } from '../config/scenario-factory.js';
import { ScenarioBatchRunner } from '../decision/scenario-batch-runner.js';
import {
  DEFAULT_HARD_CONSTRAINTS,
  evaluateHardConstraints,
  extractScenarioKpis,
} from '../decision/scenario-comparison.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function testReferenceBaselinePassesDeclaredHardConstraints() {
  const config = JSON.parse(readFileSync(new URL('../config/examples/mine-reference-compliant.json', import.meta.url), 'utf8'));
  const runner = new ScenarioBatchRunner({ durationSeconds: config.simulation.durationSeconds });
  const result = runner.runScenario(createScenarioDefinition(config));
  const kpis = extractScenarioKpis(result);
  const compliance = evaluateHardConstraints(kpis, DEFAULT_HARD_CONSTRAINTS);

  assert(compliance.feasible, `reference baseline violations: ${compliance.violations.map((item) => `${item.code}=${item.actual}`).join(', ')}`);
  assert(kpis.eensMWh <= DEFAULT_HARD_CONSTRAINTS.maximumEensMWh, `reference baseline EENS was ${kpis.eensMWh}`);
  assert(!kpis.criticalLoadShed, 'reference baseline shed critical load');

  return {
    name: 'Reference mining baseline passes declared hard constraints',
    status: 'PASS',
    metrics: {
      frequencyNadirHz: kpis.frequencyNadirHz,
      maximumAbsoluteRoCoFHzPerS: kpis.maximumAbsoluteRoCoFHzPerS,
      minimumN1CoverageRatio: kpis.minimumN1CoverageRatio,
      eensMWh: kpis.eensMWh,
      deferredProductionTons: kpis.deferredProductionTons,
      dieselFuelCost: kpis.dieselFuelCost,
    },
  };
}
