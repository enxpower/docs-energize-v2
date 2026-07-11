const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function commandBessFastResponse({
  bess,
  residualBeforeBessMW,
  frequencyHz,
  nominalHz,
  rocofHzPerS,
  secondaryBiasMW = 0,
  feedforwardShare = 0.65,
  frequencyDeadbandHz = 0.05,
  droopGainMWPerHz = null,
  inertiaGainMWPerHzPerS = null,
}) {
  if (!bess.isAvailable) {
    bess.setCommandMW(0);
    return 0;
  }

  const df = frequencyHz - nominalHz;
  const activeDf = Math.abs(df) <= frequencyDeadbandHz
    ? 0
    : df - Math.sign(df) * frequencyDeadbandHz;
  const droopGain = droopGainMWPerHz ?? 0.35 * bess.powerMW;
  const inertiaGain = inertiaGainMWPerHzPerS ?? 0.08 * bess.powerMW;

  // Fast feed-forward deliberately covers only part of the instantaneous mismatch.
  // The remaining mismatch creates a bounded frequency error that the DG governor
  // can detect and assume through primary frequency control. The slower secondary
  // bias then removes persistent residual without replacing the governor response.
  const balanceCommandMW = -residualBeforeBessMW * clamp(feedforwardShare, 0, 1);
  const frequencySupportMW = -activeDf * droopGain;
  const inertialSupportMW = -rocofHzPerS * inertiaGain;
  const rawCommandMW = balanceCommandMW
    + frequencySupportMW
    + inertialSupportMW
    + secondaryBiasMW;
  const commandMW = clamp(rawCommandMW, -bess.availableChargeMW(), bess.availableDischargeMW());

  bess.setCommandMW(commandMW);
  return commandMW;
}
