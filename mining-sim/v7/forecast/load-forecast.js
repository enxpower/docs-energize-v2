const normalizePoints = (points) => [...points]
  .map((point) => ({
    timeSeconds: Math.max(0, Number(point.timeSeconds) || 0),
    loadMW: Math.max(0, Number(point.loadMW) || 0),
  }))
  .sort((a, b) => a.timeSeconds - b.timeSeconds);

export class PiecewiseLoadForecast {
  constructor({ points = [], fallbackMW = 0 } = {}) {
    this.points = normalizePoints(points);
    this.fallbackMW = Math.max(0, fallbackMW);
  }

  forecastAt(timeSeconds) {
    const t = Math.max(0, timeSeconds);
    let value = this.fallbackMW;
    for (const point of this.points) {
      if (point.timeSeconds > t) break;
      value = point.loadMW;
    }
    return value;
  }

  peakBetween(startSeconds, endSeconds, sampleIntervalSeconds = 10) {
    const start = Math.max(0, startSeconds);
    const end = Math.max(start, endSeconds);
    let peakMW = Math.max(this.forecastAt(start), this.forecastAt(end));

    for (const point of this.points) {
      if (point.timeSeconds >= start && point.timeSeconds <= end) {
        peakMW = Math.max(peakMW, point.loadMW);
      }
    }

    if (sampleIntervalSeconds > 0) {
      for (let t = start; t <= end; t += sampleIntervalSeconds) {
        peakMW = Math.max(peakMW, this.forecastAt(t));
      }
    }
    return peakMW;
  }

  getCommitmentForecast({ currentTimeSeconds, lookAheadSeconds, currentLoadMW }) {
    const horizonSeconds = Math.max(0, lookAheadSeconds);
    const peakLoadMW = this.peakBetween(
      currentTimeSeconds,
      currentTimeSeconds + horizonSeconds,
    );
    return {
      currentLoadMW,
      forecastHorizonSeconds: horizonSeconds,
      forecastEndLoadMW: this.forecastAt(currentTimeSeconds + horizonSeconds),
      forecastPeakLoadMW: Math.max(currentLoadMW, peakLoadMW),
    };
  }
}

export class HoldCurrentLoadForecast {
  getCommitmentForecast({ lookAheadSeconds, currentLoadMW }) {
    return {
      currentLoadMW,
      forecastHorizonSeconds: Math.max(0, lookAheadSeconds),
      forecastEndLoadMW: currentLoadMW,
      forecastPeakLoadMW: currentLoadMW,
    };
  }
}
