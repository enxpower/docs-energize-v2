const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizePoints = (points) => [...points]
  .map((point) => ({
    timeSeconds: Math.max(0, Number(point.timeSeconds) || 0),
    loadMW: Math.max(0, Number(point.loadMW) || 0),
    uncertaintyMW: Math.max(0, Number(point.uncertaintyMW) || 0),
    uncertaintyPU: clamp(Number(point.uncertaintyPU) || 0, 0, 1),
  }))
  .sort((a, b) => a.timeSeconds - b.timeSeconds);

function uncertaintyFor({ loadMW, uncertaintyMW = 0, uncertaintyPU = 0 }) {
  return Math.max(0, uncertaintyMW, loadMW * uncertaintyPU);
}

export function buildForecastEnvelope({
  p50LoadMW,
  uncertaintyMW = 0,
  uncertaintyPU = 0,
  securityMarginMW = 0,
}) {
  const p50 = Math.max(0, p50LoadMW);
  const forecastErrorMW = uncertaintyFor({ loadMW: p50, uncertaintyMW, uncertaintyPU });
  const upperBoundMW = p50 + forecastErrorMW;
  const planningLoadMW = upperBoundMW + Math.max(0, securityMarginMW);
  const relativeUncertainty = p50 > 0 ? forecastErrorMW / p50 : 0;
  const riskLevel = relativeUncertainty >= 0.15
    ? 'HIGH'
    : relativeUncertainty >= 0.07
      ? 'MEDIUM'
      : 'LOW';

  return {
    p50LoadMW: p50,
    forecastErrorMW,
    upperBoundMW,
    securityMarginMW: Math.max(0, securityMarginMW),
    planningLoadMW,
    relativeUncertainty,
    riskLevel,
  };
}

export class PiecewiseLoadForecast {
  constructor({
    points = [],
    fallbackMW = 0,
    fallbackUncertaintyMW = 0,
    fallbackUncertaintyPU = 0,
    securityMarginMW = 0,
    source = 'SCHEDULE',
    generatedAtSeconds = 0,
    validForSeconds = 900,
    qualityGrade = 'B',
  } = {}) {
    this.points = normalizePoints(points);
    this.fallbackMW = Math.max(0, fallbackMW);
    this.fallbackUncertaintyMW = Math.max(0, fallbackUncertaintyMW);
    this.fallbackUncertaintyPU = clamp(fallbackUncertaintyPU, 0, 1);
    this.securityMarginMW = Math.max(0, securityMarginMW);
    this.source = source;
    this.generatedAtSeconds = Math.max(0, Number(generatedAtSeconds) || 0);
    this.validForSeconds = Math.max(0, Number(validForSeconds) || 0);
    this.qualityGrade = qualityGrade;
  }

  pointAt(timeSeconds) {
    const t = Math.max(0, timeSeconds);
    let value = {
      loadMW: this.fallbackMW,
      uncertaintyMW: this.fallbackUncertaintyMW,
      uncertaintyPU: this.fallbackUncertaintyPU,
    };
    for (const point of this.points) {
      if (point.timeSeconds > t) break;
      value = point;
    }
    return value;
  }

  forecastAt(timeSeconds) {
    return this.pointAt(timeSeconds).loadMW;
  }

  envelopeAt(timeSeconds) {
    const point = this.pointAt(timeSeconds);
    return buildForecastEnvelope({
      p50LoadMW: point.loadMW,
      uncertaintyMW: point.uncertaintyMW,
      uncertaintyPU: point.uncertaintyPU,
      securityMarginMW: this.securityMarginMW,
    });
  }

