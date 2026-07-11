import { ForecastSourceManager } from '../forecast/forecast-source-manager.js';
import { HoldCurrentLoadForecast } from '../forecast/load-forecast.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class MutableForecast {
  constructor({ source, planningLoadMW, generatedAtSeconds, validUntilSeconds, qualityGrade = 'A' }) {
    this.source = source;
    this.planningLoadMW = planningLoadMW;
    this.generatedAtSeconds = generatedAtSeconds;
    this.validUntilSeconds = validUntilSeconds;
    this.qualityGrade = qualityGrade;
    this.available = true;
  }

  refresh({ generatedAtSeconds, validUntilSeconds, planningLoadMW = this.planningLoadMW, qualityGrade = this.qualityGrade }) {
    this.generatedAtSeconds = generatedAtSeconds;
    this.validUntilSeconds = validUntilSeconds;
    this.planningLoadMW = planningLoadMW;
    this.qualityGrade = qualityGrade;
    this.available = true;
  }

  getCommitmentForecast({ lookAheadSeconds, currentLoadMW }) {
    if (!this.available) return null;
    return {
      currentLoadMW,
      forecastHorizonSeconds: lookAheadSeconds,
      forecastEndLoadMW: this.planningLoadMW,
      forecastPeakLoadMW: this.planningLoadMW,
      forecastPeakUpperBoundMW: this.planningLoadMW,
      forecastPlanningLoadMW: this.planningLoadMW,
      forecastErrorMW: 0,
      securityMarginMW: 0,
      forecastRelativeUncertainty: 0,
      forecastRiskLevel: 'LOW',
      source: this.source,
      generatedAtSeconds: this.generatedAtSeconds,
      validUntilSeconds: this.validUntilSeconds,
      qualityGrade: this.qualityGrade,
    };
  }
}

export function testPrimaryFailsOverToSecondary() {
  const primary = new MutableForecast({
    source: 'PRIMARY_ML',
    planningLoadMW: 8,
    generatedAtSeconds: 0,
    validUntilSeconds: 10,
  });
  const secondary = new MutableForecast({
    source: 'SHIFT_SCHEDULE',
    planningLoadMW: 8.5,
    generatedAtSeconds: 0,
    validUntilSeconds: 300,
    qualityGrade: 'B',
  });
  const manager = new ForecastSourceManager({
    sources: [
      { id: 'PRIMARY', tier: 1, forecast: primary },
      { id: 'SECONDARY', tier: 2, forecast: secondary },
    ],
    minimumHoldSeconds: 60,
    primaryRecoverySeconds: 30,
  });

  const initial = manager.getCommitmentForecast({ currentTimeSeconds: 0, lookAheadSeconds: 120, currentLoadMW: 7 });
  const failedOver = manager.getCommitmentForecast({ currentTimeSeconds: 20, lookAheadSeconds: 120, currentLoadMW: 7 });

  assert(initial.activeSourceId === 'PRIMARY', `expected PRIMARY initially, received ${initial.activeSourceId}`);
  assert(failedOver.activeSourceId === 'SECONDARY', `expected SECONDARY after expiry, received ${failedOver.activeSourceId}`);
  assert(failedOver.switchEvent?.fromSourceId === 'PRIMARY', 'failover event did not identify PRIMARY');
  assert(failedOver.switchEvent?.reason === 'ACTIVE_SOURCE_UNAVAILABLE', `unexpected failover reason: ${failedOver.switchEvent?.reason}`);

  return {
    name: 'Forecast primary-to-secondary failover',
    status: 'PASS',
    metrics: {
      initialSource: initial.activeSourceId,
      failedOverSource: failedOver.activeSourceId,
      switchEvent: failedOver.switchEvent,
    },
  };
}

