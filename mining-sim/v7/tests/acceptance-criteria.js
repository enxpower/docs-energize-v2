export const ACCEPTANCE = Object.freeze({
  steadyState: Object.freeze({
    maxPowerResidualMW: 0.05,
    maxFrequencyErrorHz: 0.10,
  }),
  loadStep: Object.freeze({
    maxFastResidualMW: 0.50,
    maxRecoveredFrequencyErrorHz: 0.15,
    maxRecoveredResidualMW: 0.10,
    recoveryWindowSeconds: 60,
  }),
  largestDieselTrip: Object.freeze({
    minimumFrequencyNadirHz: 58.50,
    maximumRoCoFHzPerS: 2.00,
    minimumBessResponseMW: 2.00,
    bessResponseWindowSeconds: 5,
    maximumRecoveredFrequencyErrorHz: 0.20,
    maximumRecoveredResidualMW: 0.10,
    recoveryWindowSeconds: 60,
  }),
  powerBalance: Object.freeze({
    maximumTransientResidualMW: 0.80,
  }),
});
