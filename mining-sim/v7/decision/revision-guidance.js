const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const LABELS = Object.freeze({
  FREQUENCY_NADIR_BELOW_LIMIT: '频率最低值低于限值',
  ROCOF_ABOVE_LIMIT: 'RoCoF超过限值',
  EENS_ABOVE_LIMIT: '出现未供电量',
  N1_COVERAGE_BELOW_LIMIT: 'N-1快速备用覆盖不足',
  CRITICAL_LOAD_SHED: '关键负荷被切除',
});

function addSuggestion(list, suggestion) {
  if (!list.some((item) => item.code === suggestion.code)) list.push(suggestion);
}

export function buildRevisionGuidance({ config, kpis, compliance } = {}) {
  if (!config || !kpis || !compliance) throw new Error('Revision guidance requires config, kpis and compliance');
  const suggestions = [];
  const bess = config.equipment?.bess ?? {};
  const diesels = config.equipment?.diesel ?? [];
  const productionLoads = config.equipment?.productionLoads ?? [];
  const motors = config.equipment?.motors ?? [];

  for (const violation of compliance.violations ?? []) {
    if (violation.code === 'FREQUENCY_NADIR_BELOW_LIMIT' || violation.code === 'ROCOF_ABOVE_LIMIT') {
      const currentPowerMW = finite(bess.powerMW, 0);
      addSuggestion(suggestions, {
        code: 'INCREASE_BESS_POWER',
        priority: 'P1',
        title: '提高BESS快速功率',
        rationale: '频率最低值或RoCoF不满足要求，优先增加快速有功支撑能力。',
        change: { path: ['equipment', 'bess', 'powerMW'], from: currentPowerMW, to: Math.max(currentPowerMW + 2, currentPowerMW * 1.25) },
        expectedEffect: '提高事故最初数秒的快速备用，改善频率最低值和RoCoF。',
      });
      addSuggestion(suggestions, {
        code: 'STAGGER_MOTOR_STARTS',
        priority: 'P2',
        title: '错开大型电机启动',
        rationale: '避免电机启动冲击与发电设备事故或恢复窗口重叠。',
        change: { path: ['controls', 'motorStart', 'minimumIntervalSeconds'], from: finite(config.controls?.motorStart?.minimumIntervalSeconds, 30), to: Math.max(60, finite(config.controls?.motorStart?.minimumIntervalSeconds, 30) + 30) },
        expectedEffect: '降低瞬时负荷阶跃和重复启动冲击。',
      });
    }

    if (violation.code === 'N1_COVERAGE_BELOW_LIMIT') {
      const candidate = diesels.find((dg) => dg.initialState === 'OFF');
      if (candidate) {
        addSuggestion(suggestions, {
          code: 'COMMIT_ADDITIONAL_DIESEL',
          priority: 'P1',
          title: `保持${candidate.id}在线`,
          rationale: '当前10秒快速备用不能覆盖最大在线机组事故。',
          change: { path: ['equipment', 'diesel', diesels.indexOf(candidate), 'initialState'], from: 'OFF', to: 'RUNNING' },
          expectedEffect: '增加在线容量和旋转备用，但会增加燃油消耗。',
        });
      } else {
        addSuggestion(suggestions, {
          code: 'ADD_DIESEL_CAPACITY',
          priority: 'P1',
          title: '增加可用柴油机容量或降低最大单机事故规模',
          rationale: '全部现有机组在线时仍不能满足N-1快速备用。',
          change: null,
          expectedEffect: '提高事故后可用备用；需要设备级设计确认。',
        });
      }
    }

    if (violation.code === 'EENS_ABOVE_LIMIT' || violation.code === 'CRITICAL_LOAD_SHED') {
      const curtailable = productionLoads.find((load) => !load.safetyCritical && finite(load.normalMW) > finite(load.minimumMW));
      if (curtailable) {
        addSuggestion(suggestions, {
          code: 'ENABLE_PRODUCTION_CURTAILMENT',
          priority: 'P1',
          title: `优先降低${curtailable.name ?? curtailable.id}`,
          rationale: '先使用可恢复的生产降载，避免关键负荷失供或形成EENS。',
          change: { path: ['equipment', 'productionLoads', productionLoads.indexOf(curtailable), 'minimumMW'], from: finite(curtailable.minimumMW), to: Math.max(0, finite(curtailable.minimumMW) - 0.5) },
          expectedEffect: '提供额外可控负荷裕量，但会产生延期产量。',
        });
      }
    }
  }

  if (finite(kpis.deferredProductionTons) > 0) {
    addSuggestion(suggestions, {
      code: 'RESTORE_PRODUCTION_RESERVE',
      priority: 'P3',
      title: '提高生产负荷恢复前的备用裕量',
      rationale: '当前方案存在延期产量，应检查恢复延时、备用门槛和工艺顺序。',
      change: null,
      expectedEffect: '在不牺牲可靠性的前提下减少延期产量。',
    });
  }

  if (!motors.length) {
    addSuggestion(suggestions, {
      code: 'CONFIRM_MOTOR_LIST',
      priority: 'P2',
      title: '补充大型电机清单',
      rationale: '缺少大型电机数据会低估启动冲击和工艺恢复风险。',
      change: null,
      expectedEffect: '提高筛选结果的完整性。',
    });
  }

  suggestions.sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code));
  return {
    verdict: compliance.feasible ? 'COMPLIANT' : 'REJECTED',
    summary: compliance.feasible
      ? '当前方案满足已配置的硬性工程约束。'
      : `当前方案存在${compliance.violations.length}项硬性约束违规。`,
    findings: (compliance.violations ?? []).map((violation) => ({
      ...violation,
      label: LABELS[violation.code] ?? violation.code,
    })),
    suggestions,
  };
}

export function applyRevision(config, suggestion, { idSuffix = 'REV' } = {}) {
  const next = structuredClone(config);
  next.id = `${config.id}-${idSuffix}-${suggestion.code}`;
  next.name = `${config.name ?? config.id} · ${suggestion.title}`;
  if (!suggestion.change?.path) return next;
  let target = next;
  const path = suggestion.change.path;
  for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
  target[path[path.length - 1]] = suggestion.change.to;
  return next;
}
