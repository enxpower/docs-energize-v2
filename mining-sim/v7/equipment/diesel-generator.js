const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const firstOrder = (state, target, tauSeconds, dtSeconds) => {
  if (tauSeconds <= 0) return target;
  const alpha = clamp(dtSeconds / tauSeconds, 0, 1);
  return state + (target - state) * alpha;
};

export class DieselGenerator {
  constructor({
    id,
    ratedMW,
    minLoadPU = 0.35,
    rampUpMWPerS = 0.2,
    rampDownMWPerS = 1.0,
    inertiaSeconds = 4.0,
    droopPU = 0.04,
    governorTimeConstantSeconds = 0.8,
    engineTimeConstantSeconds = 1.8,
    frequencyDeadbandHz = 0.025,
    nominalHz = 60,
  }) {
    this.id = id;
    this.ratedMW = ratedMW;
    this.minLoadPU = minLoadPU;
    this.rampUpMWPerS = rampUpMWPerS;
    this.rampDownMWPerS = rampDownMWPerS;
    this.inertiaSeconds = inertiaSeconds;
    this.droopPU = droopPU;
    this.governorTimeConstantSeconds = governorTimeConstantSeconds;
    this.engineTimeConstantSeconds = engineTimeConstantSeconds;
    this.frequencyDeadbandHz = frequencyDeadbandHz;
    this.nominalHz = nominalHz;
    this.state = 'RUNNING';

    const initialMW = ratedMW * minLoadPU;
    this.emsSetpointMW = initialMW;
    this.governorCommandMW = initialMW;
    this.mechanicalMW = initialMW;
    this.outputMW = initialMW;
  }

  get isOnline() {
    return this.state === 'RUNNING';
  }

  get minimumMW() {
    return this.ratedMW * this.minLoadPU;
  }

  setEmsSetpointMW(commandMW) {
    if (!this.isOnline) {
      this.emsSetpointMW = 0;
      return;
    }
    this.emsSetpointMW = clamp(commandMW, this.minimumMW, this.ratedMW);
  }

  // Backward-compatible alias while V7 modules migrate to the explicit EMS naming.
  setCommandMW(commandMW) {
    this.setEmsSetpointMW(commandMW);
  }

  trip() {
    this.state = 'TRIPPED';
    this.emsSetpointMW = 0;
    this.governorCommandMW = 0;
    this.mechanicalMW = 0;
    this.outputMW = 0;
  }

  governorDroopBiasMW(frequencyHz) {
    if (!this.isOnline) return 0;
    const rawDf = frequencyHz - this.nominalHz;
    const activeDf = Math.abs(rawDf) <= this.frequencyDeadbandHz
      ? 0
      : rawDf - Math.sign(rawDf) * this.frequencyDeadbandHz;
    const fullDroopHz = Math.max(0.01, this.droopPU * this.nominalHz);
    return clamp((-activeDf / fullDroopHz) * this.ratedMW, -0.20 * this.ratedMW, 0.20 * this.ratedMW);
  }

  step(dtSeconds, { frequencyHz = this.nominalHz } = {}) {
    if (!this.isOnline) {
      this.outputMW = 0;
      return 0;
    }

    const primaryBiasMW = this.governorDroopBiasMW(frequencyHz);
    const governorTargetMW = clamp(
      this.emsSetpointMW + primaryBiasMW,
      this.minimumMW,
      this.ratedMW,
    );

    this.governorCommandMW = firstOrder(
      this.governorCommandMW,
      governorTargetMW,
      this.governorTimeConstantSeconds,
      dtSeconds,
    );
    this.mechanicalMW = firstOrder(
      this.mechanicalMW,
      this.governorCommandMW,
      this.engineTimeConstantSeconds,
      dtSeconds,
    );

    const delta = this.mechanicalMW - this.outputMW;
    const limit = (delta >= 0 ? this.rampUpMWPerS : this.rampDownMWPerS) * dtSeconds;
    this.outputMW += clamp(delta, -limit, limit);
    this.outputMW = clamp(this.outputMW, this.minimumMW, this.ratedMW);
    return this.outputMW;
  }
}

export function createDieselFleet(configs) {
  return configs.map((config, index) => new DieselGenerator({ id: config.id ?? `DG-${index + 1}`, ...config }));
}
