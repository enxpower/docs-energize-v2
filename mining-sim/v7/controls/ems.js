export function dispatchIsland({ loadMW, dieselFleet, bess, socTarget = 0.55, socDeadband = 0.04 }) {
  const onlineFleet = dieselFleet.filter((dg) => dg.isOnline);
  const onlineRatedMW = onlineFleet.reduce((sum, dg) => sum + dg.ratedMW, 0);
  const onlineMinMW = onlineFleet.reduce((sum, dg) => sum + dg.minimumMW, 0);

  const socError = socTarget - bess.soc;
  const socBiasMW = !bess.isAvailable || Math.abs(socError) <= socDeadband
    ? 0
    : Math.max(-0.2 * bess.powerMW, Math.min(0.2 * bess.powerMW, socError * bess.energyMWh / 4));

  const dieselTargetMW = onlineRatedMW > 0
    ? Math.max(onlineMinMW, Math.min(onlineRatedMW, loadMW + socBiasMW))
    : 0;
  const share = onlineRatedMW > 0 ? dieselTargetMW / onlineRatedMW : 0;

  for (const dg of dieselFleet) {
    dg.setEmsSetpointMW(dg.isOnline ? dg.ratedMW * share : 0);
  }

  return {
    dieselTargetMW,
    socBiasMW,
    onlineRatedMW,
    bessAvailable: bess.isAvailable,
  };
}
