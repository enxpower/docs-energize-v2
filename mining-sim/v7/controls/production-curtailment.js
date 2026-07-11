export const CURTAILMENT_MODE = Object.freeze({
  NORMAL: 'NORMAL',
  CURTAILED: 'CURTAILED',
  RESTORING: 'RESTORING',
});

export class ProductionCurtailmentController {
  constructor({
    triggerDeficitMW = 0.25,
    restoreSurplusMW = 1.0,
    minimumPostRestoreReserveMW = 0.5,
    restoreDelaySeconds = 30,
    minimumActionIntervalSeconds = 5,
    maximumStepMW = 1.0,
  } = {}) {
    this.triggerDeficitMW = Math.max(0, Number(triggerDeficitMW) || 0);
    this.restoreSurplusMW = Math.max(0, Number(restoreSurplusMW) || 0);
    this.minimumPostRestoreReserveMW = Math.max(0, Number(minimumPostRestoreReserveMW) || 0);
    this.restoreDelaySeconds = Math.max(0, Number(restoreDelaySeconds) || 0);
    this.minimumActionIntervalSeconds = Math.max(0, Number(minimumActionIntervalSeconds) || 0);
    this.maximumStepMW = Math.max(0.01, Number(maximumStepMW) || 1);
    this.mode = CURTAILMENT_MODE.NORMAL;
    this.lastActionSeconds = -Infinity;
    this.surplusStableSinceSeconds = null;
    this.productionLossUnits = 0;
    this.eventCount = 0;
  }

  curtailmentOrder(loadBank) {
    return [...loadBank.loads]
      .filter((load) => !load.safetyCritical && load.availableCurtailmentMW > 1e-9)
      .sort((a, b) => a.priority - b.priority
        || a.productionUnitsPerMWh - b.productionUnitsPerMWh
        || b.availableCurtailmentMW - a.availableCurtailmentMW);
  }

  restorationOrder(loadBank) {
    return [...loadBank.loads]
      .filter((load) => load.availableRestorationMW > 1e-9)
      .sort((a, b) => Number(b.safetyCritical) - Number(a.safetyCritical)
        || b.priority - a.priority
        || b.productionUnitsPerMWh - a.productionUnitsPerMWh
        || a.availableRestorationMW - b.availableRestorationMW);
  }

  evaluate({ loadBank, residualMW, reserve60MW, timeSeconds, dtSeconds = 0 }) {
    this.productionLossUnits += loadBank.loads.reduce(
      (sum, load) => sum + load.curtailedMW * load.productionUnitsPerMWh * Math.max(0, dtSeconds) / 3600,
      0,
    );

    const events = [];
    const deficitMW = Math.max(0, -Number(residualMW || 0));
    const surplusMW = Math.max(0, Number(residualMW || 0));
    const actionAllowed = timeSeconds - this.lastActionSeconds + 1e-9 >= this.minimumActionIntervalSeconds;

    if (deficitMW >= this.triggerDeficitMW && actionAllowed) {
      this.surplusStableSinceSeconds = null;
      let remainingMW = Math.min(deficitMW, this.maximumStepMW);
      for (const load of this.curtailmentOrder(loadBank)) {
        if (remainingMW <= 1e-9) break;
        const reductionMW = Math.min(load.availableCurtailmentMW, remainingMW);
        const previousTargetMW = load.targetMW;
        load.setTargetMW(previousTargetMW - reductionMW, {
          timeSeconds,
          reason: 'POWER_DEFICIT',
        });
        remainingMW -= reductionMW;
        events.push({
          timeSeconds,
          type: 'PRODUCTION_LOAD_CURTAILED',
          loadId: load.id,
          loadName: load.name,
          previousTargetMW,
          targetMW: load.targetMW,
          curtailedMW: previousTargetMW - load.targetMW,
          priority: load.priority,
          safetyCritical: load.safetyCritical,
          deficitMW,
        });
      }
      if (events.length) {
        this.mode = CURTAILMENT_MODE.CURTAILED;
        this.lastActionSeconds = timeSeconds;
        this.eventCount += events.length;
      }
      return events;
    }

    const restoreHeadroomMW = Math.min(surplusMW, Math.max(0, reserve60MW - this.minimumPostRestoreReserveMW));
    let newlyStable = false;
    if (restoreHeadroomMW >= this.restoreSurplusMW) {
      if (this.surplusStableSinceSeconds === null) {
        this.surplusStableSinceSeconds = timeSeconds;
        newlyStable = true;
      }
    } else {
      this.surplusStableSinceSeconds = null;
    }

    const restoreReady = !newlyStable
      && this.surplusStableSinceSeconds !== null
      && timeSeconds - this.surplusStableSinceSeconds + 1e-9 >= this.restoreDelaySeconds
      && actionAllowed;

    if (restoreReady) {
      let remainingMW = Math.min(restoreHeadroomMW, this.maximumStepMW);
      for (const load of this.restorationOrder(loadBank)) {
        if (remainingMW <= 1e-9) break;
        const increaseMW = Math.min(load.availableRestorationMW, remainingMW);
        const previousTargetMW = load.targetMW;
        load.setTargetMW(previousTargetMW + increaseMW, {
          timeSeconds,
          reason: 'POWER_RECOVERED',
        });
        remainingMW -= increaseMW;
        events.push({
          timeSeconds,
          type: 'PRODUCTION_LOAD_RESTORED',
          loadId: load.id,
          loadName: load.name,
          previousTargetMW,
          targetMW: load.targetMW,
          restoredMW: load.targetMW - previousTargetMW,
          priority: load.priority,
          safetyCritical: load.safetyCritical,
          reserve60MW,
        });
      }
      if (events.length) {
        this.mode = loadBank.curtailedMW > 1e-9
          ? CURTAILMENT_MODE.RESTORING
          : CURTAILMENT_MODE.NORMAL;
        this.lastActionSeconds = timeSeconds;
        this.surplusStableSinceSeconds = timeSeconds;
        this.eventCount += events.length;
      }
    }

    if (loadBank.curtailedMW <= 1e-9) this.mode = CURTAILMENT_MODE.NORMAL;
    return events;
  }

  snapshot(loadBank) {
    return {
      mode: this.mode,
      totalNormalMW: loadBank.normalMW,
      totalOutputMW: loadBank.outputMW,
      totalCurtailedMW: loadBank.curtailedMW,
      productionLossUnits: this.productionLossUnits,
      lastActionSeconds: this.lastActionSeconds,
      surplusStableSinceSeconds: this.surplusStableSinceSeconds,
      eventCount: this.eventCount,
      loads: loadBank.snapshot(),
    };
  }
}