export function testPrimaryRecoveryUsesHysteresis() {
  const primary = new MutableForecast({
    source: 'PRIMARY_ML',
    planningLoadMW: 8,
    generatedAtSeconds: 0,
    validUntilSeconds: 10,
  });
  const secondary = new MutableForecast({
    source: 'SHIFT_SCHEDULE',
    planningLoadMW: 8.5,
    generatedAtSeconds: 0,
    validUntilSeconds: 300,
    qualityGrade: 'B',
  });
  const manager = new ForecastSourceManager({
    sources: [
      { id: 'PRIMARY', tier: 1, forecast: primary },
      { id: 'SECONDARY', tier: 2, forecast: secondary },
    ],
    minimumHoldSeconds: 60,
    primaryRecoverySeconds: 30,
  });

  manager.getCommitmentForecast({ currentTimeSeconds: 0, lookAheadSeconds: 120, currentLoadMW: 7 });
  manager.getCommitmentForecast({ currentTimeSeconds: 20, lookAheadSeconds: 120, currentLoadMW: 7 });
  primary.refresh({ generatedAtSeconds: 30, validUntilSeconds: 300 });

  const earlyRecovery = manager.getCommitmentForecast({ currentTimeSeconds: 40, lookAheadSeconds: 120, currentLoadMW: 7 });
  const qualifiedRecovery = manager.getCommitmentForecast({ currentTimeSeconds: 90, lookAheadSeconds: 120, currentLoadMW: 7 });

  assert(earlyRecovery.activeSourceId === 'SECONDARY', 'manager switched back before hold/recovery qualification');
  assert(earlyRecovery.switchEvent === null, 'early recovery should not create a switch event');
  assert(qualifiedRecovery.activeSourceId === 'PRIMARY', `expected PRIMARY after qualification, received ${qualifiedRecovery.activeSourceId}`);
  assert(qualifiedRecovery.switchEvent?.reason === 'HIGHER_PRIORITY_SOURCE_RECOVERED', `unexpected recovery reason: ${qualifiedRecovery.switchEvent?.reason}`);

  return {
    name: 'Forecast source recovery hysteresis',
    status: 'PASS',
    metrics: {
      earlyRecoverySource: earlyRecovery.activeSourceId,
      earlySelectionReason: earlyRecovery.sourceSelectionReason,
      recoveredSource: qualifiedRecovery.activeSourceId,
      recoverySwitchEvent: qualifiedRecovery.switchEvent,
    },
  };
}

export function testEmergencyForecastFallback() {
  const unavailable = { getCommitmentForecast: () => null };
  const staleHold = new MutableForecast({
    source: 'CURRENT_LOAD_HOLD',
    planningLoadMW: 7.5,
    generatedAtSeconds: 0,
    validUntilSeconds: 5,
    qualityGrade: 'C',
  });
  const emergency = new HoldCurrentLoadForecast({
    uncertaintyMW: 1.0,
    securityMarginMW: 0.5,
    source: 'EMERGENCY_FALLBACK',
    qualityGrade: 'D',
  });
  const manager = new ForecastSourceManager({
    sources: [
      { id: 'PRIMARY', tier: 1, forecast: unavailable },
      { id: 'SECONDARY', tier: 2, forecast: unavailable },
      { id: 'HOLD', tier: 3, forecast: staleHold },
      { id: 'EMERGENCY', tier: 4, forecast: emergency },
    ],
  });

  const result = manager.getCommitmentForecast({ currentTimeSeconds: 20, lookAheadSeconds: 120, currentLoadMW: 7 });

  assert(result.activeSourceId === 'EMERGENCY', `expected EMERGENCY source, received ${result.activeSourceId}`);
  assert(result.forecastPlanningLoadMW >= 8.5, `emergency fallback margin missing: ${result.forecastPlanningLoadMW}`);
  assert(result.qualityGrade === 'D', `expected D-grade emergency forecast, received ${result.qualityGrade}`);

  return {
    name: 'Forecast emergency fallback chain',
    status: 'PASS',
    metrics: {
      activeSourceId: result.activeSourceId,
      activeSourceTier: result.activeSourceTier,
      planningLoadMW: result.forecastPlanningLoadMW,
      qualityGrade: result.qualityGrade,
      switchEvent: result.switchEvent,
    },
  };
}
