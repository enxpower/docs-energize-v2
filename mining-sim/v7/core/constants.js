export const V7_VERSION = '7.0.0-alpha.1';

export const POWER_SIGN = Object.freeze({
  GENERATION_POSITIVE: true,
  BESS_DISCHARGE_POSITIVE: true,
  BESS_CHARGE_NEGATIVE: true,
  GRID_IMPORT_POSITIVE: true,
  GRID_EXPORT_NEGATIVE: true,
});

export const SYSTEM_STATE = Object.freeze({
  OFF: 'OFF',
  STARTING: 'STARTING',
  ISLAND_STABLE: 'ISLAND_STABLE',
  DEGRADED: 'DEGRADED',
  FAULT: 'FAULT',
  RECOVERY: 'RECOVERY',
});

export const EPS = 1e-9;
