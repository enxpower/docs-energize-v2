import {
  CONFIGURATOR_SECTIONS,
  cloneScenarioConfig,
  compareScenarioConfigs,
  duplicateScenarioConfig,
  formatViolation,
  runScenarioConfig,
  summarizeScenarioConfig,
  updateScenarioValue,
  validateScenarioWorkspace,
} from './configurator-model.js';
import {
  DEFAULT_HARD_CONSTRAINTS,
  DEFAULT_WEIGHTS,
} from '../decision/scenario-comparison.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const format = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';

const SECTION_COPY = Object.freeze({
  site: ['Site & simulation', 'Define the common study horizon, base load, control cadence and economic assumptions.'],
  generation: ['Diesel fleet', 'Configure each generating unit explicitly. Hidden generator defaults are not used for design comparison.'],
  bess: ['BESS / PCS', 'Set power, energy, SOC limits, efficiency and physical ramp capability.'],
  motors: ['Large motors', 'Define crusher, pump, fan and conveyor starting behavior using DOL, soft starter or VFD profiles.'],
  production: ['Production loads', 'Separate safety-critical services from curtailable production and map electrical power to throughput.'],
  process: ['Process sequence', 'Define external permissives and the dependency chain that governs production startup and controlled shutdown.'],
  disturbances: ['Disturbance schedule', 'Build the common accident and operating timeline used by the deterministic scenario runner.'],
  decision: ['Decision policy', 'Set hard engineering constraints first, then weights used only to rank compliant scenarios.'],
});

const state = {
  scenarios: [],
  activeIndex: 0,
  section: 'site',
  hardConstraints: { ...DEFAULT_HARD_CONSTRAINTS },
  weights: { ...DEFAULT_WEIGHTS },
  busy: false,
};

