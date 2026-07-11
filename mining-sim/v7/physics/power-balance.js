export function calculatePowerBalance({ loadMW, dieselMW, bessMW }) {
  const residualMW = dieselMW + bessMW - loadMW;
  return {
    loadMW,
    dieselMW,
    bessMW,
    residualMW,
    balanced: Math.abs(residualMW) <= 1e-6,
  };
}