  peakEnvelopeBetween(startSeconds, endSeconds, sampleIntervalSeconds = 10) {
    const start = Math.max(0, startSeconds);
    const end = Math.max(start, endSeconds);
    const candidateTimes = new Set([start, end]);

    for (const point of this.points) {
      if (point.timeSeconds >= start && point.timeSeconds <= end) candidateTimes.add(point.timeSeconds);
    }
    if (sampleIntervalSeconds > 0) {
      for (let t = start; t <= end; t += sampleIntervalSeconds) candidateTimes.add(t);
    }

    let peak = this.envelopeAt(start);
    for (const t of candidateTimes) {
      const envelope = this.envelopeAt(t);
      if (envelope.planningLoadMW > peak.planningLoadMW) peak = envelope;
    }
    return peak;
  }

  peakBetween(startSeconds, endSeconds, sampleIntervalSeconds = 10) {
    return this.peakEnvelopeBetween(startSeconds, endSeconds, sampleIntervalSeconds).p50LoadMW;
  }

  getCommitmentForecast({ currentTimeSeconds, lookAheadSeconds, currentLoadMW }) {
    const horizonSeconds = Math.max(0, lookAheadSeconds);
    const peakEnvelope = this.peakEnvelopeBetween(currentTimeSeconds, currentTimeSeconds + horizonSeconds);
    const endEnvelope = this.envelopeAt(currentTimeSeconds + horizonSeconds);
    const currentEnvelope = buildForecastEnvelope({
      p50LoadMW: currentLoadMW,
      securityMarginMW: this.securityMarginMW,
    });

    return {
      currentLoadMW,
      forecastHorizonSeconds: horizonSeconds,
      forecastEndLoadMW: endEnvelope.p50LoadMW,
      forecastPeakLoadMW: Math.max(currentLoadMW, peakEnvelope.p50LoadMW),
      forecastPeakUpperBoundMW: Math.max(currentEnvelope.upperBoundMW, peakEnvelope.upperBoundMW),
      forecastPlanningLoadMW: Math.max(currentEnvelope.planningLoadMW, peakEnvelope.planningLoadMW),
      forecastErrorMW: peakEnvelope.forecastErrorMW,
      securityMarginMW: peakEnvelope.securityMarginMW,
      forecastRelativeUncertainty: peakEnvelope.relativeUncertainty,
      forecastRiskLevel: peakEnvelope.riskLevel,
      source: this.source,
      generatedAtSeconds: this.generatedAtSeconds,
      validUntilSeconds: this.generatedAtSeconds + this.validForSeconds,
      qualityGrade: this.qualityGrade,
    };
  }
}

export class HoldCurrentLoadForecast {
  constructor({
    uncertaintyMW = 0,
    uncertaintyPU = 0,
    securityMarginMW = 0,
    source = 'REALTIME_HOLD',
    qualityGrade = 'A',
  } = {}) {
    this.uncertaintyMW = Math.max(0, uncertaintyMW);
    this.uncertaintyPU = clamp(uncertaintyPU, 0, 1);
    this.securityMarginMW = Math.max(0, securityMarginMW);
    this.source = source;
    this.qualityGrade = qualityGrade;
  }

  getCommitmentForecast({ currentTimeSeconds = 0, lookAheadSeconds, currentLoadMW }) {
    const envelope = buildForecastEnvelope({
      p50LoadMW: currentLoadMW,
      uncertaintyMW: this.uncertaintyMW,
      uncertaintyPU: this.uncertaintyPU,
      securityMarginMW: this.securityMarginMW,
    });
    return {
      currentLoadMW,
      forecastHorizonSeconds: Math.max(0, lookAheadSeconds),
      forecastEndLoadMW: currentLoadMW,
      forecastPeakLoadMW: currentLoadMW,
      forecastPeakUpperBoundMW: envelope.upperBoundMW,
      forecastPlanningLoadMW: envelope.planningLoadMW,
      forecastErrorMW: envelope.forecastErrorMW,
      securityMarginMW: envelope.securityMarginMW,
      forecastRelativeUncertainty: envelope.relativeUncertainty,
      forecastRiskLevel: envelope.riskLevel,
      source: this.source,
      generatedAtSeconds: Math.max(0, currentTimeSeconds),
      validUntilSeconds: Infinity,
      qualityGrade: this.qualityGrade,
    };
  }
}
