export function dispatchIsland({ loadMW, dieselFleet, bess, socTarget = 0.55, socDeadband = 0.04 }) {
  const onlineRatedMW = dieselFleet.reduce((sum, dg) => sum + dg.ratedMW, 0);
  const onlineMinMW = dieselFleet.reduce((sum, dg) => sum + dg.minimumMW, 0);

  const socError = socTarget - bess.soc;
  const socBiasMW = Math.abs(socError) <= socDeadband
    ? 0
    : Math.max(-0.2 * bess.powerMW, Math.min(0.2 * bess.powerMW, socError * bess.energyMWh / 4));

  const dieselTargetMW = Math.max(onlineMinMW, Math.min(onlineRatedMW, loadMW + socBiasMW));
  const share = onlineRatedMW > 0 ? dieselTargetMW / onlineRatedMW : 0;

  for (const dg of dieselFleet) {
    dg.setCommandMW(dg.ratedMW * share);
  }

  return { dieselTargetMW, socBiasMW };
}
