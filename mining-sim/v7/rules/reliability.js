export const RELIABILITY_RULE = Object.freeze({
  BESS_SINGLE_POINT_DEPENDENCY: 'BESS-SPOF-001',
  BESS_NONCRITICAL_AT_EVENT: 'BESS-NONCRITICAL-001',
  BESS_LOSS_RIDE_THROUGH: 'BESS-RIDETHROUGH-001',
  BESS_LOW_SOC_POWER_LIMIT: 'BESS-LOW-SOC-001',
  BESS_DURATION_SHORTFALL: 'BESS-DURATION-001',
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

export function evaluateBessEnergyAdequacy({
  soc,
  minSoc,
  availableDischargeMW,
  requiredSupportMW,
  supportDurationMinutes,
  requiredDurationMinutes = 15,
  deficitThresholdMW = 0.1,
}) {
  const powerShortfallMW = Math.max(0, requiredSupportMW - availableDischargeMW);

  if (powerShortfallMW > deficitThresholdMW) {
    return {
      id: RELIABILITY_RULE.BESS_LOW_SOC_POWER_LIMIT,
      severity: 'HIGH',
      result: 'FAIL_POWER_ADEQUACY',
      interpretation: 'SOC-dependent BESS derating leaves insufficient instantaneous discharge capability for the required support.',
      recommendation: 'Raise the minimum dispatch SOC, reserve more BESS power, add firm generation, reduce the credible load step, or add redundant PCS/BESS capacity.',
      metrics: { soc, minSoc, availableDischargeMW, requiredSupportMW, powerShortfallMW },
    };
  }

  if (requiredSupportMW > 0 && supportDurationMinutes < requiredDurationMinutes) {
    return {
      id: RELIABILITY_RULE.BESS_DURATION_SHORTFALL,
      severity: 'MEDIUM',
      result: 'FAIL_ENERGY_ADEQUACY',
      interpretation: 'BESS can meet the instantaneous power requirement but cannot sustain it for the required duration.',
      recommendation: 'Increase usable MWh, raise reserve SOC, shorten the required ride-through interval, or ensure another source can take over before BESS energy is exhausted.',
      metrics: { soc, minSoc, availableDischargeMW, requiredSupportMW, supportDurationMinutes, requiredDurationMinutes },
    };
  }

  return {
    id: 'BESS-ADEQUATE-001',
    severity: 'INFO',
    result: 'PASS',
    interpretation: 'BESS has sufficient instantaneous power and screening-duration energy for the requested support.',
    recommendation: 'Continue to verify thermal limits, PCS current limits, degradation, and contingency reserve in higher-fidelity studies.',
    metrics: { soc, minSoc, availableDischargeMW, requiredSupportMW, supportDurationMinutes, requiredDurationMinutes },
  };
}
