const nonNegative = (value) => Math.max(0, Number(value) || 0);

export class ProductionEconomicsTracker {
  constructor({
    productionLoadBank,
    dieselFuelCurves = {},
    fuelPricePerLiter = 0,
    productValuePerTon = 0,
    bessMarginalFuelLitersPerMWh = 0,
  } = {}) {
    if (!productionLoadBank) throw new Error('ProductionEconomicsTracker requires productionLoadBank');
    this.productionLoadBank = productionLoadBank;
    this.dieselFuelCurves = { ...dieselFuelCurves };
    this.fuelPricePerLiter = nonNegative(fuelPricePerLiter);
    this.productValuePerTon = nonNegative(productValuePerTon);
    this.bessMarginalFuelLitersPerMWh = nonNegative(bessMarginalFuelLitersPerMWh);

    this.actualProductionTons = 0;
    this.potentialProductionTons = 0;
    this.deferredProductionTons = 0;
    this.dieselFuelLiters = 0;
    this.dieselFuelCost = 0;
    this.productionGrossValue = 0;
    this.deferredProductionValue = 0;
    this.bessDischargeMWh = 0;
    this.bessChargeMWh = 0;
    this.bessEstimatedAvoidedFuelLiters = 0;
    this.bessEstimatedAvoidedFuelCost = 0;
  }

  curveFor(dieselId) {
    const curve = this.dieselFuelCurves[dieselId] ?? this.dieselFuelCurves.default ?? {};
    return {
      idleLitersPerHour: nonNegative(curve.idleLitersPerHour),
      incrementalLitersPerMWh: nonNegative(curve.incrementalLitersPerMWh),
    };
  }

  step({ sample, dtSeconds }) {
    const dtHours = nonNegative(dtSeconds) / 3600;
    const actualTons = this.productionLoadBank.throughputTPH * dtHours;
    const potentialTons = this.productionLoadBank.normalThroughputTPH * dtHours;
    const deferredTons = Math.max(0, potentialTons - actualTons);

    this.actualProductionTons += actualTons;
    this.potentialProductionTons += potentialTons;
    this.deferredProductionTons += deferredTons;
    this.productionGrossValue += actualTons * this.productValuePerTon;
    this.deferredProductionValue += deferredTons * this.productValuePerTon;

    let fuelLiters = 0;
    for (const diesel of sample.dieselStates ?? []) {
      if (diesel.state !== 'RUNNING') continue;
      const curve = this.curveFor(diesel.id);
      fuelLiters += (
        curve.idleLitersPerHour
        + nonNegative(diesel.outputMW) * curve.incrementalLitersPerMWh
      ) * dtHours;
    }
    this.dieselFuelLiters += fuelLiters;
    this.dieselFuelCost += fuelLiters * this.fuelPricePerLiter;

    const bessMW = Number(sample.bessMW) || 0;
    if (bessMW > 0) {
      const dischargeMWh = bessMW * dtHours;
      const avoidedLiters = dischargeMWh * this.bessMarginalFuelLitersPerMWh;
      this.bessDischargeMWh += dischargeMWh;
      this.bessEstimatedAvoidedFuelLiters += avoidedLiters;
      this.bessEstimatedAvoidedFuelCost += avoidedLiters * this.fuelPricePerLiter;
    } else if (bessMW < 0) {
      this.bessChargeMWh += -bessMW * dtHours;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      throughputTPH: this.productionLoadBank.throughputTPH,
      normalThroughputTPH: this.productionLoadBank.normalThroughputTPH,
      deferredThroughputTPH: this.productionLoadBank.deferredThroughputTPH,
      actualProductionTons: this.actualProductionTons,
      potentialProductionTons: this.potentialProductionTons,
      deferredProductionTons: this.deferredProductionTons,
      productValuePerTon: this.productValuePerTon,
      productionGrossValue: this.productionGrossValue,
      deferredProductionValue: this.deferredProductionValue,
      dieselFuelLiters: this.dieselFuelLiters,
      fuelPricePerLiter: this.fuelPricePerLiter,
      dieselFuelCost: this.dieselFuelCost,
      bessDischargeMWh: this.bessDischargeMWh,
      bessChargeMWh: this.bessChargeMWh,
      bessEstimatedAvoidedFuelLiters: this.bessEstimatedAvoidedFuelLiters,
      bessEstimatedAvoidedFuelCost: this.bessEstimatedAvoidedFuelCost,
      operatingContributionBeforeOtherCosts: this.productionGrossValue - this.dieselFuelCost,
      assumptions: {
        throughputModel: 'PER_LOAD_POWER_LAW',
        bessValueMethod: 'ESTIMATED_DIESEL_FUEL_DISPLACEMENT_ONLY',
      },
    };
  }
}