const activeConfig = () => state.scenarios[state.activeIndex];
const input = ({ label, path, value, type = 'number', step = 'any', min = null, max = null, unit = '', options = null }) => {
  if (type === 'checkbox') {
    return `<div class="field checkbox"><input data-path="${escapeHtml(path)}" data-value-type="boolean" type="checkbox" ${value ? 'checked' : ''}/><label>${escapeHtml(label)}</label></div>`;
  }
  const attrs = [
    `data-path="${escapeHtml(path)}"`,
    `data-value-type="${type === 'number' ? 'number' : 'string'}"`,
  ];
  if (type === 'number') {
    attrs.push('type="number"', `step="${escapeHtml(step)}"`);
    if (min !== null) attrs.push(`min="${escapeHtml(min)}"`);
    if (max !== null) attrs.push(`max="${escapeHtml(max)}"`);
  }
  const control = options
    ? `<select ${attrs.join(' ')}>${options.map((option) => `<option value="${escapeHtml(option)}" ${String(option) === String(value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`
    : `<input ${attrs.join(' ')} value="${escapeHtml(value)}"/>`;
  return `<div class="field"><label>${escapeHtml(label)}</label>${control}${unit ? `<div class="unit">${escapeHtml(unit)}</div>` : ''}</div>`;
};

const section = (title, help, content, action = '') => `
  <div class="form-section">
    <div class="form-section-header"><div><h2>${escapeHtml(title)}</h2><p class="form-help">${escapeHtml(help)}</p></div>${action}</div>
    ${content}
  </div>`;

function updateActive(path, value) {
  state.scenarios[state.activeIndex] = updateScenarioValue(activeConfig(), path, value);
  renderAll({ preserveFormFocus: true });
}

function renderNav() {
  $('#sectionNav').innerHTML = CONFIGURATOR_SECTIONS.map((item) => `
    <button class="nav-button ${item.id === state.section ? 'active' : ''}" data-section="${item.id}" type="button">${escapeHtml(item.label)}</button>
  `).join('');
}

function renderScenarioList() {
  $('#scenarioList').innerHTML = state.scenarios.map((scenario, index) => {
    const summary = summarizeScenarioConfig(scenario);
    return `<button class="scenario-button ${index === state.activeIndex ? 'active' : ''}" data-scenario-index="${index}" type="button"><strong>${escapeHtml(summary.name)}</strong><small>${escapeHtml(summary.id)} · ${summary.dieselRatedMW.toFixed(1)} MW DG · ${summary.bessPowerMW.toFixed(1)}/${summary.bessEnergyMWh.toFixed(1)} BESS</small></button>`;
  }).join('');
  $('#deleteScenario').disabled = state.scenarios.length <= 1;
}

function renderSite(config) {
  return [
    section('Scenario identity', 'Identity and maturity are retained in every study result.', `<div class="form-grid">
      ${input({ label: 'Scenario ID', path: 'id', value: config.id, type: 'text' })}
      ${input({ label: 'Scenario name', path: 'name', value: config.name, type: 'text' })}
      ${input({ label: 'Model maturity', path: 'metadata.modelMaturity', value: config.metadata?.modelMaturity ?? 'SCREENING', type: 'text', options: ['CONCEPT', 'SCREENING', 'PRE-FEED', 'VENDOR-CALIBRATED'] })}
    </div>`),
    section('Simulation basis', 'All compared scenarios must use the same duration. Smaller time steps increase run time.', `<div class="form-grid">
      ${input({ label: 'Duration', path: 'simulation.durationSeconds', value: config.simulation.durationSeconds, min: 1, unit: 'seconds' })}
      ${input({ label: 'Time step', path: 'simulation.dtSeconds', value: config.simulation.dtSeconds, min: 0.01, step: 0.01, unit: 'seconds' })}
      ${input({ label: 'Nominal frequency', path: 'site.nominalHz', value: config.site.nominalHz ?? 60, min: 50, max: 60, unit: 'Hz' })}
      ${input({ label: 'System base', path: 'site.systemBaseMW', value: config.site.systemBaseMW, min: 0.1, unit: 'MW' })}
      ${input({ label: 'Base non-production load', path: 'site.baseLoadMW', value: config.site.baseLoadMW, min: 0, unit: 'MW' })}
      ${input({ label: 'Capital estimate', path: 'economics.capitalCostEstimate', value: config.economics?.capitalCostEstimate ?? 0, min: 0, unit: 'project currency' })}
    </div>`),
    section('Control cadence', 'Supervisory intervals do not replace fast BESS and governor response.', `<div class="form-grid">
      ${input({ label: 'EMS interval', path: 'controls.emsIntervalSeconds', value: config.controls?.emsIntervalSeconds ?? 20, min: 0.1, unit: 'seconds' })}
      ${input({ label: 'Commitment interval', path: 'controls.commitmentIntervalSeconds', value: config.controls?.commitmentIntervalSeconds ?? 30, min: 0.1, unit: 'seconds' })}
      ${input({ label: 'Minimum motor start interval', path: 'controls.motorStart.minimumStartIntervalSeconds', value: config.controls?.motorStart?.minimumStartIntervalSeconds ?? 30, min: 0, unit: 'seconds' })}
    </div>`),
    section('Operating economics', 'These are operating assumptions only, not a complete financial model.', `<div class="form-grid">
      ${input({ label: 'Fuel price', path: 'economics.fuelPricePerLiter', value: config.economics?.fuelPricePerLiter ?? 0, min: 0, unit: 'per liter' })}
      ${input({ label: 'Product value', path: 'economics.productValuePerTon', value: config.economics?.productValuePerTon ?? 0, min: 0, unit: 'per ton' })}
      ${input({ label: 'BESS marginal fuel displacement', path: 'economics.bessMarginalFuelLitersPerMWh', value: config.economics?.bessMarginalFuelLitersPerMWh ?? 0, min: 0, unit: 'L/MWh' })}
      ${input({ label: 'Default DG idle fuel', path: 'economics.dieselFuelCurves.default.idleLitersPerHour', value: config.economics?.dieselFuelCurves?.default?.idleLitersPerHour ?? 0, min: 0, unit: 'L/h' })}
      ${input({ label: 'Default DG incremental fuel', path: 'economics.dieselFuelCurves.default.incrementalLitersPerMWh', value: config.economics?.dieselFuelCurves?.default?.incrementalLitersPerMWh ?? 0, min: 0, unit: 'L/MWh' })}
    </div>`),
  ].join('');
}

function renderDiesel(config) {
  const rows = config.equipment.diesel.map((unit, index) => `<tr>
    <td><input data-path="equipment.diesel.${index}.id" data-value-type="string" value="${escapeHtml(unit.id)}"/></td>
    <td><input data-path="equipment.diesel.${index}.ratedMW" data-value-type="number" type="number" step="0.1" value="${escapeHtml(unit.ratedMW)}"/></td>
    <td><input data-path="equipment.diesel.${index}.minLoadPU" data-value-type="number" type="number" step="0.01" value="${escapeHtml(unit.minLoadPU ?? 0.35)}"/></td>
    <td><input data-path="equipment.diesel.${index}.rampUpMWPerS" data-value-type="number" type="number" step="0.05" value="${escapeHtml(unit.rampUpMWPerS ?? 0.2)}"/></td>
    <td><input data-path="equipment.diesel.${index}.rampDownMWPerS" data-value-type="number" type="number" step="0.05" value="${escapeHtml(unit.rampDownMWPerS ?? 1)}"/></td>
    <td><input data-path="equipment.diesel.${index}.droopPU" data-value-type="number" type="number" step="0.005" value="${escapeHtml(unit.droopPU ?? 0.04)}"/></td>
    <td><input data-path="equipment.diesel.${index}.inertiaSeconds" data-value-type="number" type="number" step="0.5" value="${escapeHtml(unit.inertiaSeconds ?? 4)}"/></td>
    <td><button class="row-action" data-remove="diesel" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  return section('Diesel generating units', 'Every unit is modeled independently for commitment, reserve and contingency analysis.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>ID</th><th>Rated MW</th><th>Min load pu</th><th>Ramp up</th><th>Ramp down</th><th>Droop pu</th><th>Inertia s</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><button class="button secondary add-row" data-add="diesel" type="button">Add diesel unit</button>`);
}

function renderBess(config) {
  const bess = config.equipment.bess ?? {};
  return section('BESS / PCS rating', 'Power and energy are separate design variables. SOC limits govern usable reserve.', `<div class="form-grid">
    ${input({ label: 'Power rating', path: 'equipment.bess.powerMW', value: bess.powerMW ?? 0, min: 0, unit: 'MW' })}
    ${input({ label: 'Energy rating', path: 'equipment.bess.energyMWh', value: bess.energyMWh ?? 0, min: 0, unit: 'MWh' })}
    ${input({ label: 'Initial SOC', path: 'equipment.bess.initialSoc', value: bess.initialSoc ?? 0.6, min: 0, max: 1, step: 0.01, unit: 'per unit' })}
    ${input({ label: 'Minimum SOC', path: 'equipment.bess.minSoc', value: bess.minSoc ?? 0.18, min: 0, max: 1, step: 0.01, unit: 'per unit' })}
    ${input({ label: 'Maximum SOC', path: 'equipment.bess.maxSoc', value: bess.maxSoc ?? 0.82, min: 0, max: 1, step: 0.01, unit: 'per unit' })}
    ${input({ label: 'Round-trip efficiency', path: 'equipment.bess.roundTripEfficiency', value: bess.roundTripEfficiency ?? 0.965, min: 0.1, max: 1, step: 0.001, unit: 'per unit' })}
    ${input({ label: 'Physical ramp', path: 'equipment.bess.rampMWPerS', value: bess.rampMWPerS ?? bess.powerMW ?? 0, min: 0, unit: 'MW/s' })}
  </div>`);
}

function renderMotors(config) {
  const rows = config.equipment.motors.map((motor, index) => `<tr>
    <td><input data-path="equipment.motors.${index}.id" data-value-type="string" value="${escapeHtml(motor.id)}"/></td>
    <td><input data-path="equipment.motors.${index}.name" data-value-type="string" value="${escapeHtml(motor.name ?? motor.id)}"/></td>
    <td><input data-path="equipment.motors.${index}.ratedMW" data-value-type="number" type="number" step="0.1" value="${escapeHtml(motor.ratedMW)}"/></td>
    <td><select data-path="equipment.motors.${index}.startMode" data-value-type="string">${['DOL','SOFT_STARTER','VFD'].map((mode) => `<option ${mode === motor.startMode ? 'selected' : ''}>${mode}</option>`).join('')}</select></td>
    <td><input data-path="equipment.motors.${index}.accelerationSeconds" data-value-type="number" type="number" step="0.5" value="${escapeHtml(motor.accelerationSeconds ?? '')}" placeholder="profile"/></td>
    <td><input data-path="equipment.motors.${index}.minimumOffSeconds" data-value-type="number" type="number" step="1" value="${escapeHtml(motor.minimumOffSeconds ?? 0)}"/></td>
    <td><button class="row-action" data-remove="motors" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  return section('Large motor inventory', 'Startup method changes pickup power and acceleration time. Project values must be confirmed with the motor and starter vendor.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>ID</th><th>Name</th><th>Rated MW</th><th>Start mode</th><th>Acceleration s</th><th>Min off s</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><button class="button secondary add-row" data-add="motors" type="button">Add motor</button>`);
}

function renderProduction(config) {
  const rows = config.equipment.productionLoads.map((load, index) => `<tr>
    <td><input data-path="equipment.productionLoads.${index}.id" data-value-type="string" value="${escapeHtml(load.id)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.normalMW" data-value-type="number" type="number" step="0.1" value="${escapeHtml(load.normalMW)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.minimumMW" data-value-type="number" type="number" step="0.1" value="${escapeHtml(load.minimumMW ?? 0)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.priority" data-value-type="number" type="number" step="1" value="${escapeHtml(load.priority ?? 1)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.normalThroughputTPH" data-value-type="number" type="number" step="1" value="${escapeHtml(load.normalThroughputTPH ?? 0)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.throughputExponent" data-value-type="number" type="number" step="0.05" value="${escapeHtml(load.throughputExponent ?? 1)}"/></td>
    <td><input data-path="equipment.productionLoads.${index}.safetyCritical" data-value-type="boolean" type="checkbox" ${load.safetyCritical ? 'checked' : ''}/></td>
    <td><button class="row-action" data-remove="productionLoads" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  const controls = config.controls?.productionCurtailment ?? {};
  return section('Production and safety loads', 'Lower priority loads curtail first. Safety-critical loads are excluded from automatic production curtailment.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>ID</th><th>Normal MW</th><th>Minimum MW</th><th>Priority</th><th>Normal t/h</th><th>Exponent</th><th>Safety</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><button class="button secondary add-row" data-add="productionLoads" type="button">Add production load</button>`) +
    section('Curtailment policy', 'Production curtailment is an operating action and remains separate from protection UFLS and EENS.', `<div class="form-grid">
      ${input({ label: 'Deficit trigger', path: 'controls.productionCurtailment.triggerDeficitMW', value: controls.triggerDeficitMW ?? 0.25, min: 0, unit: 'MW' })}
      ${input({ label: 'Restore surplus', path: 'controls.productionCurtailment.restoreSurplusMW', value: controls.restoreSurplusMW ?? 1, min: 0, unit: 'MW' })}
      ${input({ label: 'Post-restore reserve', path: 'controls.productionCurtailment.minimumPostRestoreReserveMW', value: controls.minimumPostRestoreReserveMW ?? 0.5, min: 0, unit: 'MW' })}
      ${input({ label: 'Restore delay', path: 'controls.productionCurtailment.restoreDelaySeconds', value: controls.restoreDelaySeconds ?? 30, min: 0, unit: 'seconds' })}
      ${input({ label: 'Maximum action step', path: 'controls.productionCurtailment.maximumStepMW', value: controls.maximumStepMW ?? 1, min: 0.01, unit: 'MW' })}
    </div>`);
}

function renderProcess(config) {
  const conditionRows = (config.process.conditions ?? []).map((condition, index) => `<tr>
    <td><input data-path="process.conditions.${index}.id" data-value-type="string" value="${escapeHtml(condition.id)}"/></td>
    <td><input data-path="process.conditions.${index}.ready" data-value-type="boolean" type="checkbox" ${condition.ready ? 'checked' : ''}/></td>
    <td><button class="row-action" data-remove="conditions" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  const stepRows = config.process.steps.map((step, index) => `<tr>
    <td><input data-path="process.steps.${index}.id" data-value-type="string" value="${escapeHtml(step.id)}"/></td>
    <td><select data-path="process.steps.${index}.motorId" data-value-type="string">${config.equipment.motors.map((motor) => `<option value="${escapeHtml(motor.id)}" ${motor.id === step.motorId ? 'selected' : ''}>${escapeHtml(motor.id)}</option>`).join('')}</select></td>
    <td><input data-path="process.steps.${index}.prerequisites" data-value-type="list" value="${escapeHtml((step.prerequisites ?? []).join(', '))}"/></td>
    <td><input data-path="process.steps.${index}.priority" data-value-type="number" type="number" step="1" value="${escapeHtml(step.priority ?? 1)}"/></td>
    <td><select data-path="process.steps.${index}.prerequisiteMode" data-value-type="string"><option ${step.prerequisiteMode !== 'ANY' ? 'selected' : ''}>ALL</option><option ${step.prerequisiteMode === 'ANY' ? 'selected' : ''}>ANY</option></select></td>
    <td><button class="row-action" data-remove="steps" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  return section('External conditions', 'Conditions represent safety permits, lubrication availability, cooling water or other non-motor permissives.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>Condition ID</th><th>Ready at start</th><th></th></tr></thead><tbody>${conditionRows}</tbody></table></div><button class="button secondary add-row" data-add="conditions" type="button">Add condition</button>`) +
    section('Process steps', 'Prerequisites use step:ID or condition:ID. Circular dependencies are rejected before simulation.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>Step ID</th><th>Motor</th><th>Prerequisites</th><th>Priority</th><th>Mode</th><th></th></tr></thead><tbody>${stepRows}</tbody></table></div><button class="button secondary add-row" data-add="steps" type="button">Add process step</button>`);
}

function renderDisturbances(config) {
  const actionTypes = ['DIESEL_TRIP','DIESEL_RESET','BESS_TRIP','BESS_RESTORE','SET_BASE_LOAD','SET_PROCESS_CONDITION','PROCESS_START','PROCESS_TRIP','MOTOR_START_REQUEST'];
  const rows = (config.disturbances ?? []).map((action, index) => `<tr>
    <td><input data-path="disturbances.${index}.id" data-value-type="string" value="${escapeHtml(action.id ?? '')}"/></td>
    <td><select data-path="disturbances.${index}.type" data-value-type="string">${actionTypes.map((type) => `<option ${type === action.type ? 'selected' : ''}>${type}</option>`).join('')}</select></td>
    <td><input data-path="disturbances.${index}.timeSeconds" data-value-type="number" type="number" step="0.1" value="${escapeHtml(action.timeSeconds ?? 0)}"/></td>
    <td><input data-path="disturbances.${index}.targetId" data-value-type="string" value="${escapeHtml(action.targetId ?? '')}" placeholder="equipment id"/></td>
    <td><input data-path="disturbances.${index}.valueMW" data-value-type="number" type="number" step="0.1" value="${escapeHtml(action.valueMW ?? '')}" placeholder="optional"/></td>
    <td><button class="row-action" data-remove="disturbances" data-index="${index}" type="button">Remove</button></td>
  </tr>`).join('');
  return section('Common disturbance timeline', 'Comparison is only meaningful when alternatives experience an equivalent event schedule.', `<div class="table-wrap"><table class="config-table"><thead><tr><th>Action ID</th><th>Type</th><th>Time s</th><th>Target</th><th>Value MW</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><button class="button secondary add-row" data-add="disturbances" type="button">Add disturbance</button>`) +
    section('Compiled input preview', 'This is the data-only scenario contract used by the factory. No executable code is stored in the JSON.', `<pre class="json-preview">${escapeHtml(JSON.stringify(config.disturbances ?? [], null, 2))}</pre>`);
}

function policyInput(label, group, key, value, extra = {}) {
  const isBoolean = typeof value === 'boolean';
  if (isBoolean) return `<div class="field checkbox"><input data-policy-group="${group}" data-policy-key="${key}" data-value-type="boolean" type="checkbox" ${value ? 'checked' : ''}/><label>${escapeHtml(label)}</label></div>`;
  return `<div class="field"><label>${escapeHtml(label)}</label><input data-policy-group="${group}" data-policy-key="${key}" data-value-type="number" type="number" step="${extra.step ?? 0.01}" value="${escapeHtml(value)}"/><div class="unit">${escapeHtml(extra.unit ?? '')}</div></div>`;
}

function renderDecision() {
  return section('Hard constraints', 'A scenario that violates any hard constraint is rejected before scoring, regardless of cost.', `<div class="form-grid">
    ${policyInput('Minimum frequency', 'hardConstraints', 'minimumFrequencyHz', state.hardConstraints.minimumFrequencyHz, { unit: 'Hz' })}
    ${policyInput('Maximum absolute RoCoF', 'hardConstraints', 'maximumAbsoluteRoCoFHzPerS', state.hardConstraints.maximumAbsoluteRoCoFHzPerS, { unit: 'Hz/s' })}
    ${policyInput('Maximum EENS', 'hardConstraints', 'maximumEensMWh', state.hardConstraints.maximumEensMWh, { unit: 'MWh' })}
    ${policyInput('Minimum N-1 coverage', 'hardConstraints', 'minimumN1CoverageRatio', state.hardConstraints.minimumN1CoverageRatio, { unit: 'ratio' })}
    ${policyInput('Critical load shedding allowed', 'hardConstraints', 'criticalLoadShedAllowed', state.hardConstraints.criticalLoadShedAllowed)}
  </div>`) +
    section('Compliant-scenario scoring', 'Weights only rank scenarios that already satisfy every hard constraint.', `<div class="form-grid">
      ${policyInput('Reliability weight', 'weights', 'reliability', state.weights.reliability)}
      ${policyInput('Production weight', 'weights', 'production', state.weights.production)}
      ${policyInput('Operating cost weight', 'weights', 'operatingCost', state.weights.operatingCost)}
      ${policyInput('Fuel weight', 'weights', 'fuel', state.weights.fuel)}
      ${policyInput('BESS value weight', 'weights', 'bessValue', state.weights.bessValue)}
    </div><div class="tag-list"><span class="tag">Hard constraints first</span><span class="tag">Pareto alternatives retained</span><span class="tag">Deterministic ranking</span></div>`);
}

function renderForm() {
  const config = activeConfig();
  const renderers = {
    site: renderSite,
    generation: renderDiesel,
    bess: renderBess,
    motors: renderMotors,
    production: renderProduction,
    process: renderProcess,
    disturbances: renderDisturbances,
    decision: renderDecision,
  };
  $('#formPanel').innerHTML = renderers[state.section](config);
}

function renderSummary() {
  const summary = summarizeScenarioConfig(activeConfig());
  $('#summaryName').textContent = summary.name;
  $('#modelMaturity').textContent = summary.modelMaturity;
  $('#scenarioSummary').innerHTML = [
    ['ID', summary.id],
    ['Study horizon', `${summary.durationSeconds}s @ ${summary.dtSeconds}s`],
    ['System base', `${summary.systemBaseMW.toFixed(1)} MW`],
    ['Base load', `${summary.baseLoadMW.toFixed(1)} MW`],
    ['Diesel fleet', `${summary.dieselCount} / ${summary.dieselRatedMW.toFixed(1)} MW`],
    ['BESS', `${summary.bessPowerMW.toFixed(1)} MW / ${summary.bessEnergyMWh.toFixed(1)} MWh`],
    ['Large motors', `${summary.motorCount} / ${summary.motorRatedMW.toFixed(1)} MW`],
    ['Production loads', `${summary.productionLoadCount} / ${summary.productionNormalMW.toFixed(1)} MW`],
    ['Disturbances', summary.disturbanceCount],
  ].map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  const weightTotal = Object.values(state.weights).reduce((sum, value) => sum + number(value), 0);
  $('#decisionSummary').innerHTML = `<strong>Hard limits</strong><br>f ≥ ${format(state.hardConstraints.minimumFrequencyHz, 2)} Hz<br>|RoCoF| ≤ ${format(state.hardConstraints.maximumAbsoluteRoCoFHzPerS, 2)} Hz/s<br>EENS ≤ ${format(state.hardConstraints.maximumEensMWh, 4)} MWh<br>N-1 ≥ ${format(state.hardConstraints.minimumN1CoverageRatio, 2)}<br><br><strong>Weight total</strong><br>${format(weightTotal, 2)}`;
}

function renderValidation() {
  const workspace = validateScenarioWorkspace(state.scenarios);
  const panel = $('#validationPanel');
  if (workspace.valid) {
    panel.className = 'validation-panel ok';
    panel.innerHTML = `<strong>Configuration valid</strong>${state.scenarios.length} scenario${state.scenarios.length === 1 ? '' : 's'} ready. Common horizon: ${workspace.durationSeconds}s.`;
    $('#workspaceStatus').className = 'status-chip ok';
    $('#workspaceStatus').textContent = 'VALID';
  } else {
    panel.className = 'validation-panel';
    panel.innerHTML = `<strong>Configuration blocked</strong>${workspace.errors.map((error) => `<div>${escapeHtml(error.scenarioId ?? 'Workspace')}: ${escapeHtml(error.message)}</div>`).join('')}`;
    $('#workspaceStatus').className = 'status-chip bad';
    $('#workspaceStatus').textContent = `${workspace.errors.length} ERROR${workspace.errors.length === 1 ? '' : 'S'}`;
  }
  $('#runScenario').disabled = state.busy || !workspace.errors.every((error) => error.scenarioId !== activeConfig().id);
  $('#compareScenarios').disabled = state.busy || !workspace.valid || state.scenarios.length < 2;
  $('#mobileRun').disabled = $('#runScenario').disabled;
  $('#mobileCompare').disabled = $('#compareScenarios').disabled;
}

function renderTitles() {
  const [title, description] = SECTION_COPY[state.section];
  $('#sectionEyebrow').textContent = state.section.toUpperCase();
  $('#sectionTitle').textContent = title;
  $('#sectionDescription').textContent = description;
}

function renderAll({ preserveFormFocus = false } = {}) {
  const focusedPath = preserveFormFocus ? document.activeElement?.dataset?.path : null;
  const selection = preserveFormFocus && document.activeElement instanceof HTMLInputElement
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : null;
  renderNav();
  renderScenarioList();
  renderTitles();
  renderForm();
  renderSummary();
  renderValidation();
  document.body.classList.toggle('loading', state.busy);
  if (focusedPath) {
    const next = document.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`);
    next?.focus();
    if (selection && next instanceof HTMLInputElement && next.type === 'text') next.setSelectionRange(...selection);
  }
}

function addCollectionItem(type) {
  const config = activeConfig();
  if (type === 'diesel') {
    const items = [...config.equipment.diesel, { id: `DG-${config.equipment.diesel.length + 1}`, ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.2, rampDownMWPerS: 1, droopPU: 0.04, inertiaSeconds: 4 }];
    updateActive('equipment.diesel', items);
  }
  if (type === 'motors') {
    const items = [...config.equipment.motors, { id: `MOTOR-${config.equipment.motors.length + 1}`, name: 'New Motor', ratedMW: 1, startMode: 'VFD', minimumOffSeconds: 0 }];
    updateActive('equipment.motors', items);
  }
  if (type === 'productionLoads') {
    const items = [...config.equipment.productionLoads, { id: `LOAD-${config.equipment.productionLoads.length + 1}`, normalMW: 1, minimumMW: 0.2, priority: 1, normalThroughputTPH: 0, throughputExponent: 1 }];
    updateActive('equipment.productionLoads', items);
  }
  if (type === 'conditions') {
    const items = [...(config.process.conditions ?? []), { id: `CONDITION-${(config.process.conditions ?? []).length + 1}`, ready: true }];
    updateActive('process.conditions', items);
  }
  if (type === 'steps') {
    const motorId = config.equipment.motors[0]?.id ?? '';
    const items = [...config.process.steps, { id: `step-${config.process.steps.length + 1}`, motorId, prerequisites: [], priority: 1 }];
    updateActive('process.steps', items);
  }
  if (type === 'disturbances') {
    const items = [...(config.disturbances ?? []), { id: `ACTION-${(config.disturbances ?? []).length + 1}`, type: 'PROCESS_START', timeSeconds: 0 }];
    updateActive('disturbances', items);
  }
}

function removeCollectionItem(type, index) {
  const config = activeConfig();
  const paths = {
    diesel: 'equipment.diesel',
    motors: 'equipment.motors',
    productionLoads: 'equipment.productionLoads',
    conditions: 'process.conditions',
    steps: 'process.steps',
    disturbances: 'disturbances',
  };
  const path = paths[type];
  const source = path.split('.').reduce((cursor, key) => cursor?.[key], config) ?? [];
  updateActive(path, source.filter((_, itemIndex) => itemIndex !== index));
}

function setBusy(busy, message = '') {
  state.busy = busy;
  $('#workspaceStatus').textContent = message || (busy ? 'RUNNING' : 'VALID');
  renderValidation();
  document.body.classList.toggle('loading', busy);
}

function singleResultHtml({ kpis, result }) {
  return `<div class="result-header"><div><p class="eyebrow">SINGLE SCENARIO RESULT</p><h2>${escapeHtml(kpis.name)}</h2><p>${result.execution.sampleCount} samples · ${result.events.length} events · ${format(kpis.durationSeconds, 1)} seconds</p></div><span class="status-chip neutral">EVIDENCE GENERATED</span></div>
  <div class="kpi-grid">
    ${kpi('Frequency nadir', `${format(kpis.frequencyNadirHz, 3)} Hz`)}
    ${kpi('Maximum RoCoF', `${format(kpis.maximumAbsoluteRoCoFHzPerS, 3)} Hz/s`)}
    ${kpi('Minimum N-1 coverage', format(kpis.minimumN1CoverageRatio, 3))}
    ${kpi('EENS', `${format(kpis.eensMWh, 5)} MWh`)}
    ${kpi('Actual production', `${format(kpis.actualProductionTons, 2)} t`)}
    ${kpi('Deferred production', `${format(kpis.deferredProductionTons, 2)} t`)}
    ${kpi('Diesel fuel', `${format(kpis.dieselFuelLiters, 1)} L`)}
    ${kpi('Diesel fuel cost', format(kpis.dieselFuelCost, 2))}
  </div>
  <details><summary>Execution evidence</summary><pre class="json-preview">${escapeHtml(JSON.stringify({ assumptions: result.assumptions, executedActions: result.execution.executedActions, finalKpis: kpis }, null, 2))}</pre></details>`;
}

function kpi(label, value) {
  return `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function comparisonHtml({ comparison }) {
  const recommended = comparison.recommendation.status === 'RECOMMENDED';
  const recommendationText = recommended
    ? `Recommended: ${comparison.recommendation.scenarioId}`
    : 'No compliant scenario';
  const rows = comparison.rankedScenarios.map((scenario, index) => {
    const violations = scenario.compliance.violations ?? [];
    return `<tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(scenario.name)}</strong><br><small>${escapeHtml(scenario.id)}</small></td>
      <td class="${scenario.compliance.feasible ? 'pass' : 'fail'}">${scenario.compliance.feasible ? 'PASS' : 'REJECTED'}</td>
      <td>${scenario.paretoOptimal ? '<span class="pareto">YES</span>' : '—'}</td>
      <td>${scenario.weightedScore === undefined ? '—' : format(scenario.weightedScore, 3)}</td>
      <td>${format(scenario.kpis.frequencyNadirHz, 3)}</td>
      <td>${format(scenario.kpis.minimumN1CoverageRatio, 3)}</td>
      <td>${format(scenario.kpis.eensMWh, 5)}</td>
      <td>${format(scenario.kpis.deferredProductionTons, 2)}</td>
      <td>${format(scenario.kpis.dieselFuelCost, 2)}</td>
      <td>${violations.length ? `<ul class="violation-list">${violations.map((violation) => `<li>${escapeHtml(formatViolation(violation))}</li>`).join('')}</ul>` : '—'}</td>
    </tr>`;
  }).join('');
  return `<div class="result-header"><div><p class="eyebrow">SCENARIO DECISION</p><h2>${escapeHtml(recommendationText)}</h2><p>${comparison.feasibleScenarioIds.length} compliant · ${comparison.rejectedScenarioIds.length} rejected · ${comparison.paretoScenarioIds.length} Pareto alternatives</p></div></div>
  <div class="recommendation ${recommended ? '' : 'bad'}"><strong>${escapeHtml(comparison.recommendation.status)}</strong><br>${escapeHtml(comparison.recommendation.reasons.join(' · '))}</div>
  <div class="table-wrap" style="margin-top:12px"><table class="result-table"><thead><tr><th>Rank</th><th>Scenario</th><th>Compliance</th><th>Pareto</th><th>Score</th><th>f nadir</th><th>N-1</th><th>EENS</th><th>Deferred t</th><th>Fuel cost</th><th>Violations</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function runActiveScenario() {
  setBusy(true, 'RUNNING');
  $('#resultsPanel').innerHTML = '<div class="empty-state"><strong class="spinner-text">Running deterministic study</strong><span>Creating a fresh engine and applying the configured disturbance schedule.</span></div>';
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const output = runScenarioConfig(activeConfig());
    $('#resultsPanel').innerHTML = singleResultHtml(output);
  } catch (error) {
    $('#resultsPanel').innerHTML = `<div class="recommendation bad"><strong>Run failed</strong><br>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    setBusy(false);
    renderValidation();
  }
}

async function compareAllScenarios() {
  setBusy(true, 'COMPARING');
  $('#resultsPanel').innerHTML = '<div class="empty-state"><strong class="spinner-text">Comparing scenarios</strong><span>Running isolated engines with a common horizon, then applying hard constraints and Pareto analysis.</span></div>';
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const output = compareScenarioConfigs(state.scenarios, {
      hardConstraints: state.hardConstraints,
      weights: state.weights,
    });
    $('#resultsPanel').innerHTML = comparisonHtml(output);
  } catch (error) {
    $('#resultsPanel').innerHTML = `<div class="recommendation bad"><strong>Comparison failed</strong><br>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    setBusy(false);
    renderValidation();
  }
}

function exportActiveJson() {
  const blob = new Blob([JSON.stringify(activeConfig(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${activeConfig().id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importJson(file) {
  const text = await file.text();
  const config = JSON.parse(text);
  state.scenarios.push(config);
  state.activeIndex = state.scenarios.length - 1;
  renderAll();
}

document.addEventListener('click', (event) => {
  const sectionButton = event.target.closest('[data-section]');
  if (sectionButton) {
    state.section = sectionButton.dataset.section;
    renderAll();
    return;
  }
  const scenarioButton = event.target.closest('[data-scenario-index]');
  if (scenarioButton) {
    state.activeIndex = Number(scenarioButton.dataset.scenarioIndex);
    renderAll();
    return;
  }
  const add = event.target.closest('[data-add]');
  if (add) addCollectionItem(add.dataset.add);
  const remove = event.target.closest('[data-remove]');
  if (remove) removeCollectionItem(remove.dataset.remove, Number(remove.dataset.index));
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-path]')) {
    const type = target.dataset.valueType;
    let value = target.value;
    if (type === 'number') value = target.value === '' ? null : Number(target.value);
    if (type === 'boolean') value = target.checked;
    if (type === 'list') value = target.value.split(',').map((item) => item.trim()).filter(Boolean);
    updateActive(target.dataset.path, value);
  }
  if (target.matches('[data-policy-group]')) {
    const group = target.dataset.policyGroup;
    const key = target.dataset.policyKey;
    state[group][key] = target.dataset.valueType === 'boolean' ? target.checked : Number(target.value);
    renderAll({ preserveFormFocus: true });
  }
});

$('#duplicateScenario').addEventListener('click', () => {
  const copy = duplicateScenarioConfig(activeConfig(), state.scenarios.map((scenario) => scenario.id));
  state.scenarios.push(copy);
  state.activeIndex = state.scenarios.length - 1;
  renderAll();
});
$('#deleteScenario').addEventListener('click', () => {
  if (state.scenarios.length <= 1) return;
  state.scenarios.splice(state.activeIndex, 1);
  state.activeIndex = Math.max(0, state.activeIndex - 1);
  renderAll();
});
$('#exportJson').addEventListener('click', exportActiveJson);
$('#importJson').addEventListener('change', async (event) => {
  try {
    if (event.target.files?.[0]) await importJson(event.target.files[0]);
  } catch (error) {
    $('#resultsPanel').innerHTML = `<div class="recommendation bad"><strong>Import failed</strong><br>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    event.target.value = '';
  }
});
$('#runScenario').addEventListener('click', runActiveScenario);
$('#compareScenarios').addEventListener('click', compareAllScenarios);
$('#mobileRun').addEventListener('click', runActiveScenario);
$('#mobileCompare').addEventListener('click', compareAllScenarios);

async function initialize() {
  try {
    const response = await fetch('../config/examples/mine-screening.json');
    if (!response.ok) throw new Error(`Example configuration returned HTTP ${response.status}`);
    const base = await response.json();
    const alternative = duplicateScenarioConfig(base, [base.id]);
    alternative.name = '12 MW Mine Screening Alternative';
    alternative.equipment.bess.powerMW = 10;
    alternative.equipment.bess.energyMWh = 24;
    state.scenarios = [base, alternative];
    renderAll();
  } catch (error) {
    $('#workspaceStatus').className = 'status-chip bad';
    $('#workspaceStatus').textContent = 'LOAD FAILED';
    $('#validationPanel').className = 'validation-panel';
    $('#validationPanel').innerHTML = `<strong>Configurator initialization failed</strong>${escapeHtml(error instanceof Error ? error.message : String(error))}`;
  }
}

initialize();
