const finiteOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const last = (values) => values.length ? values[values.length - 1] : null;
const minOf = (values, fallback = null) => values.length ? Math.min(...values) : fallback;
const maxOf = (values, fallback = null) => values.length ? Math.max(...values) : fallback;

export const DEFAULT_HARD_CONSTRAINTS = Object.freeze({
  minimumFrequencyHz: 58.8,
  maximumAbsoluteRoCoFHzPerS: 1.0,
  maximumEensMWh: 0,
  minimumN1CoverageRatio: 1.0,
  criticalLoadShedAllowed: false,
});

export const DEFAULT_WEIGHTS = Object.freeze({
  reliability: 0.35,
  production: 0.25,
  operatingCost: 0.20,
  fuel: 0.10,
  bessValue: 0.10,
});

const criticalShedOccurred = ({ samples, events }) => (
  events.some((event) => event.critical === true && [
    'UFLS_STAGE_OPERATED',
    'LOAD_BLOCK_SHED',
    'PRODUCTION_LOAD_CURTAILED',
  ].includes(event.type))
  || samples.some((sample) => (sample.loadBlocks ?? []).some((block) => block.critical && block.shed))
);

export function extractScenarioKpis({
  id,
  name = id,
  samples = [],
  events = [],
  assumptions = {},
  capitalCostEstimate = null,
} = {}) {
  if (!id) throw new Error('Scenario result requires id');
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`Scenario ${id} requires at least one sample`);
  }

  const final = last(samples);
  const frequencies = samples.map((sample) => finiteOr(sample.frequencyHz, 60));
  const rocof = samples.map((sample) => Math.abs(finiteOr(sample.rocofHzPerS, 0)));
  const residuals = samples.map((sample) => Math.abs(finiteOr(sample.residualMW, 0)));
  const n1Ratios = samples
    .map((sample) => Number(sample.n1CoverageRatio))
    .filter(Number.isFinite);
  const n1PassSamples = samples.filter((sample) => sample.n1Status === 'PASS').length;

  return {
    id: String(id),
    name,
    assumptions: { ...assumptions },
    capitalCostEstimate: Number.isFinite(Number(capitalCostEstimate))
      ? Number(capitalCostEstimate)
      : null,
    durationSeconds: finiteOr(final.timeSeconds, samples.length),
    frequencyNadirHz: minOf(frequencies, 60),
    maximumAbsoluteRoCoFHzPerS: maxOf(rocof, 0),
    maximumAbsoluteResidualMW: maxOf(residuals, 0),
    minimumN1CoverageRatio: minOf(n1Ratios, null),
    n1PassFraction: samples.length > 0 ? n1PassSamples / samples.length : 0,
    finalN1Status: final.n1Status ?? 'UNKNOWN',
    eensMWh: finiteOr(final.eensMWh, 0),
    uflsOperationCount: finiteOr(final.uflsOperationCount, 0),
    criticalLoadShed: criticalShedOccurred({ samples, events }),
    deferredProductionTons: finiteOr(final.deferredProductionTons, 0),
    actualProductionTons: finiteOr(final.actualProductionTons, 0),
    productionGrossValue: finiteOr(final.productionGrossValue, 0),
    deferredProductionValue: finiteOr(final.deferredProductionValue, 0),
    dieselFuelLiters: finiteOr(final.dieselFuelLiters, 0),
    dieselFuelCost: finiteOr(final.dieselFuelCost, 0),
    bessEstimatedAvoidedFuelCost: finiteOr(final.bessEstimatedAvoidedFuelCost, 0),
    productionLossUnits: finiteOr(final.productionLossUnits, 0),
    eventCount: events.length,
  };
}

