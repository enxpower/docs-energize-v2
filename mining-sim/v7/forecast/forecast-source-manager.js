import { assessForecastQuality, FORECAST_STATUS } from './forecast-quality.js';

const ELIGIBLE_STATUS = new Set([
  FORECAST_STATUS.FRESH,
  FORECAST_STATUS.DEGRADED,
]);

function sourceId(source, index) {
  return source.id ?? `FORECAST_SOURCE_${index + 1}`;
}

export class ForecastSourceManager {
  constructor({
    sources = [],
    minimumHoldSeconds = 120,
    primaryRecoverySeconds = 60,
    qualityOptions = {},
  } = {}) {
    this.sources = sources.map((source, index) => ({
      id: sourceId(source, index),
      tier: source.tier ?? index + 1,
      forecast: source.forecast,
    })).sort((a, b) => a.tier - b.tier);
    this.minimumHoldSeconds = Math.max(0, minimumHoldSeconds);
    this.primaryRecoverySeconds = Math.max(0, primaryRecoverySeconds);
    this.qualityOptions = qualityOptions;
    this.activeSourceId = null;
    this.activeSinceSeconds = null;
    this.healthySinceBySource = new Map();
    this.switchCount = 0;
    this.lastSelection = null;
  }

  evaluateSources({ currentTimeSeconds, lookAheadSeconds, currentLoadMW }) {
    return this.sources.map((source) => {
      const forecast = source.forecast?.getCommitmentForecast?.({
        currentTimeSeconds,
        lookAheadSeconds,
        currentLoadMW,
      }) ?? null;
      const quality = assessForecastQuality({
        forecast,
        currentTimeSeconds,
        currentLoadMW,
        ...this.qualityOptions,
      });
      const eligible = ELIGIBLE_STATUS.has(quality.status);
      const previousHealthySince = this.healthySinceBySource.get(source.id);
      if (eligible) {
        if (!Number.isFinite(previousHealthySince)) {
          this.healthySinceBySource.set(source.id, currentTimeSeconds);
        }
      } else {
        this.healthySinceBySource.delete(source.id);
      }
      return {
        ...source,
        forecast,
        quality,
        eligible,
        healthySinceSeconds: this.healthySinceBySource.get(source.id) ?? null,
      };
    });
  }

  selectSource({ evaluations, currentTimeSeconds }) {
    const active = evaluations.find((item) => item.id === this.activeSourceId) ?? null;
    const bestEligible = evaluations.find((item) => item.eligible) ?? null;

    if (!active || !active.eligible) {
      return {
        selected: bestEligible,
        reason: active ? 'ACTIVE_SOURCE_UNAVAILABLE' : 'INITIAL_SOURCE_SELECTION',
      };
    }

    if (!bestEligible || bestEligible.id === active.id || bestEligible.tier >= active.tier) {
      return { selected: active, reason: 'ACTIVE_SOURCE_RETAINED' };
    }

    const activeHoldElapsed = this.activeSinceSeconds === null
      || currentTimeSeconds - this.activeSinceSeconds >= this.minimumHoldSeconds;
    const healthyForSeconds = bestEligible.healthySinceSeconds === null
      ? 0
      : currentTimeSeconds - bestEligible.healthySinceSeconds;
    const recoveryQualified = healthyForSeconds >= this.primaryRecoverySeconds;

    if (activeHoldElapsed && recoveryQualified) {
      return { selected: bestEligible, reason: 'HIGHER_PRIORITY_SOURCE_RECOVERED' };
    }

    return {
      selected: active,
      reason: activeHoldElapsed
        ? 'RECOVERY_QUALIFICATION_PENDING'
        : 'MINIMUM_HOLD_ACTIVE',
    };
  }

  getCommitmentForecast({ currentTimeSeconds = 0, lookAheadSeconds, currentLoadMW }) {
    const now = Math.max(0, Number(currentTimeSeconds) || 0);
    const evaluations = this.evaluateSources({
      currentTimeSeconds: now,
      lookAheadSeconds,
      currentLoadMW,
    });
    const { selected, reason } = this.selectSource({ evaluations, currentTimeSeconds: now });
    const previousSourceId = this.activeSourceId;
    let switchEvent = null;

    if (selected && selected.id !== previousSourceId) {
      this.activeSourceId = selected.id;
      this.activeSinceSeconds = now;
      this.switchCount += 1;
      switchEvent = {
        type: 'FORECAST_SOURCE_SWITCH',
        timeSeconds: now,
        fromSourceId: previousSourceId,
        toSourceId: selected.id,
        toSourceTier: selected.tier,
        reason,
        switchCount: this.switchCount,
      };
    }

    if (!selected) {
      this.activeSourceId = null;
      this.activeSinceSeconds = null;
      const missing = {
        currentLoadMW,
        forecastHorizonSeconds: Math.max(0, lookAheadSeconds),
        forecastEndLoadMW: currentLoadMW,
        forecastPeakLoadMW: currentLoadMW,
        forecastPeakUpperBoundMW: currentLoadMW,
        forecastPlanningLoadMW: currentLoadMW,
        forecastErrorMW: 0,
        securityMarginMW: 0,
        forecastRelativeUncertainty: 0,
        forecastRiskLevel: 'HIGH',
        source: 'NONE',
        generatedAtSeconds: null,
        validUntilSeconds: null,
        qualityGrade: 'UNKNOWN',
      };
      this.lastSelection = {
        forecast: missing,
        activeSourceId: null,
        activeSourceTier: null,
        sourceSelectionReason: 'NO_ELIGIBLE_SOURCE',
        switchEvent,
        evaluations,
      };
      return {
        ...missing,
        activeSourceId: null,
        activeSourceTier: null,
        sourceSelectionReason: 'NO_ELIGIBLE_SOURCE',
        sourceSwitchCount: this.switchCount,
        switchEvent,
      };
    }

    this.lastSelection = {
      forecast: selected.forecast,
      activeSourceId: selected.id,
      activeSourceTier: selected.tier,
      sourceSelectionReason: reason,
      switchEvent,
      evaluations,
    };

    return {
      ...selected.forecast,
      activeSourceId: selected.id,
      activeSourceTier: selected.tier,
      sourceSelectionReason: reason,
      sourceSwitchCount: this.switchCount,
      switchEvent,
    };
  }
}
