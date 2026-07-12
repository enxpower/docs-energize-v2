import { validateScenarioConfig } from '../config/scenario-config.js';
import { createScenarioDefinition } from '../config/scenario-factory.js';
import { ScenarioBatchRunner } from '../decision/scenario-batch-runner.js';
import {
  DEFAULT_HARD_CONSTRAINTS,
  ScenarioComparisonEngine,
  evaluateHardConstraints,
  extractScenarioKpis,
} from '../decision/scenario-comparison.js';
import { applyRevision, buildRevisionGuidance } from '../decision/revision-guidance.js';
import {
  WORKSPACE_STEPS,
  guidedReadiness,
  selectChartSamples,
  summarizeConfig,
  updateGuidedConfig,
} from './workspace-model.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const state = {
  config: null,
  activeView: 'start',
  task: 'ASSESS',
  result: null,
  kpis: null,
  compliance: null,
  guidance: null,
  selectedRevision: null,
  revisionConfig: null,
  comparison: null,
  replayIndex: 0,
  replayTimer: null,
  replaySpeed: 1,
};

const VIEW_IDS = Object.fromEntries(WORKSPACE_STEPS.map((step) => [step.id, `${step.id}View`]));
const EVENT_LABELS = {
  INITIAL_STEADY_STATE_ESTABLISHED: '初始稳态建立',
  PROCESS_SEQUENCE_START_REQUESTED: '工艺启动请求',
  PROCESS_STEP_START_REQUESTED: '工艺设备启动请求',
  MOTOR_START_ACCEPTED: '电机启动许可',
  MOTOR_START_COMPLETED: '电机启动完成',
  MOTOR_START_FAILED: '电机启动失败',
  DG_TRIP: '柴油机跳闸',
  BESS_TRIP: 'BESS跳闸',
  BESS_RESTORED: 'BESS恢复',
  UFLS_STAGE_OPERATED: 'UFLS动作',
  PRODUCTION_LOAD_CURTAILED: '生产负荷降低',
  PRODUCTION_LOAD_RESTORED: '生产负荷恢复',
};
const ACTION_LABELS = {
  PROCESS_START: '启动生产工艺',
  DIESEL_TRIP: '柴油机跳闸',
  DIESEL_RESET: '柴油机复位',
  BESS_TRIP: 'BESS跳闸',
  BESS_RESTORE: 'BESS恢复',
  SET_BASE_LOAD: '改变基础负荷',
  MOTOR_START_REQUEST: '大型电机启动请求',
  PROCESS_TRIP: '工艺跳闸',
};
const VIOLATION_LABELS = {
  FREQUENCY_NADIR_BELOW_LIMIT: '频率最低值低于限值',
  ROCOF_ABOVE_LIMIT: 'RoCoF超过限值',
  EENS_ABOVE_LIMIT: '未供电量超过限值',
  N1_COVERAGE_BELOW_LIMIT: 'N-1快速备用覆盖不足',
  CRITICAL_LOAD_SHED: '关键负荷被切除',
};