export function evaluateHardConstraints(kpis, constraints = {}) {
  const policy = { ...DEFAULT_HARD_CONSTRAINTS, ...constraints };
  const violations = [];

  if (kpis.frequencyNadirHz < policy.minimumFrequencyHz) {
    violations.push({
      code: 'FREQUENCY_NADIR_BELOW_LIMIT',
      actual: kpis.frequencyNadirHz,
      limit: policy.minimumFrequencyHz,
    });
  }
  if (kpis.maximumAbsoluteRoCoFHzPerS > policy.maximumAbsoluteRoCoFHzPerS) {
    violations.push({
      code: 'ROCOF_ABOVE_LIMIT',
      actual: kpis.maximumAbsoluteRoCoFHzPerS,
      limit: policy.maximumAbsoluteRoCoFHzPerS,
    });
  }
  if (kpis.eensMWh > policy.maximumEensMWh + 1e-12) {
    violations.push({
      code: 'EENS_ABOVE_LIMIT',
      actual: kpis.eensMWh,
      limit: policy.maximumEensMWh,
    });
  }
  if (kpis.minimumN1CoverageRatio !== null
    && kpis.minimumN1CoverageRatio < policy.minimumN1CoverageRatio) {
    violations.push({
      code: 'N1_COVERAGE_BELOW_LIMIT',
      actual: kpis.minimumN1CoverageRatio,
      limit: policy.minimumN1CoverageRatio,
    });
  }
  if (!policy.criticalLoadShedAllowed && kpis.criticalLoadShed) {
    violations.push({
      code: 'CRITICAL_LOAD_SHED',
      actual: true,
      limit: false,
    });
  }

  return {
    feasible: violations.length === 0,
    violations,
    constraints: policy,
  };
}

const normalizeBenefit = (value, min, max) => max - min <= 1e-12 ? 1 : (value - min) / (max - min);
const normalizeCost = (value, min, max) => max - min <= 1e-12 ? 1 : (max - value) / (max - min);

function metricRange(results, key) {
  const values = results.map((result) => finiteOr(result.kpis[key], 0));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function scoreFeasibleResults(results, weights) {
  if (!results.length) return [];
  const ranges = {
    n1: metricRange(results, 'minimumN1CoverageRatio'),
    nadir: metricRange(results, 'frequencyNadirHz'),
    deferred: metricRange(results, 'deferredProductionTons'),
    cost: metricRange(results, 'dieselFuelCost'),
    fuel: metricRange(results, 'dieselFuelLiters'),
    bess: metricRange(results, 'bessEstimatedAvoidedFuelCost'),
  };

  return results.map((result) => {
    const reliability = 0.6 * normalizeBenefit(
      finiteOr(result.kpis.minimumN1CoverageRatio, 0), ranges.n1.min, ranges.n1.max,
    ) + 0.4 * normalizeBenefit(
      result.kpis.frequencyNadirHz, ranges.nadir.min, ranges.nadir.max,
    );
    const production = normalizeCost(
      result.kpis.deferredProductionTons, ranges.deferred.min, ranges.deferred.max,
    );
    const operatingCost = normalizeCost(
      result.kpis.dieselFuelCost, ranges.cost.min, ranges.cost.max,
    );
    const fuel = normalizeCost(
      result.kpis.dieselFuelLiters, ranges.fuel.min, ranges.fuel.max,
    );
    const bessValue = normalizeBenefit(
      result.kpis.bessEstimatedAvoidedFuelCost, ranges.bess.min, ranges.bess.max,
    );
    const dimensions = { reliability, production, operatingCost, fuel, bessValue };
    const weightedScore = Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + finiteOr(weight, 0) * finiteOr(dimensions[key], 0),
      0,
    );
    return { ...result, dimensions, weightedScore };
  });
}

