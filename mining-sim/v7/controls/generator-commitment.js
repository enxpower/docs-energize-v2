import { assessReserve } from '../reliability/reserve-engine.js';

function sortStartCandidates(fleet, requiredBySeconds = Infinity) {
  return [...fleet]
    .filter((dg) => dg.isStartable)
    .sort((a, b) => {
      const aOnTime = a.secondsUntilRunning <= requiredBySeconds ? 0 : 1;
      const bOnTime = b.secondsUntilRunning <= requiredBySeconds ? 0 : 1;
      return aOnTime - bOnTime
        || a.secondsUntilRunning - b.secondsUntilRunning
        || b.ratedMW - a.ratedMW;
    });
}

function sortStopCandidates(fleet) {
  return [...fleet]
    .filter((dg) => dg.isOnline && dg.runTimeSeconds >= dg.minRunSeconds)
    .sort((a, b) => a.outputMW - b.outputMW || a.ratedMW - b.ratedMW);
}

function capacityAvailableBy(dieselFleet, horizonSeconds) {
  return dieselFleet
    .filter((dg) => dg.isOnline || (dg.isStarting && dg.secondsUntilRunning <= horizonSeconds))
    .reduce((sum, dg) => sum + dg.ratedMW, 0);
}

export function evaluateGeneratorCommitment({
  loadMW,
  forecastLoadMW = loadMW,
  forecastHorizonSeconds = 0,
  dieselFleet,
  bess,
  minimumOnlineUnits = 1,
  reserveMarginMW = 0,
  firmSupportDurationMinutes = 15,
  allowStop = true,
}) {
  const reserve = assessReserve({ dieselFleet, bess });
  const onlineRatedMW = dieselFleet
    .filter((dg) => dg.isOnline)
    .reduce((sum, dg) => sum + dg.ratedMW, 0);
  const committedRatedMW = dieselFleet
    .filter((dg) => dg.isCommitted)
    .reduce((sum, dg) => sum + dg.ratedMW, 0);
  const availableByForecastMW = capacityAvailableBy(dieselFleet, forecastHorizonSeconds);

  const forecastSupportDurationMinutes = Math.max(
    firmSupportDurationMinutes,
    forecastHorizonSeconds / 60,
  );
  const bessFirmSupportMW = bess?.isAvailable
    ? bess.sustainableDischargeMW(firmSupportDurationMinutes)
    : 0;
  const bessForecastSupportMW = bess?.isAvailable
    ? bess.sustainableDischargeMW(forecastSupportDurationMinutes)
    : 0;

  const requiredOnlineMW = Math.max(0, loadMW + reserveMarginMW - bessFirmSupportMW);
  const requiredForecastMW = Math.max(0, forecastLoadMW + reserveMarginMW - bessForecastSupportMW);
  const immediateCapacityShortfallMW = Math.max(0, requiredOnlineMW - onlineRatedMW);
  const forecastCapacityShortfallMW = Math.max(0, requiredForecastMW - availableByForecastMW);

  let action = null;

  if (
    immediateCapacityShortfallMW > 1e-9
    || forecastCapacityShortfallMW > 1e-9
    || reserve.n1Status === 'FAIL'
  ) {
    const candidate = sortStartCandidates(dieselFleet, forecastHorizonSeconds)[0];
    if (candidate) {
      const predictedReadyOnTime = candidate.secondsUntilRunning <= forecastHorizonSeconds;
      let reason = 'N-1 reserve assessment failed.';
      if (immediateCapacityShortfallMW > 1e-9) {
        reason = 'Online duration-qualified firm capacity is below the current requirement.';
      } else if (forecastCapacityShortfallMW > 1e-9) {
        reason = predictedReadyOnTime
          ? 'Forecast firm-capacity shortfall requires pre-start before the projected load increase.'
          : 'Forecast firm-capacity shortfall detected; selected unit cannot be ready on time and must start immediately.';
      }
      action = {
        type: 'START',
        equipmentId: candidate.id,
        reason,
        predictive: forecastCapacityShortfallMW > 1e-9 && immediateCapacityShortfallMW <= 1e-9,
        requiredBySeconds: forecastHorizonSeconds,
        secondsUntilRunning: candidate.secondsUntilRunning,
        predictedReadyOnTime,
      };
    }
  } else if (allowStop) {
    const online = dieselFleet.filter((dg) => dg.isOnline);
    if (online.length > minimumOnlineUnits) {
      for (const candidate of sortStopCandidates(dieselFleet)) {
        const remainingOnlineRatedMW = onlineRatedMW - candidate.ratedMW;
        const remainingOnlineUnits = online.length - 1;
        if (remainingOnlineUnits < minimumOnlineUnits) continue;
        const currentSecure = remainingOnlineRatedMW + bessFirmSupportMW + 1e-9 >= loadMW + reserveMarginMW;
        const forecastSecure = remainingOnlineRatedMW + bessForecastSupportMW + 1e-9 >= forecastLoadMW + reserveMarginMW;
        if (currentSecure && forecastSecure) {
          action = {
            type: 'STOP',
            equipmentId: candidate.id,
            reason: 'Excess online capacity can be removed while preserving current and forecast duration-qualified margins.',
            predictive: true,
          };
          break;
        }
      }
    }
  }

  return {
    action,
    reserve,
    onlineRatedMW,
    committedRatedMW,
    availableByForecastMW,
    bessFirmSupportMW,
    bessForecastSupportMW,
    firmSupportDurationMinutes,
    forecastSupportDurationMinutes,
    requiredOnlineMW,
    requiredCommittedMW: requiredOnlineMW,
    requiredForecastMW,
    immediateCapacityShortfallMW,
    forecastCapacityShortfallMW,
    forecastLoadMW,
    forecastHorizonSeconds,
  };
}

export function applyGeneratorCommitmentAction({ dieselFleet, decision }) {
  if (!decision?.action) return null;
  const target = dieselFleet.find((dg) => dg.id === decision.action.equipmentId);
  if (!target) return null;

  const accepted = decision.action.type === 'START'
    ? target.requestStart()
    : target.requestStop();

  return accepted ? { ...decision.action, accepted: true } : { ...decision.action, accepted: false };
}
