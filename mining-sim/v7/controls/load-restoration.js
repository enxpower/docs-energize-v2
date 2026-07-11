const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class LoadRestorationController {
  constructor({
    restoreFrequencyHz = 59.9,
    maximumDeficitMW = 0.05,
    stableHoldSeconds = 30,
    minimumRestoreIntervalSeconds = 60,
    maximumRestoreBlockMW = 2.0,
    minimumPostRestoreReserveMW = 0.5,
    rollbackFrequencyHz = 59.4,
    rollbackObservationSeconds = 20,
    rollbackLockoutSeconds = 120,
  } = {}) {
    this.restoreFrequencyHz = restoreFrequencyHz;
    this.maximumDeficitMW = Math.max(0, maximumDeficitMW);
    this.stableHoldSeconds = Math.max(0, stableHoldSeconds);
    this.minimumRestoreIntervalSeconds = Math.max(0, minimumRestoreIntervalSeconds);
    this.maximumRestoreBlockMW = Math.max(0, maximumRestoreBlockMW);
    this.minimumPostRestoreReserveMW = Math.max(0, minimumPostRestoreReserveMW);
    this.rollbackFrequencyHz = rollbackFrequencyHz;
    this.rollbackObservationSeconds = Math.max(0, rollbackObservationSeconds);
    this.rollbackLockoutSeconds = Math.max(0, rollbackLockoutSeconds);

    this.stableElapsedSeconds = 0;
    this.lastRestoreSeconds = -Infinity;
    this.lockoutUntilSeconds = -Infinity;
    this.pendingObservation = null;
    this.restoreCount = 0;
    this.rollbackCount = 0;
  }

  candidateBlocks(load) {
    return [...(load.restorableBlocks ?? [])]
      .sort((a, b) => Number(b.critical) - Number(a.critical)
        || b.priority - a.priority
        || a.mw - b.mw);
  }

  estimatedPickupMW(block) {
    return block.mw * (1 + Math.max(0, block.coldLoadPickupPU ?? 0));
  }

  updateStableTimer({ frequencyHz, residualMW, dtSeconds }) {
    const deficitMW = Math.max(0, -residualMW);
    const stable = frequencyHz >= this.restoreFrequencyHz
      && deficitMW <= this.maximumDeficitMW;
    this.stableElapsedSeconds = stable
      ? this.stableElapsedSeconds + Math.max(0, dtSeconds)
      : 0;
    return stable;
  }

  evaluateRollback({ frequencyHz, load, timeSeconds }) {
    if (!this.pendingObservation) return null;
    const elapsed = timeSeconds - this.pendingObservation.restoredAtSeconds;
    if (elapsed > this.rollbackObservationSeconds) {
      this.pendingObservation = null;
      return null;
    }
    if (frequencyHz >= this.rollbackFrequencyHz) return null;

    const block = load.shedBlock(this.pendingObservation.blockId, timeSeconds);
    if (!block) {
      this.pendingObservation = null;
      return null;
    }

    this.rollbackCount += 1;
    this.lockoutUntilSeconds = timeSeconds + this.rollbackLockoutSeconds;
    this.stableElapsedSeconds = 0;
    const event = {
      timeSeconds,
      type: 'LOAD_RESTORATION_ROLLBACK',
      blockId: block.id,
      blockName: block.name,
      blockMW: block.mw,
      frequencyHz,
      rollbackFrequencyHz: this.rollbackFrequencyHz,
      lockoutUntilSeconds: this.lockoutUntilSeconds,
      rollbackCount: this.rollbackCount,
    };
    this.pendingObservation = null;
    return event;
  }

  evaluate({
    frequencyHz,
    residualMW,
    reserve60MW,
    dtSeconds,
    load,
    timeSeconds,
    restorationPermitted = true,
  }) {
    const events = [];
    const rollback = this.evaluateRollback({ frequencyHz, load, timeSeconds });
    if (rollback) {
      events.push(rollback);
      return events;
    }

    this.updateStableTimer({ frequencyHz, residualMW, dtSeconds });
    if (!restorationPermitted) return events;
    if (timeSeconds < this.lockoutUntilSeconds) return events;
    if (this.pendingObservation) return events;
    if (this.stableElapsedSeconds + 1e-9 < this.stableHoldSeconds) return events;
    if (timeSeconds - this.lastRestoreSeconds + 1e-9 < this.minimumRestoreIntervalSeconds) return events;

    const reserve = Math.max(0, Number(reserve60MW) || 0);
    const candidate = this.candidateBlocks(load).find((block) => {
      const pickupMW = this.estimatedPickupMW(block);
      return block.mw <= this.maximumRestoreBlockMW + 1e-9
        && reserve - pickupMW >= this.minimumPostRestoreReserveMW - 1e-9;
    });

    if (!candidate) return events;

    const preRestoreShedMW = load.shedMW;
    const restored = load.restoreBlock(candidate.id, timeSeconds);
    if (!restored) return events;

    const estimatedPickupMW = this.estimatedPickupMW(restored);
    this.lastRestoreSeconds = timeSeconds;
    this.restoreCount += 1;
    this.stableElapsedSeconds = 0;
    this.pendingObservation = {
      blockId: restored.id,
      restoredAtSeconds: timeSeconds,
    };

    events.push({
      timeSeconds,
      type: 'LOAD_BLOCK_RESTORED',
      blockId: restored.id,
      blockName: restored.name,
      blockMW: restored.mw,
      critical: restored.critical,
      coldPickupInitialMW: restored.coldPickupInitialMW,
      estimatedPickupMW,
      reserve60MWBeforeRestore: reserve,
      estimatedPostRestoreReserveMW: clamp(reserve - estimatedPickupMW, 0, reserve),
      preRestoreShedMW,
      postRestoreShedMW: load.shedMW,
      observationUntilSeconds: timeSeconds + this.rollbackObservationSeconds,
      restoreCount: this.restoreCount,
    });

    return events;
  }
}
