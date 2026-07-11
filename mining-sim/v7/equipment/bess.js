export const BESS_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  TRIPPED: 'TRIPPED',
});

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
    this.state = BESS_STATE.AVAILABLE;
  }

  get soc() {
    return this.energyMWh > 0 ? this.energyMWhStored / this.energyMWh : 0;
  }

  get isAvailable() {
    return this.state === BESS_STATE.AVAILABLE;
  }

  availableDischargeMW() {
    if (!this.isAvailable || this.energyMWh <= 0 || this.soc <= this.minSoc) return 0;
    return this.powerMW;
  }

  availableChargeMW() {
    if (!this.isAvailable || this.energyMWh <= 0 || this.soc >= this.maxSoc) return 0;
    return this.powerMW;
  }

  setCommandMW(commandMW) {
    if (!this.isAvailable) {
      this.commandMW = 0;
      return;
    }
    this.commandMW = Math.max(-this.availableChargeMW(), Math.min(this.availableDischargeMW(), commandMW));
  }

  trip() {
    const preTripMW = this.outputMW;
    this.state = BESS_STATE.TRIPPED;
    this.commandMW = 0;
    this.outputMW = 0;
    return preTripMW;
  }

  restore() {
    this.state = BESS_STATE.AVAILABLE;
    this.commandMW = 0;
    this.outputMW = 0;
  }

  step(dtSeconds) {
    if (!this.isAvailable) {
      this.commandMW = 0;
      this.outputMW = 0;
      return 0;
    }

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