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

  get minimumMW() {
    return this.ratedMW * this.minLoadPU;
  }

  setCommandMW(commandMW) {
    this.commandMW = Math.max(this.minimumMW, Math.min(this.ratedMW, commandMW));
  }

  step(dt) {
    const delta = this.commandMW - this.outputMW;
    const limit = (delta >= 0 ? this.rampUpMWPerS : this.rampDownMWPerS) * dt;
    this.outputMW += Math.max(-limit, Math.min(limit, delta));
    return this.outputMW;
  }
}

export function createDieselFleet(configs) {
  return configs.map((config, index) => new DieselGenerator({ id: config.id ?? `DG-${index + 1}`, ...config }));
}
