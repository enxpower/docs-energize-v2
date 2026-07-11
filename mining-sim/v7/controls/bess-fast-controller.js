const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function commandBessFastResponse({
  bess,
  residualBeforeBessMW,
  frequencyHz,
  nominalHz,
  rocofHzPerS,
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
  const droopGain = droopGainMWPerHz ?? 0.12 * bess.powerMW;
  const inertiaGain = inertiaGainMWPerHzPerS ?? 0.04 * bess.powerMW;

  const balanceCommandMW = -residualBeforeBessMW;
  const frequencySupportMW = -activeDf * droopGain;
  const inertialSupportMW = -rocofHzPerS * inertiaGain;
  const rawCommandMW = balanceCommandMW + frequencySupportMW + inertialSupportMW;
  const commandMW = clamp(rawCommandMW, -bess.availableChargeMW(), bess.availableDischargeMW());

  bess.setCommandMW(commandMW);
  return commandMW;
}
