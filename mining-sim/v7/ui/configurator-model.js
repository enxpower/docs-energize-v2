import { validateScenarioConfig } from '../config/scenario-config.js';
import { createScenarioBatch, createScenarioDefinition } from '../config/scenario-factory.js';
import { ScenarioBatchRunner } from '../decision/scenario-batch-runner.js';
import {
  DEFAULT_HARD_CONSTRAINTS,
  DEFAULT_WEIGHTS,
  ScenarioComparisonEngine,
  extractScenarioKpis,
} from '../decision/scenario-comparison.js';

const clone = (value) => (
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value))
);

const normalizePath = (path) => Array.isArray(path)
  ? path
  : String(path).split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

export const CONFIGURATOR_SECTIONS = Object.freeze([
  { id: 'site', label: 'Site' },
  { id: 'generation', label: 'Diesel' },
  { id: 'bess', label: 'BESS' },
  { id: 'motors', label: 'Large Motors' },
  { id: 'production', label: 'Production' },
  { id: 'process', label: 'Process' },
  { id: 'disturbances', label: 'Scenarios' },
  { id: 'decision', label: 'Decision' },
]);

export function cloneScenarioConfig(config) {
  return clone(config);
}

export function updateScenarioValue(config, path, value) {
  const next = clone(config);
  const parts = normalizePath(path);
  if (!parts.length) return next;
  let cursor = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const following = parts[i + 1];
    if (cursor[key] === undefined || cursor[key] === null) {
      cursor[key] = typeof following === 'number' ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = value;
  return next;
}

export function replaceScenarioCollection(config, path, items) {
  return updateScenarioValue(config, path, clone(items));
}

export function duplicateScenarioConfig(config, existingIds = []) {
  const next = clone(config);
  const used = new Set(existingIds.map(String));
  const root = `${config.id}-COPY`;
  let id = root;
  let suffix = 2;
  while (used.has(id)) {
    id = `${root}-${suffix}`;
    suffix += 1;
  }
  next.id = id;
  next.name = `${config.name ?? config.id} Copy`;
  next.assumptions = {
    ...(next.assumptions ?? {}),
    copiedFromScenarioId: String(config.id),
  };
  return next;
}

export function summarizeScenarioConfig(config) {
  const diesel = config.equipment?.diesel ?? [];
  const motors = config.equipment?.motors ?? [];
  const productionLoads = config.equipment?.productionLoads ?? [];
  const bess = config.equipment?.bess ?? {};
  return {
    id: String(config.id ?? ''),
    name: config.name ?? config.id ?? 'Unnamed scenario',
    modelMaturity: config.metadata?.modelMaturity ?? 'SCREENING',
    durationSeconds: Number(config.simulation?.durationSeconds) || 0,
    dtSeconds: Number(config.simulation?.dtSeconds) || 0,
    systemBaseMW: Number(config.site?.systemBaseMW) || 0,
    baseLoadMW: Number(config.site?.baseLoadMW) || 0,
    dieselCount: diesel.length,
    dieselRatedMW: diesel.reduce((sum, unit) => sum + (Number(unit.ratedMW) || 0), 0),
    bessPowerMW: Number(bess.powerMW) || 0,
    bessEnergyMWh: Number(bess.energyMWh) || 0,
    motorCount: motors.length,
    motorRatedMW: motors.reduce((sum, motor) => sum + (Number(motor.ratedMW) || 0), 0),
    productionLoadCount: productionLoads.length,
    productionNormalMW: productionLoads.reduce((sum, load) => sum + (Number(load.normalMW) || 0), 0),
    disturbanceCount: (config.disturbances ?? []).length,
  };
}

export function validateScenarioWorkspace(configs = []) {
  if (!Array.isArray(configs) || configs.length === 0) {
    return { valid: false, errors: [{ scenarioId: null, message: 'At least one scenario is required' }] };
  }
  const errors = [];
  const ids = new Set();
  let durationSeconds = null;
  for (const config of configs) {
    const scenarioId = String(config?.id ?? 'UNKNOWN');
    if (ids.has(scenarioId)) errors.push({ scenarioId, message: 'Scenario ids must be unique' });
    ids.add(scenarioId);
    try {
      validateScenarioConfig(config);
    } catch (error) {
      errors.push({
        scenarioId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const duration = Number(config?.simulation?.durationSeconds);
    if (durationSeconds === null && Number.isFinite(duration)) durationSeconds = duration;
    if (durationSeconds !== null && Number.isFinite(duration) && Math.abs(duration - durationSeconds) > 1e-9) {
      errors.push({ scenarioId, message: 'All scenarios must use the same durationSeconds for comparison' });
    }
  }
  return { valid: errors.length === 0, errors, durationSeconds };
}

export function runScenarioConfig(config) {
  validateScenarioConfig(config);
  const runner = new ScenarioBatchRunner({
    durationSeconds: Number(config.simulation.durationSeconds),
  });
  const result = runner.runScenario(createScenarioDefinition(config));
  return {
    result,
    kpis: extractScenarioKpis(result),
  };
}

export function compareScenarioConfigs(configs, {
  hardConstraints = DEFAULT_HARD_CONSTRAINTS,
  weights = DEFAULT_WEIGHTS,
} = {}) {
  const workspace = validateScenarioWorkspace(configs);
  if (!workspace.valid) {
    throw new Error(workspace.errors.map((error) => `${error.scenarioId ?? 'Workspace'}: ${error.message}`).join('; '));
  }
  const batch = createScenarioBatch(configs);
  const runner = new ScenarioBatchRunner({ durationSeconds: batch.durationSeconds });
  const results = runner.runAll(batch.definitions);
  const comparison = new ScenarioComparisonEngine({ hardConstraints, weights }).compare(results);
  return { results, comparison };
}

export function formatViolation(violation) {
  const labels = {
    FREQUENCY_NADIR_BELOW_LIMIT: 'Frequency nadir below limit',
    ROCOF_ABOVE_LIMIT: 'RoCoF above limit',
    EENS_ABOVE_LIMIT: 'EENS above limit',
    N1_COVERAGE_BELOW_LIMIT: 'N-1 coverage below limit',
    CRITICAL_LOAD_SHED: 'Critical load shed',
  };
  return labels[violation.code] ?? violation.code;
}
