export class DieselGenerator {
  constructor({ id, ratedMW, minLoadPU = 0.35, rampUpMWPerS = 0.2, rampDownMWPerS = 1.0, inertiaSeconds = 4.0 }) {
    this.id = id;
    this.ratedMW = ratedMW;
    this.minLoadPU = minLoadPU;
    this.rampUpMWPerS = rampUpMWPerS;
    this.rampDownMWPerS = rampDownMWPerS;
    this.inertiaSeconds = inertiaSeconds;
    this.state = 'RUNNING';
    this.commandMW = ratedMW * minLoadPU;
    this.outputMW = this.commandMW;
  }

  get isOnline() {
    return this.state === 'RUNNING';
  }

  get minimumMW() {
    return this.ratedMW * this.minLoadPU;
  }

  setCommandMW(commandMW) {
    if (!this.isOnline) {
      this.commandMW = 0;
      return;
    }
    this.commandMW = Math.max(this.minimumMW, Math.min(this.ratedMW, commandMW));
  }

  trip() {
    this.state = 'TRIPPED';
    this.commandMW = 0;
    this.outputMW = 0;
  }

  step(dt) {
    if (!this.isOnline) {
      this.outputMW = 0;
      return 0;
    }
    const delta = this.commandMW - this.outputMW;
    const limit = (delta >= 0 ? this.rampUpMWPerS : this.rampDownMWPerS) * dt;
    this.outputMW += Math.max(-limit, Math.min(limit, delta));
    return this.outputMW;
  }
}

export function createDieselFleet(configs) {
  return configs.map((config, index) => new DieselGenerator({ id: config.id ?? `DG-${index + 1}`, ...config }));
}
