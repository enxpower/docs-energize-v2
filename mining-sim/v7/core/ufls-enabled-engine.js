import { SimulationEngine } from './simulation-engine.js';
import { UflsController } from '../controls/ufls.js';

export class UflsEnabledSimulationEngine extends SimulationEngine {
  constructor({ uflsController = new UflsController(), ...config }) {
    super(config);
    this.uflsController = uflsController;
    this.eensMWh = 0;
    this.uflsOperationCount = 0;
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

    sample.demandMW = demandMW;
    sample.connectedLoadMW = sample.loadMW;
    sample.servedLoadMW = sample.loadMW;
    sample.shedLoadMW = shedLoadMW;
    sample.eensMWh = this.eensMWh;
    sample.uflsOperationCount = this.uflsOperationCount;
    sample.uflsEvents = uflsEvents;
    sample.loadBlocks = this.load.shedBlocks?.map((block) => ({
      id: block.id,
      name: block.name,
      mw: block.mw,
      priority: block.priority,
      critical: block.critical,
      shed: block.shed,
    })) ?? [];
    sample.loadRestorePermitted = this.uflsController?.canRestore({
      frequencyHz: sample.frequencyHz,
      timeSeconds: sample.timeSeconds,
    }) ?? false;

    return sample;
  }
}
