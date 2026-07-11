const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const firstOrder = (state, target, tauSeconds, dtSeconds) => {
  if (tauSeconds <= 0) return target;
  const alpha = clamp(dtSeconds / tauSeconds, 0, 1);
  return state + (target - state) * alpha;
};

export const DIESEL_STATE = Object.freeze({
  OFF: 'OFF',
  STARTING: 'STARTING',
  WARMUP: 'WARMUP',
  RUNNING: 'RUNNING',
  COOLDOWN: 'COOLDOWN',
  TRIPPED: 'TRIPPED',
});

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
    initialState = DIESEL_STATE.RUNNING,
    startDelaySeconds = 30,
    warmupSeconds = 60,
    cooldownSeconds = 30,
    minRunSeconds = 600,
    minDownSeconds = 300,
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
    this.startDelaySeconds = startDelaySeconds;
    this.warmupSeconds = warmupSeconds;
    this.cooldownSeconds = cooldownSeconds;
    this.minRunSeconds = minRunSeconds;
    this.minDownSeconds = minDownSeconds;

    this.state = initialState;
    this.stateElapsedSeconds = 0;
    this.runTimeSeconds = initialState === DIESEL_STATE.RUNNING ? minRunSeconds : 0;
    this.downTimeSeconds = initialState === DIESEL_STATE.OFF ? minDownSeconds : 0;

    const initialMW = initialState === DIESEL_STATE.RUNNING ? ratedMW * minLoadPU : 0;
    this.emsSetpointMW = initialMW;
    this.governorCommandMW = initialMW;
    this.mechanicalMW = initialMW;
    this.outputMW = initialMW;
  }

  get isOnline() {
    return this.state === DIESEL_STATE.RUNNING;
  }

  get isCommitted() {
    return [DIESEL_STATE.STARTING, DIESEL_STATE.WARMUP, DIESEL_STATE.RUNNING].includes(this.state);
  }

  get isStarting() {
    return this.state === DIESEL_STATE.STARTING || this.state === DIESEL_STATE.WARMUP;
  }

  get isStartable() {
    return this.state === DIESEL_STATE.OFF && this.downTimeSeconds >= this.minDownSeconds;
  }

  get minimumMW() {
    return this.ratedMW * this.minLoadPU;
  }

  get secondsUntilRunning() {
    if (this.state === DIESEL_STATE.RUNNING) return 0;
    if (this.state === DIESEL_STATE.STARTING) {
      return Math.max(0, this.startDelaySeconds - this.stateElapsedSeconds) + this.warmupSeconds;
    }
    if (this.state === DIESEL_STATE.WARMUP) {
      return Math.max(0, this.warmupSeconds - this.stateElapsedSeconds);
    }
    if (this.isStartable) return this.startDelaySeconds + this.warmupSeconds;
    if (this.state === DIESEL_STATE.OFF) {
      return Math.max(0, this.minDownSeconds - this.downTimeSeconds) + this.startDelaySeconds + this.warmupSeconds;
    }
    return Infinity;
  }

  setEmsSetpointMW(commandMW) {
    if (!this.isOnline) {
      this.emsSetpointMW = 0;
      return;
    }
    this.emsSetpointMW = clamp(commandMW, this.minimumMW, this.ratedMW);
  }

  setCommandMW(commandMW) {
    this.setEmsSetpointMW(commandMW);
  }

  requestStart() {
    if (!this.isStartable) return false;
    this.state = DIESEL_STATE.STARTING;
    this.stateElapsedSeconds = 0;
    this.downTimeSeconds = 0;
    return true;
  }

  requestStop() {
    if (!this.isOnline || this.runTimeSeconds < this.minRunSeconds) return false;
    this.state = DIESEL_STATE.COOLDOWN;
    this.stateElapsedSeconds = 0;
    this.emsSetpointMW = 0;
    return true;
  }

  trip() {
    this.state = DIESEL_STATE.TRIPPED;
    this.stateElapsedSeconds = 0;
    this.emsSetpointMW = 0;
    this.governorCommandMW = 0;
    this.mechanicalMW = 0;
    this.outputMW = 0;
  }

  resetTripToOff() {
    if (this.state !== DIESEL_STATE.TRIPPED) return false;
    this.state = DIESEL_STATE.OFF;
    this.stateElapsedSeconds = 0;
    this.downTimeSeconds = 0;
    return true;
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

  advanceStateMachine(dtSeconds) {
    this.stateElapsedSeconds += dtSeconds;

    if (this.state === DIESEL_STATE.OFF) {
      this.downTimeSeconds += dtSeconds;
      return;
    }

    if (this.state === DIESEL_STATE.STARTING && this.stateElapsedSeconds >= this.startDelaySeconds) {
      this.state = DIESEL_STATE.WARMUP;
      this.stateElapsedSeconds = 0;
      return;
    }

    if (this.state === DIESEL_STATE.WARMUP && this.stateElapsedSeconds >= this.warmupSeconds) {
      this.state = DIESEL_STATE.RUNNING;
      this.stateElapsedSeconds = 0;
      this.runTimeSeconds = 0;
      this.emsSetpointMW = this.minimumMW;
      this.governorCommandMW = this.minimumMW;
      this.mechanicalMW = this.minimumMW;
      this.outputMW = this.minimumMW;
      return;
    }

    if (this.state === DIESEL_STATE.RUNNING) {
      this.runTimeSeconds += dtSeconds;
      return;
    }

    if (this.state === DIESEL_STATE.COOLDOWN && this.stateElapsedSeconds >= this.cooldownSeconds) {
      this.state = DIESEL_STATE.OFF;
      this.stateElapsedSeconds = 0;
      this.runTimeSeconds = 0;
      this.downTimeSeconds = 0;
      this.emsSetpointMW = 0;
      this.governorCommandMW = 0;
      this.mechanicalMW = 0;
      this.outputMW = 0;
    }
  }

  step(dtSeconds, { frequencyHz = this.nominalHz } = {}) {
    this.advanceStateMachine(dtSeconds);

    if (!this.isOnline) {
      this.outputMW = 0;
      if (this.state !== DIESEL_STATE.COOLDOWN) {
        this.governorCommandMW = 0;
        this.mechanicalMW = 0;
      }
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
