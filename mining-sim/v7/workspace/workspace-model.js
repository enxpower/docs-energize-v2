export const WORKSPACE_STEPS = Object.freeze([
  { id: 'start', label: '开始' },
  { id: 'inputs', label: '基础配置' },
  { id: 'scenario', label: '测试场景' },
  { id: 'simulation', label: '运行仿真' },
  { id: 'verdict', label: '工程结论' },
  { id: 'revisions', label: '修订建议' },
  { id: 'compare', label: '方案比较' },
]);

export function summarizeConfig(config) {
  const diesel = config.equipment?.diesel ?? [];
  const motors = config.equipment?.motors ?? [];
  const production = config.equipment?.productionLoads ?? [];
  return {
    id: config.id,
    name: config.name ?? config.id,
    systemBaseMW: Number(config.site?.systemBaseMW) || 0,
    baseLoadMW: Number(config.site?.baseLoadMW) || 0,
    dieselCount: diesel.length,
    dieselRatedMW: diesel.reduce((sum, unit) => sum + (Number(unit.ratedMW) || 0), 0),
    bessPowerMW: Number(config.equipment?.bess?.powerMW) || 0,
    bessEnergyMWh: Number(config.equipment?.bess?.energyMWh) || 0,
    motorCount: motors.length,
    productionLoadMW: production.reduce((sum, load) => sum + (Number(load.normalMW) || 0), 0),
    disturbanceCount: (config.disturbances ?? []).length,
  };
}

export function guidedReadiness(config) {
  const checks = [
    { id: 'site', label: '场站容量与基础负荷', pass: Number(config.site?.systemBaseMW) > 0 && Number(config.site?.baseLoadMW) >= 0 },
    { id: 'diesel', label: '柴油机组', pass: (config.equipment?.diesel ?? []).length > 0 },
    { id: 'bess', label: 'BESS功率与容量', pass: Number(config.equipment?.bess?.powerMW) >= 0 && Number(config.equipment?.bess?.energyMWh) >= 0 },
    { id: 'motors', label: '大型电机清单', pass: (config.equipment?.motors ?? []).length > 0 },
    { id: 'production', label: '生产负荷', pass: (config.equipment?.productionLoads ?? []).length > 0 },
    { id: 'scenario', label: '事故场景', pass: (config.disturbances ?? []).length > 0 },
  ];
  const passed = checks.filter((check) => check.pass).length;
  return {
    checks,
    passed,
    total: checks.length,
    percent: Math.round((passed / checks.length) * 100),
    readyToRun: checks.every((check) => check.pass),
    nextAction: checks.find((check) => !check.pass)?.label ?? '运行工程仿真',
  };
}

export function updateGuidedConfig(config, patch = {}) {
  const next = structuredClone(config);
  if (patch.name !== undefined) next.name = String(patch.name);
  if (patch.systemBaseMW !== undefined) next.site.systemBaseMW = Number(patch.systemBaseMW);
  if (patch.baseLoadMW !== undefined) next.site.baseLoadMW = Number(patch.baseLoadMW);
  if (patch.bessPowerMW !== undefined) next.equipment.bess.powerMW = Number(patch.bessPowerMW);
  if (patch.bessEnergyMWh !== undefined) next.equipment.bess.energyMWh = Number(patch.bessEnergyMWh);
  if (patch.initialSocPercent !== undefined) next.equipment.bess.initialSoc = Number(patch.initialSocPercent) / 100;
  if (patch.durationSeconds !== undefined) next.simulation.durationSeconds = Number(patch.durationSeconds);
  return next;
}

export function selectChartSamples(samples, maximumPoints = 600) {
  if (!Array.isArray(samples) || samples.length <= maximumPoints) return [...(samples ?? [])];
  const stride = Math.ceil(samples.length / maximumPoints);
  const selected = samples.filter((_, index) => index % stride === 0);
  const last = samples[samples.length - 1];
  if (selected[selected.length - 1] !== last) selected.push(last);
  return selected;
}
