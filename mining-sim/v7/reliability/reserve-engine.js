const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function dieselResponseWithin(dg, horizonSeconds) {
  if (!dg.isOnline) return 0;
  const headroomMW = Math.max(0, dg.ratedMW - dg.outputMW);
  return Math.min(headroomMW, dg.rampUpMWPerS * horizonSeconds);
}

function bessFastReserveMW(bess) {
  if (!bess?.isAvailable) return 0;
  return Math.max(0, bess.availableDischargeMW() - Math.max(0, bess.outputMW));
}

export function assessReserve({ dieselFleet, bess, horizonsSeconds = [10, 60, 600] }) {
  const online = dieselFleet.filter((dg) => dg.isOnline);
  const starting = dieselFleet.filter((dg) => dg.isStarting);
  const offline = dieselFleet.filter((dg) => !dg.isCommitted && dg.state !== 'TRIPPED');

  const onlineRatedMW = online.reduce((sum, dg) => sum + dg.ratedMW, 0);
  const onlineOutputMW = online.reduce((sum, dg) => sum + dg.outputMW, 0);
  const spinningHeadroomMW = Math.max(0, onlineRatedMW - onlineOutputMW);
  const largestOnlineContingencyMW = online.length
    ? Math.max(...online.map((dg) => dg.outputMW))
    : 0;
  const largestOnlineRatedMW = online.length
    ? Math.max(...online.map((dg) => dg.ratedMW))
    : 0;
  const bessFastMW = bessFastReserveMW(bess);

  const responseByHorizonMW = {};
  for (const horizon of horizonsSeconds) {
    const dieselMW = online.reduce((sum, dg) => sum + dieselResponseWithin(dg, horizon), 0);
    const startableMW = [...starting, ...offline]
      .filter((dg) => dg.secondsUntilRunning <= horizon)
      .reduce((sum, dg) => sum + dg.ratedMW, 0);
    responseByHorizonMW[horizon] = {
      dieselSpinningMW: dieselMW,
      bessFastMW,
      startableMW,
      totalMW: dieselMW + bessFastMW + startableMW,
    };
  }

  const fast10MW = responseByHorizonMW[10]?.totalMW ?? 0;
  const reserve60MW = responseByHorizonMW[60]?.totalMW ?? fast10MW;
  const reserve600MW = responseByHorizonMW[600]?.totalMW ?? reserve60MW;

  let n1Status = 'PASS';
  let n1Reason = 'Fast reserve covers the largest online contingency.';
  if (fast10MW + 1e-9 < largestOnlineContingencyMW) {
    if (reserve60MW + 1e-9 >= largestOnlineContingencyMW) {
      n1Status = 'CONDITIONAL';
      n1Reason = 'Fast reserve is insufficient, but 60-second reserve can cover the largest online contingency.';
    } else {
      n1Status = 'FAIL';
      n1Reason = 'Available reserve cannot cover the largest online contingency within 60 seconds.';
    }
  }

  return {
    onlineCount: online.length,
    startingCount: starting.length,
    offlineCount: offline.length,
    onlineRatedMW,
    onlineOutputMW,
    spinningHeadroomMW,
    largestOnlineContingencyMW,
    largestOnlineRatedMW,
    bessFastReserveMW: bessFastMW,
    fast10MW,
    reserve60MW,
    reserve600MW,
    responseByHorizonMW,
    n1Status,
    n1Reason,
    n1CoverageRatio: largestOnlineContingencyMW > 0
      ? clamp(fast10MW / largestOnlineContingencyMW, 0, 99)
      : Infinity,
  };
}
