import { SimulationEngine } from './simulation-engine.js';
import { UflsController } from '../controls/ufls.js';
import { LoadRestorationController } from '../controls/load-restoration.js';

export class UflsEnabledSimulationEngine extends SimulationEngine {
  constructor({
    uflsController = new UflsController(),
    restorationController = new LoadRestorationController(),
    restorationEnabled = true,
    ...config
  }) {
    super(config);
    this.uflsController = uflsController;
    this.restorationController = restorationController;
    this.restorationEnabled = restorationEnabled;
    this.eensMWh = 0;
    this.uflsOperationCount = 0;
    this.loadRestoreCount = 0;
    this.loadRestoreRollbackCount = 0;
  }

  step() {
    const demandMW = this.load.demandMW ?? this.load.commandMW ?? 0;
    const sample = super.step();
    const shedLoadMW = this.load.shedMW ?? Math.max(0, demandMW - sample.loadMW);

    this.eensMWh += shedLoadMW * this.dtSeconds / 3600;

    const uflsEvents = this.uflsController?.evaluate({
      frequencyHz: sample.frequencyHz,
      residualMW: sample.residualMW,
      dtSeconds: this.dtSeconds,
      load: this.load,
      timeSeconds: sample.timeSeconds,
    }) ?? [];

    for (const event of uflsEvents) {
      this.events.push(event);
      this.uflsOperationCount += 1;
      this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
      this.nextCommitmentEvaluationSeconds = Math.min(this.nextCommitmentEvaluationSeconds, this.timeSeconds);
    }

    const restorationPermitted = this.restorationEnabled
      && uflsEvents.length === 0
      && (this.uflsController?.canRestore({
        frequencyHz: sample.frequencyHz,
        timeSeconds: sample.timeSeconds,
      }) ?? false);

    const restorationEvents = this.restorationController?.evaluate({
      frequencyHz: sample.frequencyHz,
      residualMW: sample.residualMW,
      reserve60MW: sample.reserve60MW,
      dtSeconds: this.dtSeconds,
      load: this.load,
      timeSeconds: sample.timeSeconds,
      restorationPermitted,
    }) ?? [];

    for (const event of restorationEvents) {
      this.events.push(event);
      if (event.type === 'LOAD_BLOCK_RESTORED') this.loadRestoreCount += 1;
      if (event.type === 'LOAD_RESTORATION_ROLLBACK') this.loadRestoreRollbackCount += 1;
      this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
      this.nextCommitmentEvaluationSeconds = Math.min(this.nextCommitmentEvaluationSeconds, this.timeSeconds);
    }

    sample.demandMW = demandMW;
    sample.connectedLoadMW = sample.loadMW;
    sample.servedLoadMW = sample.loadMW;
    sample.shedLoadMW = shedLoadMW;
    sample.coldLoadPickupMW = this.load.coldLoadPickupMW ?? 0;
    sample.eensMWh = this.eensMWh;
    sample.uflsOperationCount = this.uflsOperationCount;
    sample.uflsEvents = uflsEvents;
    sample.loadRestorationEvents = restorationEvents;
    sample.loadRestoreCount = this.loadRestoreCount;
    sample.loadRestoreRollbackCount = this.loadRestoreRollbackCount;
    sample.loadBlocks = this.load.shedBlocks?.map((block) => ({
      id: block.id,
      name: block.name,
      mw: block.mw,
      priority: block.priority,
      critical: block.critical,
      shed: block.shed,
      coldLoadPickupPU: block.coldLoadPickupPU,
      coldLoadPickupSeconds: block.coldLoadPickupSeconds,
      currentColdPickupMW: this.load.coldPickupForBlockMW?.(block) ?? 0,
    })) ?? [];
    sample.loadRestorePermitted = restorationPermitted;
    sample.loadRestoreStableSeconds = this.restorationController?.stableElapsedSeconds ?? 0;
    sample.loadRestoreLockoutUntilSeconds = this.restorationController?.lockoutUntilSeconds ?? null;
    sample.loadRestorePendingObservation = this.restorationController?.pendingObservation ?? null;

    return sample;
  }
}
