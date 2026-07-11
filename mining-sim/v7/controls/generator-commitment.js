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
  forecastPlanningLoadMW = forecastLoadMW,
  forecastHorizonSeconds = 0,
  forecastRiskLevel = 'LOW',
  forecastErrorMW = Math.max(0, forecastPlanningLoadMW - forecastLoadMW),
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

  const securedForecastLoadMW = Math.max(forecastLoadMW, forecastPlanningLoadMW);
  const requiredOnlineMW = Math.max(0, loadMW + reserveMarginMW - bessFirmSupportMW);
  const requiredForecastMW = Math.max(0, securedForecastLoadMW + reserveMarginMW - bessForecastSupportMW);
  const immediateCapacityShortfallMW = Math.max(0, requiredOnlineMW - onlineRatedMW);
  const forecastCapacityShortfallMW = Math.max(0, requiredForecastMW - availableByForecastMW);
  const uncertaintyExposureMW = Math.max(0, securedForecastLoadMW - forecastLoadMW);

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
          ? 'Forecast upper-bound capacity shortfall requires pre-start before the projected load increase.'
          : 'Forecast upper-bound capacity shortfall detected; selected unit cannot be ready on time and must start immediately.';
      }
      action = {
        type: 'START',
        equipmentId: candidate.id,
        reason,
        predictive: forecastCapacityShortfallMW > 1e-9 && immediateCapacityShortfallMW <= 1e-9,
        uncertaintyDriven: uncertaintyExposureMW > 1e-9 && forecastLoadMW <= availableByForecastMW + bessForecastSupportMW,
        requiredBySeconds: forecastHorizonSeconds,
        secondsUntilRunning: candidate.secondsUntilRunning,
        predictedReadyOnTime,
        forecastRiskLevel,
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
        const forecastSecure = remainingOnlineRatedMW + bessForecastSupportMW + 1e-9 >= securedForecastLoadMW + reserveMarginMW;
        if (currentSecure && forecastSecure) {
          action = {
            type: 'STOP',
            equipmentId: candidate.id,
            reason: 'Excess online capacity can be removed while preserving current and forecast upper-bound margins.',
            predictive: true,
            uncertaintyDriven: false,
            forecastRiskLevel,
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
    forecastPlanningLoadMW: securedForecastLoadMW,
    forecastErrorMW,
    forecastRiskLevel,
    uncertaintyExposureMW,
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
