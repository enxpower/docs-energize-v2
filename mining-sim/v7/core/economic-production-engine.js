import { ProductionCurtailedSimulationEngine } from './production-curtailed-engine.js';

export class EconomicProductionSimulationEngine extends ProductionCurtailedSimulationEngine {
  constructor({ productionEconomicsTracker, ...config }) {
    super(config);
    if (!productionEconomicsTracker) {
      throw new Error('EconomicProductionSimulationEngine requires productionEconomicsTracker');
    }
    this.productionEconomicsTracker = productionEconomicsTracker;
  }

  step() {
    const sample = super.step();
    const economics = this.productionEconomicsTracker.step({
      sample,
      dtSeconds: this.dtSeconds,
    });

    sample.productionEconomics = economics;
    sample.productionThroughputTPH = economics.throughputTPH;
    sample.productionDeferredThroughputTPH = economics.deferredThroughputTPH;
    sample.actualProductionTons = economics.actualProductionTons;
    sample.deferredProductionTons = economics.deferredProductionTons;
    sample.dieselFuelLiters = economics.dieselFuelLiters;
    sample.dieselFuelCost = economics.dieselFuelCost;
    sample.productionGrossValue = economics.productionGrossValue;
    sample.deferredProductionValue = economics.deferredProductionValue;
    sample.bessEstimatedAvoidedFuelCost = economics.bessEstimatedAvoidedFuelCost;
    return sample;
  }
}
