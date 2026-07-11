export class Bess {
  constructor({ powerMW, energyMWh, initialSoc = 0.6, minSoc = 0.18, maxSoc = 0.82, roundTripEfficiency = 0.965, rampMWPerS = null }) {
    this.powerMW = powerMW;
    this.energyMWh = energyMWh;
    this.minSoc = minSoc;
    this.maxSoc = maxSoc;
    this.eta = Math.sqrt(roundTripEfficiency);
    this.rampMWPerS = rampMWPerS ?? powerMW;
    this.energyMWhStored = energyMWh * initialSoc;
    this.commandMW = 0;
    this.outputMW = 0;
  }

  get soc() {
    return this.energyMWh > 0 ? this.energyMWhStored / this.energyMWh : 0;
  }

  availableDischargeMW() {
    if (this.energyMWh <= 0 || this.soc <= this.minSoc) return 0;
    return this.powerMW;
  }

  availableChargeMW() {
    if (this.energyMWh <= 0 || this.soc >= this.maxSoc) return 0;
    return this.powerMW;
  }

  setCommandMW(commandMW) {
    this.commandMW = Math.max(-this.availableChargeMW(), Math.min(this.availableDischargeMW(), commandMW));
  }

  step(dtSeconds) {
    const delta = this.commandMW - this.outputMW;
    const limit = this.rampMWPerS * dtSeconds;
    this.outputMW += Math.max(-limit, Math.min(limit, delta));

    const deltaHours = dtSeconds / 3600;
    if (this.outputMW >= 0) {
      this.energyMWhStored -= (this.outputMW / this.eta) * deltaHours;
    } else {
      this.energyMWhStored -= (this.outputMW * this.eta) * deltaHours;
    }

    this.energyMWhStored = Math.max(0, Math.min(this.energyMWh, this.energyMWhStored));
    return this.outputMW;
  }
}
