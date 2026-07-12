import { DEFAULT_HARD_CONSTRAINTS } from '../decision/scenario-comparison.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const CONFIG_GUIDANCE = Object.freeze({
  systemBaseMW: {
    label: '系统基准容量',
    source: '设计单线图或全站容量规划',
    meaning: '频率、惯量和功率偏差的统一计算基准。不是当前负荷。',
    check: '通常不应低于峰值负荷，也不应随意取成BESS容量。',
  },
  baseLoadMW: {
    label: '基础连续负荷',
    source: '历史负荷曲线、工艺负荷表或现场测量',
    meaning: '不包含大型电机启动冲击和单独建模的生产负荷。',
    check: '避免与Production页面中的负荷重复计算。',
  },
  bessPowerMW: {
    label: 'BESS功率',
    source: 'PCS额定有功功率',
    meaning: '决定事故最初数秒能提供多少快速有功支撑。',
    check: '频率最低值或RoCoF失败时，优先检查MW，而不是先加MWh。',
  },
  bessEnergyMWh: {
    label: 'BESS容量',
    source: '电池可用交流侧能量或项目规格书',
    meaning: '决定支撑能持续多久，以及事故后能否维持SOC。',
    check: '短时频率问题主要受MW影响，长时供能问题主要受MWh影响。',
  },
  initialSocPercent: {
    label: '初始SOC',
    source: 'EMS运行策略或调度要求',
    meaning: '决定事故发生前可用的放电能量和功率降额。',
    check: '应使用事故前正常运行目标，而不是满充假设。',
  },
  durationSeconds: {
    label: '仿真时长',
    source: '事故序列和恢复时间要求',
    meaning: '必须覆盖最后一个事故及其后的稳定恢复窗口。',
    check: '至少应比最后一个事故晚30至120秒。',
  },
});

export function diagnoseLiveSample(sample, constraints = DEFAULT_HARD_CONSTRAINTS) {
  if (!sample) return { status: 'WAITING', severity: 'neutral', title: '等待仿真数据', actions: [] };
  const issues = [];
  if (finite(sample.frequencyHz, 60) < constraints.minimumFrequencyHz) {
    issues.push({ code: 'LOW_FREQUENCY', severity: 'critical', message: `频率${finite(sample.frequencyHz).toFixed(3)} Hz低于${constraints.minimumFrequencyHz.toFixed(3)} Hz`, action: '检查快速备用、BESS功率和事故前在线机组。' });
  }
  if (Math.abs(finite(sample.rocofHzPerS)) > constraints.maximumAbsoluteRoCoFHzPerS) {
    issues.push({ code: 'HIGH_ROCOF', severity: 'critical', message: `RoCoF ${Math.abs(finite(sample.rocofHzPerS)).toFixed(3)} Hz/s超限`, action: '增加最初1至2秒快速功率，或降低瞬时事故规模。' });
  }
  if (Number.isFinite(Number(sample.n1CoverageRatio)) && Number(sample.n1CoverageRatio) < constraints.minimumN1CoverageRatio) {
    issues.push({ code: 'LOW_N1', severity: 'warning', message: `N-1覆盖率${finite(sample.n1CoverageRatio).toFixed(3)}不足`, action: '增加在线可用容量、快速备用或降低最大单机容量。' });
  }
  if (finite(sample.eensMWh) > constraints.maximumEensMWh + 1e-12) {
    issues.push({ code: 'EENS', severity: 'critical', message: `已形成${finite(sample.eensMWh).toFixed(5)} MWh未供电量`, action: '先配置可恢复生产降载，再评估增配电源。' });
  }
  if (!issues.length) return { status: 'WITHIN_LIMITS', severity: 'good', title: '当前时刻满足硬约束', actions: [] };
  const critical = issues.some((issue) => issue.severity === 'critical');
  return {
    status: critical ? 'CRITICAL' : 'WARNING',
    severity: critical ? 'bad' : 'warning',
    title: issues[0].message,
    actions: issues,
  };
}

export function explainRevision(suggestion) {
  const map = {
    INCREASE_BESS_POWER: {
      parameter: '基础配置 → BESS功率（MW）',
      why: '这是事故最初数秒的快速有功能力。频率最低值和RoCoF失败时，应先验证PCS功率，而不是盲目增加电池时长。',
      tradeoff: 'PCS、变压器和并联系统容量可能增加；MWh不一定需要同比增加。',
      verify: '重新运行同一事故，检查频率最低值、RoCoF和SOC是否同时通过。',
    },
    STAGGER_MOTOR_STARTS: {
      parameter: '高级配置 → Large Motors → Minimum start interval',
      why: '把大型电机启动与柴油机跳闸、BESS恢复等高风险窗口错开。',
      tradeoff: '工艺启动时间延长，但不一定增加设备投资。',
      verify: '检查电机启动事件不再与事故时间重叠，并确认生产延迟可接受。',
    },
    COMMIT_ADDITIONAL_DIESEL: {
      parameter: '高级配置 → Diesel → Initial state',
      why: '事故前多保持一台机组在线，可增加旋转备用和事故后爬坡能力。',
      tradeoff: '燃油消耗、维护小时和低负载运行风险增加。',
      verify: '比较N-1覆盖率、频率和柴油成本，不应只看是否通过。',
    },
    ADD_DIESEL_CAPACITY: {
      parameter: '高级配置 → Diesel fleet',
      why: '全部现有机组在线仍无法覆盖最大单机事故，说明容量结构本身不足。',
      tradeoff: '需要新增机组、降低最大单机规模或重新分组母线。',
      verify: '先做设备级方案，再回到本工具录入明确容量。',
    },
    ENABLE_PRODUCTION_CURTAILMENT: {
      parameter: '高级配置 → Production → Minimum MW',
      why: '在失供关键负荷前，先释放可恢复的生产负荷裕量。',
      tradeoff: '会形成延期产量，但通常优于EENS或安全负荷失供。',
      verify: '检查EENS归零、关键负荷不被切除，并评估延期吨数。',
    },
  };
  return map[suggestion?.code] ?? {
    parameter: '需要设备级工程确认',
    why: suggestion?.rationale ?? '当前建议需要进一步工程数据。',
    tradeoff: '不得在缺少数据时自动修改。',
    verify: '补充数据后重新运行相同场景。',
  };
}

export function buildConfigurationChecklist(config) {
  const lastEvent = Math.max(0, ...(config?.disturbances ?? []).map((item) => finite(item.timeSeconds)));
  return [
    { id: 'LOAD', label: '确认基础负荷不与生产负荷重复', pass: finite(config?.site?.baseLoadMW) > 0 },
    { id: 'DIESEL', label: '确认柴油机容量、最小负载和在线状态来自厂家或设计资料', pass: (config?.equipment?.diesel ?? []).length > 0 },
    { id: 'BESS', label: '确认BESS MW、MWh和事故前SOC', pass: finite(config?.equipment?.bess?.powerMW) > 0 && finite(config?.equipment?.bess?.energyMWh) > 0 },
    { id: 'MOTORS', label: '确认所有大型电机及启动方式已录入', pass: (config?.equipment?.motors ?? []).length > 0 },
    { id: 'SCENARIO', label: '确认事故时间表代表要验收的工况', pass: (config?.disturbances ?? []).length > 0 },
    { id: 'HORIZON', label: '仿真时长覆盖最后事故后的恢复窗口', pass: finite(config?.simulation?.durationSeconds) >= lastEvent + 30 },
  ];
}