function go(view) {
  if (!VIEW_IDS[view]) return;
  state.activeView = view;
  $$('.view').forEach((node) => node.classList.toggle('active', node.id === VIEW_IDS[view]));
  $$('#workflowNav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderNav() {
  $('#workflowNav').innerHTML = WORKSPACE_STEPS.map((step, index) => `<button data-view="${step.id}" data-index="${index + 1}">${step.label}</button>`).join('');
  $$('#workflowNav button').forEach((button) => button.addEventListener('click', () => go(button.dataset.view)));
  go(state.activeView);
}

function invalidateRun() {
  state.result = null;
  state.kpis = null;
  state.compliance = null;
  state.guidance = null;
  state.selectedRevision = null;
  state.revisionConfig = null;
  state.comparison = null;
  $('#runBadge').textContent = 'NOT RUN';
  $('#runBadge').className = 'badge neutral';
  $('#openVerdict').disabled = true;
  $('#compareRevision').disabled = true;
}

function renderConfig() {
  if (!state.config) return;
  const summary = summarizeConfig(state.config);
  const readiness = guidedReadiness(state.config);
  $('#railProjectName').textContent = summary.name;
  $('#railProjectMeta').textContent = `${summary.systemBaseMW.toFixed(1)} MW · ${state.config.metadata?.modelMaturity ?? 'SCREENING'}`;
  $('#readinessPercent').textContent = `${readiness.percent}%`;
  $('#readinessBar').style.width = `${readiness.percent}%`;
  $('#nextAction').textContent = readiness.readyToRun ? '下一步：运行工程仿真' : `下一步：确认${readiness.nextAction}`;
  $('#maturityBadge').textContent = state.config.metadata?.modelMaturity ?? 'SCREENING';
  $('#projectName').value = state.config.name ?? state.config.id;
  $('#systemBaseMW').value = state.config.site.systemBaseMW;
  $('#baseLoadMW').value = state.config.site.baseLoadMW;
  $('#bessPowerMW').value = state.config.equipment.bess.powerMW;
  $('#bessEnergyMWh').value = state.config.equipment.bess.energyMWh;
  $('#initialSocPercent').value = Math.round((state.config.equipment.bess.initialSoc ?? 0) * 100);
  $('#durationSeconds').value = state.config.simulation.durationSeconds;
  $('#dieselSummary').textContent = `${summary.dieselCount}台 · ${summary.dieselRatedMW.toFixed(1)} MW`;
  $('#motorSummary').textContent = `${summary.motorCount}台大型电机`;
  $('#productionSummary').textContent = `${summary.productionLoadMW.toFixed(1)} MW生产负荷`;
  try {
    validateScenarioConfig(state.config);
    $('#configState').textContent = 'CONFIG VALID';
    $('#configState').className = 'state-chip good';
  } catch (error) {
    $('#configState').textContent = 'CONFIG INVALID';
    $('#configState').className = 'state-chip bad';
  }
  renderScenario();
}

function renderScenario() {
  const actions = state.config?.disturbances ?? [];
  $('#scenarioTimeline').innerHTML = actions.map((action) => `<article class="scenario-item"><div class="scenario-time">${fmt(action.timeSeconds, 0)} s</div><div><strong>${escapeHtml(ACTION_LABELS[action.type] ?? action.type)}</strong><p>${escapeHtml(action.targetId ? `目标：${action.targetId}` : action.id)}</p></div><span class="scenario-tag">${escapeHtml(action.type)}</span></article>`).join('') || '<div class="scenario-help">尚未配置事故场景。</div>';
}

function applyGuidedInputs() {
  state.config = updateGuidedConfig(state.config, {
    name: $('#projectName').value,
    systemBaseMW: $('#systemBaseMW').value,
    baseLoadMW: $('#baseLoadMW').value,
    bessPowerMW: $('#bessPowerMW').value,
    bessEnergyMWh: $('#bessEnergyMWh').value,
    initialSocPercent: $('#initialSocPercent').value,
    durationSeconds: $('#durationSeconds').value,
  });
  invalidateRun();
  renderConfig();
}

function runConfig(config) {
  validateScenarioConfig(config);
  const runner = new ScenarioBatchRunner({ durationSeconds: config.simulation.durationSeconds });
  return runner.runScenario(createScenarioDefinition(config));
}

function runStudy() {
  $('#runBadge').textContent = 'RUNNING';
  $('#runBadge').className = 'badge';
  $('#runStudy').disabled = true;
  try {
    state.result = runConfig(state.config);
    state.kpis = extractScenarioKpis(state.result);
    state.compliance = evaluateHardConstraints(state.kpis, DEFAULT_HARD_CONSTRAINTS);
    state.guidance = buildRevisionGuidance({ config: state.config, kpis: state.kpis, compliance: state.compliance });
    state.replayIndex = state.result.samples.length - 1;
    renderReplayFrame(state.replayIndex);
    renderEventTimeline();
    renderVerdict();
    renderRevisions();
    $('#runBadge').textContent = state.compliance.feasible ? 'COMPLIANT' : 'REJECTED';
    $('#runBadge').className = `badge ${state.compliance.feasible ? 'good' : 'bad'}`;
    $('#openVerdict').disabled = false;
    $('#playReplay').disabled = false;
    $('#pauseReplay').disabled = false;
    $('#resetReplay').disabled = false;
    $('#simTitle').textContent = `${state.config.name} · ${state.result.execution.sampleCount} samples`;
  } catch (error) {
    $('#runBadge').textContent = 'RUN FAILED';
    $('#runBadge').className = 'badge bad';
    alert(error instanceof Error ? error.message : String(error));
  } finally {
    $('#runStudy').disabled = false;
  }
}

function sampleAt(index) {
  return state.result?.samples?.[Math.max(0, Math.min(index, state.result.samples.length - 1))] ?? null;
}

function renderReplayFrame(index) {
  const sample = sampleAt(index);
  if (!sample) return;
  state.replayIndex = index;
  $('#clockBadge').textContent = `${fmt(sample.timeSeconds, 1)} s`;
  $('#systemState').textContent = sample.state ?? 'RUNNING';
  $('#topoDiesel').textContent = `${fmt(sample.dieselMW)} MW`;
  $('#topoBess').textContent = `${fmt(sample.bessMW)} MW · ${fmt((sample.soc ?? 0) * 100, 1)}%`;
  $('#topoReserve').textContent = `${fmt(sample.reserve60MW)} MW`;
  $('#topoLoad').textContent = `${fmt(sample.loadMW)} MW`;
  $('#topoProduction').textContent = `${fmt(sample.productionThroughputTPH, 1)} t/h`;
  $('#busText').textContent = `${fmt(sample.frequencyHz, 3)} Hz`;
  const partial = state.result.samples.slice(0, index + 1);
  const currentKpis = partial.length ? extractScenarioKpis({ ...state.result, samples: partial, id: state.result.id }) : null;
  const currentCompliance = currentKpis ? evaluateHardConstraints(currentKpis, DEFAULT_HARD_CONSTRAINTS) : null;
  $('#liveVerdict').textContent = currentCompliance?.feasible ? 'WITHIN LIMITS' : 'LIMIT VIOLATION';
  $('#liveVerdict').className = `state-chip ${currentCompliance?.feasible ? 'good' : 'bad'}`;
  $('#liveKpis').innerHTML = [
    ['Frequency', `${fmt(sample.frequencyHz, 3)} Hz`],
    ['RoCoF', `${fmt(sample.rocofHzPerS, 3)} Hz/s`],
    ['N-1 coverage', fmt(sample.n1CoverageRatio, 3)],
    ['Residual', `${fmt(sample.residualMW, 3)} MW`],
    ['BESS SOC', `${fmt((sample.soc ?? 0) * 100, 1)}%`],
    ['EENS', `${fmt(sample.eensMWh, 5)} MWh`],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  const upcoming = (state.config.disturbances ?? []).find((action) => action.timeSeconds > sample.timeSeconds + 1e-9);
  $('#nextEvent').textContent = upcoming ? `下一事件：${fmt(upcoming.timeSeconds, 0)} s · ${ACTION_LABELS[upcoming.type] ?? upcoming.type}` : '事故时间表已执行完成';
  drawAllCharts(index);
}

function replay() {
  if (!state.result) return;
  clearInterval(state.replayTimer);
  const step = Math.max(1, Math.round(state.replaySpeed * 5));
  state.replayTimer = setInterval(() => {
    if (state.replayIndex >= state.result.samples.length - 1) {
      clearInterval(state.replayTimer);
      return;
    }
    renderReplayFrame(Math.min(state.result.samples.length - 1, state.replayIndex + step));
  }, 80);
}

function drawChart(canvas, series, { min = null, max = null, eventTimes = [] } = {}) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(300, rect.width * ratio);
  canvas.height = Math.max(160, rect.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { left: 42, right: 12, top: 12, bottom: 24 };
  ctx.clearRect(0, 0, width, height);
  const allValues = series.flatMap((item) => item.values.map((point) => point.y)).filter(Number.isFinite);
  if (!allValues.length) return;
  const xMax = Math.max(...series.flatMap((item) => item.values.map((point) => point.x)), 1);
  const yMin = min ?? Math.min(...allValues);
  const yMax = max ?? Math.max(...allValues);
  const span = Math.max(1e-9, yMax - yMin);
  const x = (value) => pad.left + value / xMax * (width - pad.left - pad.right);
  const y = (value) => pad.top + (yMax - value) / span * (height - pad.top - pad.bottom);
  ctx.strokeStyle = '#d9e1e6';ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) { const yy = pad.top + i / 4 * (height - pad.top - pad.bottom);ctx.beginPath();ctx.moveTo(pad.left, yy);ctx.lineTo(width - pad.right, yy);ctx.stroke(); }
  ctx.fillStyle = '#6b7f8d';ctx.font = '9px Arial';ctx.fillText(yMax.toFixed(2), 3, pad.top + 4);ctx.fillText(yMin.toFixed(2), 3, height - pad.bottom);
  for (const time of eventTimes) {ctx.strokeStyle = '#d4840a';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x(time), pad.top);ctx.lineTo(x(time), height-pad.bottom);ctx.stroke();ctx.setLineDash([]);}
  const palette = ['#173f5f','#d4840a','#167347','#8a4f9e','#b42318','#5f7280'];
  series.forEach((item, index) => {ctx.strokeStyle = palette[index % palette.length];ctx.lineWidth = 1.7;ctx.beginPath();item.values.forEach((point, pointIndex) => {const xx=x(point.x), yy=y(point.y);if(pointIndex===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();ctx.fillStyle=palette[index%palette.length];ctx.fillRect(pad.left+index*100,height-12,8,2);ctx.fillStyle='#425b6c';ctx.fillText(item.label,pad.left+12+index*100,height-8);});
}

function drawAllCharts(index) {
  if (!state.result) return;
  const samples = selectChartSamples(state.result.samples.slice(0, index + 1), 500);
  const points = (key, transform = (v) => v) => samples.map((sample) => ({ x: sample.timeSeconds, y: transform(Number(sample[key]) || 0) }));
  const events = (state.config.disturbances ?? []).map((action) => action.timeSeconds);
  drawChart($('#powerChart'), [
    { label: 'Load', values: points('loadMW') },
    { label: 'Diesel', values: points('dieselMW') },
    { label: 'BESS', values: points('bessMW') },
  ], { eventTimes: events });
  drawChart($('#frequencyChart'), [{ label: 'Frequency', values: points('frequencyHz') }], { min: Math.min(58, ...samples.map((sample) => sample.frequencyHz)), max: Math.max(60.5, ...samples.map((sample) => sample.frequencyHz)), eventTimes: events });
  drawChart($('#bessChart'), [
    { label: 'BESS MW', values: points('bessMW') },
    { label: 'SOC ×10', values: points('soc', (value) => value * 10) },
  ], { eventTimes: events });
}

function renderEventTimeline() {
  const events = [...(state.result?.events ?? [])].sort((a, b) => (a.timeSeconds ?? 0) - (b.timeSeconds ?? 0));
  $('#eventCount').textContent = `${events.length} events`;
  $('#eventTimeline').innerHTML = events.slice(-250).map((event) => `<div class="event-row"><span>${fmt(event.timeSeconds, 1)} s</span><strong>${escapeHtml(EVENT_LABELS[event.type] ?? event.type)}</strong><span>${escapeHtml(event.equipmentId ?? event.reason ?? event.processId ?? '')}</span></div>`).join('') || '<div class="event-row"><span>—</span><strong>无事件</strong><span></span></div>';
}

function renderVerdict() {
  if (!state.kpis || !state.compliance) return;
  const hero = $('#verdictHero');
  hero.className = `verdict-hero ${state.compliance.feasible ? 'pass' : 'fail'}`;
  hero.innerHTML = `<p class="eyebrow">ENGINEERING VERDICT</p><h1>${state.compliance.feasible ? '工程判定：合格' : '工程判定：不合格'}</h1><p>${state.compliance.feasible ? '当前方案满足已配置的硬性工程约束。' : `发现${state.compliance.violations.length}项硬性工程约束违规，必须修订后重新验证。`}</p>`;
  $('#findingList').innerHTML = state.compliance.violations.map((violation, index) => `<article class="finding"><div class="finding-head"><strong>P${index === 0 ? 0 : 1} · ${escapeHtml(VIOLATION_LABELS[violation.code] ?? violation.code)}</strong><code>${violation.code}</code></div><dl><div><dt>实际值</dt><dd>${typeof violation.actual === 'number' ? fmt(violation.actual, 3) : String(violation.actual)}</dd></div><div><dt>要求值</dt><dd>${typeof violation.limit === 'number' ? fmt(violation.limit, 3) : String(violation.limit)}</dd></div><div><dt>判断</dt><dd class="bad">FAILED</dd></div></dl></article>`).join('') || '<article class="finding" style="border-left-color:#167347"><strong>全部硬性约束通过</strong></article>';
  const values = [
    ['Frequency nadir', `${fmt(state.kpis.frequencyNadirHz, 3)} Hz`],
    ['Maximum RoCoF', `${fmt(state.kpis.maximumAbsoluteRoCoFHzPerS, 3)} Hz/s`],
    ['Minimum N-1', fmt(state.kpis.minimumN1CoverageRatio, 3)],
    ['EENS', `${fmt(state.kpis.eensMWh, 5)} MWh`],
    ['Actual production', `${fmt(state.kpis.actualProductionTons, 2)} t`],
    ['Deferred production', `${fmt(state.kpis.deferredProductionTons, 2)} t`],
    ['Diesel fuel', `${fmt(state.kpis.dieselFuelLiters, 1)} L`],
    ['Fuel cost', fmt(state.kpis.dieselFuelCost, 2)],
  ];
  $('#finalKpis').innerHTML = values.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderRevisions() {
  const suggestions = state.guidance?.suggestions ?? [];
  $('#revisionList').innerHTML = suggestions.map((suggestion, index) => `<article class="revision"><div class="revision-head"><strong>${suggestion.priority} · ${escapeHtml(suggestion.title)}</strong><span>${escapeHtml(suggestion.code)}</span></div><p>${escapeHtml(suggestion.rationale)}</p><div class="revision-meta">${suggestion.change ? `<span>${escapeHtml(String(suggestion.change.from))} → ${escapeHtml(String(suggestion.change.to))}</span>` : '<span>需要工程师补充设备级设计</span>'}<span>${escapeHtml(suggestion.expectedEffect)}</span></div><button class="button ${index === 0 ? 'primary' : 'secondary'}" data-revision-index="${index}" ${suggestion.change ? '' : 'disabled'}>创建修订方案</button></article>`).join('') || '<div class="scenario-help">当前方案无硬性违规，暂无强制修订建议。</div>';
  $$('[data-revision-index]').forEach((button) => button.addEventListener('click', () => selectRevision(Number(button.dataset.revisionIndex))));
}

function selectRevision(index) {
  state.selectedRevision = state.guidance.suggestions[index];
  state.revisionConfig = applyRevision(state.config, state.selectedRevision, { idSuffix: 'ALT' });
  $('#compareRevision').disabled = false;
  $$('[data-revision-index]').forEach((button, buttonIndex) => {button.textContent = buttonIndex === index ? '已选择' : '创建修订方案';});
}

function compareRevision() {
  if (!state.revisionConfig) return;
  $('#compareStatus').textContent = 'RUNNING';
  go('compare');
  try {
    const baseResult = runConfig(state.config);
    const revisionResult = runConfig(state.revisionConfig);
    const engine = new ScenarioComparisonEngine({ hardConstraints: DEFAULT_HARD_CONSTRAINTS });
    state.comparison = engine.compare([baseResult, revisionResult]);
    renderComparison();
  } catch (error) {
    $('#compareStatus').textContent = 'FAILED';
    $('#compareStatus').className = 'state-chip bad';
    $('#compareSummary').textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderComparison() {
  const comparison = state.comparison;
  if (!comparison) return;
  $('#compareStatus').textContent = comparison.recommendation.status;
  $('#compareStatus').className = `state-chip ${comparison.recommendation.status === 'RECOMMENDED' ? 'good' : 'bad'}`;
  $('#compareSummary').innerHTML = comparison.recommendation.status === 'RECOMMENDED'
    ? `<strong>推荐方案：${escapeHtml(comparison.recommendation.scenarioId)}</strong><p>推荐原因：${comparison.recommendation.reasons.map(escapeHtml).join(' · ')}</p>`
    : '<strong>没有合格方案</strong><p>原方案和当前修订方案仍违反硬性工程约束，需要继续修订。</p>';
  const rows = comparison.rankedScenarios.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="${item.compliance.feasible ? 'good' : 'bad'}">${item.compliance.feasible ? 'COMPLIANT' : 'REJECTED'}</td><td>${fmt(item.kpis.frequencyNadirHz, 3)}</td><td>${fmt(item.kpis.maximumAbsoluteRoCoFHzPerS, 3)}</td><td>${fmt(item.kpis.minimumN1CoverageRatio, 3)}</td><td>${fmt(item.kpis.eensMWh, 5)}</td><td>${fmt(item.kpis.deferredProductionTons, 2)}</td><td>${fmt(item.kpis.dieselFuelCost, 2)}</td><td>${item.compliance.violations.map((violation) => escapeHtml(VIOLATION_LABELS[violation.code] ?? violation.code)).join('<br>') || '—'}</td></tr>`).join('');
  $('#compareTable').innerHTML = `<table class="compare-table"><thead><tr><th>方案</th><th>结论</th><th>Freq nadir</th><th>RoCoF</th><th>N-1</th><th>EENS</th><th>Deferred t</th><th>Fuel cost</th><th>违规原因</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function bind() {
  renderNav();
  $$('.task-card').forEach((button) => button.addEventListener('click', () => {$$('.task-card').forEach((node) => node.classList.remove('active'));button.classList.add('active');state.task = button.dataset.task;}));
  $('#startGuided').addEventListener('click', () => go(state.task === 'COMPARE' ? 'compare' : 'inputs'));
  $('#loadExample').addEventListener('click', initialize);
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => go(button.dataset.go)));
  $$('[data-jump="advanced"]').forEach((button) => button.addEventListener('click', () => {window.location.href = '../ui/';}));
  ['projectName','systemBaseMW','baseLoadMW','bessPowerMW','bessEnergyMWh','initialSocPercent','durationSeconds'].forEach((id) => $(`#${id}`).addEventListener('change', applyGuidedInputs));
  $('#prepareRun').addEventListener('click', () => go('simulation'));
  $('#runStudy').addEventListener('click', runStudy);
  $('#openVerdict').addEventListener('click', () => go('verdict'));
  $('#playReplay').addEventListener('click', replay);
  $('#pauseReplay').addEventListener('click', () => clearInterval(state.replayTimer));
  $('#resetReplay').addEventListener('click', () => {clearInterval(state.replayTimer);renderReplayFrame(0);});
  $('#speedSelect').addEventListener('change', (event) => {state.replaySpeed = Number(event.target.value) || 1;});
  $('#compareRevision').addEventListener('click', compareRevision);
  window.addEventListener('resize', () => {if (state.result) drawAllCharts(state.replayIndex);});
}

async function initialize() {
  clearInterval(state.replayTimer);
  try {
    const response = await fetch('../config/examples/mine-screening.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Example configuration returned HTTP ${response.status}`);
    state.config = await response.json();
    invalidateRun();
    renderConfig();
    go('start');
  } catch (error) {
    $('#railProjectName').textContent = '加载失败';
    alert(error instanceof Error ? error.message : String(error));
  }
}

bind();
initialize();
