export const BESS_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  TRIPPED: 'TRIPPED',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class Bess {
  constructor({
    powerMW,
    energyMWh,
    initialSoc = 0.6,
    minSoc = 0.18,
    maxSoc = 0.82,
    roundTripEfficiency = 0.965,
    rampMWPerS = null,
    lowSocDeratingBand = 0.12,
    highSocDeratingBand = 0.12,
  }) {
    this.powerMW = powerMW;
    this.energyMWh = energyMWh;
    this.minSoc = minSoc;
    this.maxSoc = maxSoc;
    this.eta = Math.sqrt(roundTripEfficiency);
    this.rampMWPerS = rampMWPerS ?? powerMW;
    this.lowSocDeratingBand = Math.max(0.01, lowSocDeratingBand);
    this.highSocDeratingBand = Math.max(0.01, highSocDeratingBand);
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

  dischargePowerFactor() {
    if (!this.isAvailable || this.energyMWh <= 0 || this.soc <= this.minSoc) return 0;
    return clamp((this.soc - this.minSoc) / this.lowSocDeratingBand, 0, 1);
  }

  chargePowerFactor() {
    if (!this.isAvailable || this.energyMWh <= 0 || this.soc >= this.maxSoc) return 0;
    return clamp((this.maxSoc - this.soc) / this.highSocDeratingBand, 0, 1);
  }

  availableDischargeMW() {
    return this.powerMW * this.dischargePowerFactor();
  }

  availableChargeMW() {
    return this.powerMW * this.chargePowerFactor();
  }

  usableDischargeEnergyMWh() {
    if (!this.isAvailable || this.energyMWh <= 0) return 0;
    return Math.max(0, this.energyMWhStored - this.energyMWh * this.minSoc) * this.eta;
  }

  minimumSocForSupportMW(requestedMW) {
    if (requestedMW <= 0) return this.minSoc;
    if (requestedMW > this.powerMW) return Infinity;
    const requiredPowerFactor = requestedMW / Math.max(this.powerMW, 1e-9);
    return this.minSoc + this.lowSocDeratingBand * requiredPowerFactor;
  }

  supportDurationMinutes(requestedMW) {
    if (!this.isAvailable || requestedMW <= 0 || this.energyMWh <= 0) return 0;
    if (requestedMW > this.availableDischargeMW()) return 0;
    const terminalSoc = Math.max(this.minSoc, this.minimumSocForSupportMW(requestedMW));
    const usableStoredMWh = Math.max(0, this.energyMWhStored - this.energyMWh * terminalSoc);
    const usableDeliveredMWh = usableStoredMWh * this.eta;
    return (usableDeliveredMWh / requestedMW) * 60;
  }

  dischargeDurationMinutes(requestedMW = this.availableDischargeMW()) {
    return this.supportDurationMinutes(requestedMW);
  }

  sustainableDischargeMW(durationMinutes) {
    if (!this.isAvailable || durationMinutes <= 0) return this.availableDischargeMW();
    let low = 0;
    let high = this.availableDischargeMW();
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      if (mid <= 1e-9 || this.supportDurationMinutes(mid) + 1e-9 >= durationMinutes) low = mid;
      else high = mid;
    }
    return low;
  }

  setCommandMW(commandMW) {
    if (!this.isAvailable) {
      this.commandMW = 0;
      return;
    }
    this.commandMW = clamp(commandMW, -this.availableChargeMW(), this.availableDischargeMW());
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

    this.commandMW = clamp(this.commandMW, -this.availableChargeMW(), this.availableDischargeMW());
    const delta = this.commandMW - this.outputMW;
    const limit = this.rampMWPerS * dtSeconds;
    this.outputMW += clamp(delta, -limit, limit);

    const deltaHours = dtSeconds / 3600;
    if (this.outputMW >= 0) {
      this.energyMWhStored -= (this.outputMW / this.eta) * deltaHours;
    } else {
      this.energyMWhStored -= (this.outputMW * this.eta) * deltaHours;
    }

    this.energyMWhStored = clamp(
      this.energyMWhStored,
      this.energyMWh * this.minSoc,
      this.energyMWh * this.maxSoc,
    );
    return this.outputMW;
  }
}
