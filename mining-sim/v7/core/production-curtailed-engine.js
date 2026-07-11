import { ProcessSequencedSimulationEngine } from './process-sequenced-engine.js';

export class ProductionCurtailedSimulationEngine extends ProcessSequencedSimulationEngine {
  constructor({ productionLoadBank, productionCurtailmentController, ...config }) {
    super(config);
    if (!productionLoadBank) throw new Error('ProductionCurtailedSimulationEngine requires productionLoadBank');
    if (!productionCurtailmentController) {
      throw new Error('ProductionCurtailedSimulationEngine requires productionCurtailmentController');
    }
    this.productionLoadBank = productionLoadBank;
    this.productionCurtailmentController = productionCurtailmentController;
    this.productionEventCount = 0;
  }

  recordProductionEvents(events) {
    for (const event of events) {
      this.events.push(event);
      this.productionEventCount += 1;
    }
  }

  step() {
    const sample = super.step();
    const productionEvents = this.productionCurtailmentController.evaluate({
      loadBank: this.productionLoadBank,
      residualMW: sample.residualMW,
      reserve60MW: sample.reserve60MW,
      timeSeconds: sample.timeSeconds,
      dtSeconds: this.dtSeconds,
    });
    this.recordProductionEvents(productionEvents);

    if (productionEvents.length) {
      this.forceSupervisoryReevaluation();
    }

    const snapshot = this.productionCurtailmentController.snapshot(this.productionLoadBank);
    sample.productionEvents = productionEvents;
    sample.productionEventCount = this.productionEventCount;
    sample.productionCurtailment = snapshot;
    sample.productionNormalMW = snapshot.totalNormalMW;
    sample.productionOutputMW = snapshot.totalOutputMW;
    sample.productionCurtailedMW = snapshot.totalCurtailedMW;
    sample.productionLossUnits = snapshot.productionLossUnits;
    return sample;
  }
}
