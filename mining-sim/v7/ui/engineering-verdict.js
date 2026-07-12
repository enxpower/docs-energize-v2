import { evaluateHardConstraints, DEFAULT_HARD_CONSTRAINTS } from '../decision/scenario-comparison.js';

const numberFromText = (text) => {
  const match = String(text ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

export function readDisplayedSingleScenarioKpis(root = document) {
  const values = {};
  for (const card of root.querySelectorAll('#resultsPanel .kpi')) {
    const label = card.querySelector('span')?.textContent?.trim();
    const value = numberFromText(card.querySelector('strong')?.textContent);
    if (label) values[label] = value;
  }
  if (!Object.keys(values).length) return null;
  return {
    frequencyNadirHz: values['Frequency nadir'],
    maximumAbsoluteRoCoFHzPerS: values['Maximum RoCoF'],
    minimumN1CoverageRatio: values['Minimum N-1 coverage'],
    eensMWh: values.EENS,
    criticalLoadShed: false,
  };
}

export function readDecisionPolicy(root = document) {
  const policy = { ...DEFAULT_HARD_CONSTRAINTS };
  for (const input of root.querySelectorAll('[data-policy-group="hardConstraints"]')) {
    const key = input.dataset.policyKey;
    if (!key) continue;
    policy[key] = input.dataset.valueType === 'boolean' ? input.checked : Number(input.value);
  }
  return policy;
}

export function engineeringVerdict(kpis, constraints = DEFAULT_HARD_CONSTRAINTS) {
  if (!kpis) return null;
  const compliance = evaluateHardConstraints(kpis, constraints);
  return {
    compliant: compliance.feasible,
    status: compliance.feasible ? 'COMPLIANT' : 'REJECTED',
    violations: compliance.violations,
  };
}

const violationLabel = (violation) => {
  const labels = {
    FREQUENCY_NADIR_BELOW_LIMIT: 'Frequency nadir below limit',
    ROCOF_ABOVE_LIMIT: 'RoCoF above limit',
    EENS_ABOVE_LIMIT: 'EENS above limit',
    N1_COVERAGE_BELOW_LIMIT: 'N-1 coverage below limit',
    CRITICAL_LOAD_SHED: 'Critical load shed',
  };
  const text = labels[violation.code] ?? violation.code;
  if (typeof violation.actual === 'number' && typeof violation.limit === 'number') {
    return `${text}: actual ${violation.actual.toFixed(3)}, limit ${violation.limit.toFixed(3)}`;
  }
  return text;
};

function renderVerdict() {
  const workspace = document.querySelector('#workspaceStatus');
  if (workspace && !['RUNNING', 'COMPARING', 'LOAD FAILED'].includes(workspace.textContent.trim())) {
    workspace.textContent = workspace.classList.contains('bad') ? 'CONFIG INVALID' : 'CONFIG VALID';
  }

  const chip = document.querySelector('#engineeringVerdict');
  const results = document.querySelector('#resultsPanel');
  if (!chip || !results) return;

  const kpis = readDisplayedSingleScenarioKpis(document);
  const existing = results.querySelector('.single-verdict');
  if (!kpis) {
    chip.textContent = 'NOT ASSESSED';
    chip.className = 'status-chip neutral';
    existing?.remove();
    return;
  }

  const verdict = engineeringVerdict(kpis, readDecisionPolicy(document));
  chip.textContent = verdict.status;
  chip.className = `status-chip ${verdict.compliant ? 'ok' : 'bad'}`;

  const html = verdict.compliant
    ? '<div class="single-verdict pass"><strong>ENGINEERING COMPLIANT</strong><span>All configured hard constraints are satisfied for this study run.</span></div>'
    : `<div class="single-verdict fail"><strong>ENGINEERING REJECTED</strong><span>This configuration is valid, but the simulated scenario violates hard engineering constraints.</span><ul>${verdict.violations.map((item) => `<li>${violationLabel(item)}</li>`).join('')}</ul></div>`;

  if (existing) existing.outerHTML = html;
  else results.querySelector('.result-header')?.insertAdjacentHTML('afterend', html);
}

const style = document.createElement('style');
style.textContent = `
.single-verdict{margin:12px 0;padding:12px 14px;border:1px solid;border-left-width:6px;border-radius:7px;display:grid;gap:5px;font-size:11px}.single-verdict strong{font-size:13px}.single-verdict span{color:#52687a}.single-verdict ul{margin:3px 0 0 18px;display:grid;gap:3px}.single-verdict.pass{background:#f0faf4;border-color:#60a879;color:#166534}.single-verdict.fail{background:#fff3f3;border-color:#d84a4a;color:#9b1c1c}.status-chip.ok{color:#9be7b5;border-color:#79c99a}.status-chip.bad{color:#ffb2b2;border-color:#ef8f8f}
`;
document.head.append(style);

const observer = new MutationObserver(renderVerdict);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
renderVerdict();
