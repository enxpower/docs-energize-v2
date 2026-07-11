import { assessReserve } from '../reliability/reserve-engine.js';

function sortStartCandidates(fleet) {
  return [...fleet]
    .filter((dg) => dg.isStartable)
    .sort((a, b) => a.secondsUntilRunning - b.secondsUntilRunning || b.ratedMW - a.ratedMW);
}

function sortStopCandidates(fleet) {
  return [...fleet]
    .filter((dg) => dg.isOnline && dg.runTimeSeconds >= dg.minRunSeconds)
    .sort((a, b) => a.outputMW - b.outputMW || a.ratedMW - b.ratedMW);
}

export function evaluateGeneratorCommitment({
  loadMW,
  dieselFleet,
  bess,
  minimumOnlineUnits = 1,
  reserveMarginMW = 0,
  firmSupportDurationMinutes = 15,
  allowStop = true,
}) {
  const reserve = assessReserve({ dieselFleet, bess });
  const committedRatedMW = dieselFleet
    .filter((dg) => dg.isCommitted)
    .reduce((sum, dg) => sum + dg.ratedMW, 0);
  const bessFirmSupportMW = bess?.isAvailable
    ? bess.sustainableDischargeMW(firmSupportDurationMinutes)
    : 0;
  const requiredCommittedMW = Math.max(0, loadMW + reserveMarginMW - bessFirmSupportMW);

  let action = null;

  if (committedRatedMW + 1e-9 < requiredCommittedMW || reserve.n1Status === 'FAIL') {
    const candidate = sortStartCandidates(dieselFleet)[0];
    if (candidate) {
      action = {
        type: 'START',
        equipmentId: candidate.id,
        reason: committedRatedMW < requiredCommittedMW
          ? 'Committed duration-qualified firm capacity is below requirement.'
          : 'N-1 reserve assessment failed.',
      };
    }
  } else if (allowStop) {
    const online = dieselFleet.filter((dg) => dg.isOnline);
    if (online.length > minimumOnlineUnits) {
      for (const candidate of sortStopCandidates(dieselFleet)) {
        const remainingRatedMW = committedRatedMW - candidate.ratedMW;
        const remainingOnlineUnits = online.length - 1;
        if (remainingOnlineUnits < minimumOnlineUnits) continue;
        if (remainingRatedMW + bessFirmSupportMW + 1e-9 >= loadMW + reserveMarginMW) {
          action = {
            type: 'STOP',
            equipmentId: candidate.id,
            reason: 'Excess committed capacity can be removed while preserving the duration-qualified firm-capacity margin.',
          };
          break;
        }
      }
    }
  }

  return {
    action,
    reserve,
    committedRatedMW,
    bessFirmSupportMW,
    firmSupportDurationMinutes,
    requiredCommittedMW,
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
