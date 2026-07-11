const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const FORECAST_STATUS = Object.freeze({
  FRESH: 'FRESH',
  DEGRADED: 'DEGRADED',
  STALE: 'STALE',
  MISSING: 'MISSING',
  INVALID: 'INVALID',
});

export const FORECAST_GRADE = Object.freeze({
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  UNKNOWN: 'UNKNOWN',
});

const normalizeGrade = (grade) => Object.values(FORECAST_GRADE).includes(grade)
  ? grade
  : FORECAST_GRADE.UNKNOWN;

export function assessForecastQuality({
  forecast,
  currentTimeSeconds,
  currentLoadMW,
  staleFallbackMarginMW = 0.5,
  lowQualityMarginMW = 0.25,
  missingFallbackMarginMW = 1.0,
}) {
  const now = Math.max(0, Number(currentTimeSeconds) || 0);
  const current = Math.max(0, Number(currentLoadMW) || 0);

  if (!forecast) {
    return {
      status: FORECAST_STATUS.MISSING,
      grade: FORECAST_GRADE.UNKNOWN,
      source: 'NONE',
      ageSeconds: Infinity,
      validUntilSeconds: null,
      allowAutomaticStop: false,
      effectivePlanningLoadMW: current + Math.max(0, missingFallbackMarginMW),
      degradationMarginMW: Math.max(0, missingFallbackMarginMW),
      reason: 'Forecast is missing; use current load plus conservative fallback margin.',
    };
  }

  const planningLoadMW = Number(forecast.forecastPlanningLoadMW);
  if (!Number.isFinite(planningLoadMW) || planningLoadMW < 0) {
    return {
      status: FORECAST_STATUS.INVALID,
      grade: normalizeGrade(forecast.qualityGrade),
      source: forecast.source ?? 'UNKNOWN',
      ageSeconds: Infinity,
      validUntilSeconds: forecast.validUntilSeconds ?? null,
      allowAutomaticStop: false,
      effectivePlanningLoadMW: current + Math.max(0, missingFallbackMarginMW),
      degradationMarginMW: Math.max(0, missingFallbackMarginMW),
      reason: 'Forecast payload is invalid; use conservative fallback planning load.',
    };
  }

  const generatedAtSeconds = Number.isFinite(forecast.generatedAtSeconds)
    ? forecast.generatedAtSeconds
    : 0;
  const validUntilSeconds = Number.isFinite(forecast.validUntilSeconds)
    ? forecast.validUntilSeconds
    : generatedAtSeconds;
  const ageSeconds = Math.max(0, now - generatedAtSeconds);
  const grade = normalizeGrade(forecast.qualityGrade);
  const source = forecast.source ?? 'UNKNOWN';
  const isStale = now > validUntilSeconds + 1e-9;

  if (isStale) {
    const margin = Math.max(0, staleFallbackMarginMW);
    return {
      status: FORECAST_STATUS.STALE,
      grade,
      source,
      ageSeconds,
      validUntilSeconds,
      allowAutomaticStop: false,
      effectivePlanningLoadMW: Math.max(current + margin, planningLoadMW),
      degradationMarginMW: margin,
      reason: 'Forecast validity window has expired; retain conservative capacity and block automatic stop.',
    };
  }

  if ([FORECAST_GRADE.C, FORECAST_GRADE.D, FORECAST_GRADE.UNKNOWN].includes(grade)) {
    const gradeMultiplier = grade === FORECAST_GRADE.D ? 2 : 1;
    const margin = Math.max(0, lowQualityMarginMW) * gradeMultiplier;
    return {
      status: FORECAST_STATUS.DEGRADED,
      grade,
      source,
      ageSeconds,
      validUntilSeconds,
      allowAutomaticStop: false,
      effectivePlanningLoadMW: planningLoadMW + margin,
      degradationMarginMW: margin,
      reason: 'Forecast quality grade is insufficient for aggressive decommitment.',
    };
  }

  return {
    status: FORECAST_STATUS.FRESH,
    grade,
    source,
    ageSeconds,
    validUntilSeconds,
    allowAutomaticStop: true,
    effectivePlanningLoadMW: planningLoadMW,
    degradationMarginMW: 0,
    reason: 'Forecast is fresh and quality is acceptable for normal commitment decisions.',
    freshnessRatio: validUntilSeconds > generatedAtSeconds
      ? clamp((validUntilSeconds - now) / (validUntilSeconds - generatedAtSeconds), 0, 1)
      : 0,
  };
}
