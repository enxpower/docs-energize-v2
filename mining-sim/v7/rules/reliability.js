export const RELIABILITY_RULE = Object.freeze({
  BESS_SINGLE_POINT_DEPENDENCY: 'BESS-SPOF-001',
  BESS_NONCRITICAL_AT_EVENT: 'BESS-NONCRITICAL-001',
  BESS_LOSS_RIDE_THROUGH: 'BESS-RIDETHROUGH-001',
});

export function evaluateBessAvailabilityRisk({
  preTripBessMW,
  persistentDeficitMW,
  finalState,
  idleThresholdMW = 0.1,
  deficitThresholdMW = 0.1,
}) {
  if (Math.abs(preTripBessMW) <= idleThresholdMW && persistentDeficitMW <= deficitThresholdMW) {
    return {
      id: RELIABILITY_RULE.BESS_NONCRITICAL_AT_EVENT,
      severity: 'INFO',
      result: 'PASS',
      interpretation: 'BESS loss at this operating point does not create a material generation adequacy shortfall.',
      recommendation: 'Do not generalize this result to higher-load or contingency operating points; test stressed conditions separately.',
    };
  }

  if (persistentDeficitMW > deficitThresholdMW || finalState === 'DEGRADED') {
    return {
      id: RELIABILITY_RULE.BESS_SINGLE_POINT_DEPENDENCY,
      severity: 'HIGH',
      result: 'FAIL_N_MINUS_1',
      interpretation: 'The operating point depends on BESS availability to maintain supply-demand adequacy.',
      recommendation: 'Add firm generation or redundant BESS/PCS capacity, reduce the credible load, or define automatic load shedding before claiming N-1 security.',
    };
  }

  return {
    id: RELIABILITY_RULE.BESS_LOSS_RIDE_THROUGH,
    severity: 'LOW',
    result: 'PASS',
    interpretation: 'The system rides through BESS loss without a persistent adequacy deficit.',
    recommendation: 'Verify the same conclusion across peak load, low SOC, largest generator outage, and renewable variability cases.',
  };
}