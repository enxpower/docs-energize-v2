const DEFAULT_STAGES = Object.freeze([
  Object.freeze({ id: 'UFLS-1', thresholdHz: 59.0, delaySeconds: 0.5, allowCritical: false }),
  Object.freeze({ id: 'UFLS-2', thresholdHz: 58.5, delaySeconds: 0.3, allowCritical: false }),
  Object.freeze({ id: 'UFLS-3', thresholdHz: 58.0, delaySeconds: 0.2, allowCritical: true }),
]);

export class UflsController {
  constructor({ stages = DEFAULT_STAGES, resetHz = 59.8, minimumRestoreDelaySeconds = 300 } = {}) {
    this.stages = [...stages]
      .map((stage, index) => ({
        id: stage.id ?? `UFLS-${index + 1}`,
        thresholdHz: Number(stage.thresholdHz),
        delaySeconds: Math.max(0, Number(stage.delaySeconds) || 0),
        allowCritical: Boolean(stage.allowCritical),
        elapsedSeconds: 0,
        operated: false,
      }))
      .sort((a, b) => b.thresholdHz - a.thresholdHz);
    this.resetHz = resetHz;
    this.minimumRestoreDelaySeconds = Math.max(0, minimumRestoreDelaySeconds);
    this.lastOperationSeconds = -Infinity;
  }

  evaluate({ frequencyHz, residualMW, dtSeconds, load, timeSeconds }) {
    const deficitMW = Math.max(0, -residualMW);
    const events = [];

    for (const stage of this.stages) {
      if (stage.operated) continue;
      const active = frequencyHz <= stage.thresholdHz + 1e-9 && deficitMW > 1e-6;
      stage.elapsedSeconds = active ? stage.elapsedSeconds + dtSeconds : 0;
      if (stage.elapsedSeconds + 1e-9 < stage.delaySeconds) continue;

      const shedBlock = load.shedNextBlock({ allowCritical: stage.allowCritical, timeSeconds });
      stage.operated = true;
      stage.elapsedSeconds = 0;
      this.lastOperationSeconds = timeSeconds;
      events.push({
        timeSeconds,
        type: 'UFLS_STAGE_OPERATED',
        stageId: stage.id,
        thresholdHz: stage.thresholdHz,
        delaySeconds: stage.delaySeconds,
        frequencyHz,
        preShedDeficitMW: deficitMW,
        shedBlockId: shedBlock?.id ?? null,
        shedBlockName: shedBlock?.name ?? null,
        shedMW: shedBlock?.mw ?? 0,
        criticalLoadShed: Boolean(shedBlock?.critical),
        noEligibleLoadBlock: !shedBlock,
      });
    }

    return events;
  }

  canRestore({ frequencyHz, timeSeconds }) {
    return frequencyHz >= this.resetHz
      && timeSeconds - this.lastOperationSeconds >= this.minimumRestoreDelaySeconds;
  }

  resetStages() {
    for (const stage of this.stages) {
      stage.elapsedSeconds = 0;
      stage.operated = false;
    }
  }
}

export { DEFAULT_STAGES as DEFAULT_UFLS_STAGES };
