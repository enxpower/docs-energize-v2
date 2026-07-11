import { SYSTEM_STATE } from './constants.js';

export function deriveSystemState({ running, faulted, frequencyHz, nominalHz, powerResidualMW, residualToleranceMW = 0.1 }) {
  if (!running) return SYSTEM_STATE.OFF;
  if (faulted) return SYSTEM_STATE.FAULT;

  const frequencyErrorHz = Math.abs(frequencyHz - nominalHz);
  if (frequencyErrorHz <= 0.1 && Math.abs(powerResidualMW) <= residualToleranceMW) {
    return SYSTEM_STATE.ISLAND_STABLE;
  }

  return SYSTEM_STATE.DEGRADED;
}
