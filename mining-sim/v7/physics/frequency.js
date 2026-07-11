export function stepIslandFrequency(state, input, dt) {
  const { nominalHz, systemBaseMW, inertiaSeconds, loadDampingMWPerHz } = input;
  const mismatchMW = input.generationMW - input.loadMW;
  const dfdt = (
    nominalHz * (mismatchMW - loadDampingMWPerHz * (state.frequencyHz - nominalHz))
  ) / (2 * Math.max(inertiaSeconds, 0.1) * Math.max(systemBaseMW, 0.1));

  return {
    frequencyHz: state.frequencyHz + dfdt * dt,
    rocofHzPerS: dfdt,
    mismatchMW,
  };
}