function dominates(a, b) {
  const objectives = [
    ['frequencyNadirHz', 'max'],
    ['minimumN1CoverageRatio', 'max'],
    ['deferredProductionTons', 'min'],
    ['dieselFuelCost', 'min'],
    ['eensMWh', 'min'],
  ];
  let strictlyBetter = false;
  for (const [key, direction] of objectives) {
    const av = finiteOr(a.kpis[key], direction === 'max' ? -Infinity : Infinity);
    const bv = finiteOr(b.kpis[key], direction === 'max' ? -Infinity : Infinity);
    if (direction === 'max') {
      if (av < bv - 1e-12) return false;
      if (av > bv + 1e-12) strictlyBetter = true;
    } else {
      if (av > bv + 1e-12) return false;
      if (av < bv - 1e-12) strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

function decisionReasons(recommended, alternatives) {
  const reasons = [];
  const bestCost = Math.min(...alternatives.map((item) => item.kpis.dieselFuelCost));
  const bestDeferred = Math.min(...alternatives.map((item) => item.kpis.deferredProductionTons));
  const bestN1 = Math.max(...alternatives.map((item) => finiteOr(item.kpis.minimumN1CoverageRatio, 0)));
  if (Math.abs(recommended.kpis.dieselFuelCost - bestCost) < 1e-9) reasons.push('LOWEST_DIESEL_FUEL_COST');
  if (Math.abs(recommended.kpis.deferredProductionTons - bestDeferred) < 1e-9) reasons.push('LOWEST_DEFERRED_PRODUCTION');
  if (Math.abs(finiteOr(recommended.kpis.minimumN1CoverageRatio, 0) - bestN1) < 1e-9) reasons.push('HIGHEST_N1_COVERAGE');
  if (recommended.paretoOptimal) reasons.push('PARETO_OPTIMAL');
  reasons.push('HARD_CONSTRAINTS_SATISFIED');
  return reasons;
}

export class ScenarioComparisonEngine {
  constructor({ hardConstraints = {}, weights = {} } = {}) {
    this.hardConstraints = { ...DEFAULT_HARD_CONSTRAINTS, ...hardConstraints };
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  compare(scenarioResults = []) {
    if (!Array.isArray(scenarioResults) || scenarioResults.length < 2) {
      throw new Error('Scenario comparison requires at least two scenarios');
    }
    const ids = new Set(scenarioResults.map((result) => String(result.id)));
    if (ids.size !== scenarioResults.length) throw new Error('Scenario ids must be unique');

    const evaluated = scenarioResults.map((result) => {
      const kpis = extractScenarioKpis(result);
      const compliance = evaluateHardConstraints(kpis, this.hardConstraints);
      return { id: kpis.id, name: kpis.name, kpis, compliance };
    });
    const feasible = evaluated.filter((result) => result.compliance.feasible);
    const scored = scoreFeasibleResults(feasible, this.weights);
    const scoredWithPareto = scored.map((candidate) => ({
      ...candidate,
      paretoOptimal: !scored.some((other) => other.id !== candidate.id && dominates(other, candidate)),
    }));
    const rankedFeasible = [...scoredWithPareto].sort(
      (a, b) => b.weightedScore - a.weightedScore || a.id.localeCompare(b.id),
    );
    const infeasible = evaluated
      .filter((result) => !result.compliance.feasible)
      .sort((a, b) => a.compliance.violations.length - b.compliance.violations.length || a.id.localeCompare(b.id));

    const recommendation = rankedFeasible.length
      ? {
        status: 'RECOMMENDED',
        scenarioId: rankedFeasible[0].id,
        reasons: decisionReasons(rankedFeasible[0], rankedFeasible),
      }
      : {
        status: 'NO_COMPLIANT_SCENARIO',
        scenarioId: null,
        reasons: ['ALL_SCENARIOS_VIOLATE_HARD_CONSTRAINTS'],
      };

    return {
      recommendation,
      rankedScenarios: [...rankedFeasible, ...infeasible],
      paretoScenarioIds: rankedFeasible.filter((result) => result.paretoOptimal).map((result) => result.id),
      feasibleScenarioIds: rankedFeasible.map((result) => result.id),
      rejectedScenarioIds: infeasible.map((result) => result.id),
      hardConstraints: { ...this.hardConstraints },
      weights: { ...this.weights },
      decisionBoundary: 'HARD_CONSTRAINTS_BEFORE_WEIGHTED_SCORING',
    };
  }
}
