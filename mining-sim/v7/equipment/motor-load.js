const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const MOTOR_STATE = Object.freeze({
  OFF: 'OFF',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
});

export const MOTOR_START_MODE = Object.freeze({
  DOL: 'DOL',
  SOFT_STARTER: 'SOFT_STARTER',
  VFD: 'VFD',
});

const DEFAULT_PROFILES = Object.freeze({
  DOL: Object.freeze({ startPowerPU: 2.5, accelerationSeconds: 8 }),
  SOFT_STARTER: Object.freeze({ startPowerPU: 1.6, accelerationSeconds: 15 }),
  VFD: Object.freeze({ startPowerPU: 1.1, accelerationSeconds: 20 }),
});

export class MotorLoad {
  constructor({
    id,
    name = id,
    ratedMW,
    startMode = MOTOR_START_MODE.VFD,
    startPowerPU = null,
    accelerationSeconds = null,
    minimumOffSeconds = 30,
    abortFrequencyHz = 57.5,
    abortDelaySeconds = 0.2,
    initialState = MOTOR_STATE.OFF,
  }) {
    if (!id) throw new Error('MotorLoad requires an id');
    this.id = id;
    this.name = name;
    this.ratedMW = Math.max(0, Number(ratedMW) || 0);
    this.startMode = Object.values(MOTOR_START_MODE).includes(startMode) ? startMode : MOTOR_START_MODE.VFD;
    const profile = DEFAULT_PROFILES[this.startMode];
    this.startPowerPU = Math.max(1, Number(startPowerPU ?? profile.startPowerPU) || 1);
    this.accelerationSeconds = Math.max(0.1, Number(accelerationSeconds ?? profile.accelerationSeconds) || 0.1);
    this.minimumOffSeconds = Math.max(0, Number(minimumOffSeconds) || 0);
    this.abortFrequencyHz = Number(abortFrequencyHz);
    this.abortDelaySeconds = Math.max(0, Number(abortDelaySeconds) || 0);

    this.state = initialState;
    this.stateElapsedSeconds = 0;
    this.offTimeSeconds = initialState === MOTOR_STATE.OFF ? this.minimumOffSeconds : 0;
    this.lowFrequencyElapsedSeconds = 0;
    this.outputMW = initialState === MOTOR_STATE.RUNNING ? this.ratedMW : 0;
    this.lastStartSeconds = null;
    this.lastFailureReason = null;
  }

  get isRunning() { return this.state === MOTOR_STATE.RUNNING; }
  get isStarting() { return this.state === MOTOR_STATE.STARTING; }
  get isStartable() { return this.state === MOTOR_STATE.OFF && this.offTimeSeconds >= this.minimumOffSeconds; }

  get initialPickupMW() {
    return this.ratedMW * this.startPowerPU;
  }

  requestStart(timeSeconds = null) {
    if (!this.isStartable) return false;
    this.state = MOTOR_STATE.STARTING;
    this.stateElapsedSeconds = 0;
    this.lowFrequencyElapsedSeconds = 0;
    this.outputMW = this.initialPickupMW;
    this.lastStartSeconds = timeSeconds;
    this.lastFailureReason = null;
    return true;
  }

  stop() {
    this.state = MOTOR_STATE.OFF;
    this.stateElapsedSeconds = 0;
    this.offTimeSeconds = 0;
    this.lowFrequencyElapsedSeconds = 0;
    this.outputMW = 0;
  }

  resetFailure() {
    if (this.state !== MOTOR_STATE.FAILED) return false;
    this.stop();
    return true;
  }

  fail(reason) {
    this.state = MOTOR_STATE.FAILED;
    this.stateElapsedSeconds = 0;
    this.lowFrequencyElapsedSeconds = 0;
    this.outputMW = 0;
    this.lastFailureReason = reason;
  }

  step(dtSeconds, { frequencyHz = 60 } = {}) {
    const dt = Math.max(0, Number(dtSeconds) || 0);

    if (this.state === MOTOR_STATE.OFF) {
      this.offTimeSeconds += dt;
      this.outputMW = 0;
      return this.outputMW;
    }
    if (this.state === MOTOR_STATE.FAILED) {
      this.outputMW = 0;
      return this.outputMW;
    }
    if (this.state === MOTOR_STATE.RUNNING) {
      this.outputMW = this.ratedMW;
      return this.outputMW;
    }

    this.stateElapsedSeconds += dt;
    const lowFrequency = Number.isFinite(frequencyHz) && frequencyHz < this.abortFrequencyHz;
    this.lowFrequencyElapsedSeconds = lowFrequency ? this.lowFrequencyElapsedSeconds + dt : 0;
    if (this.lowFrequencyElapsedSeconds + 1e-9 >= this.abortDelaySeconds) {
      this.fail('LOW_FREQUENCY_DURING_START');
      return this.outputMW;
    }

    const progress = clamp(this.stateElapsedSeconds / this.accelerationSeconds, 0, 1);
    this.outputMW = this.ratedMW * (this.startPowerPU - (this.startPowerPU - 1) * progress);
    if (progress >= 1 - 1e-9) {
      this.state = MOTOR_STATE.RUNNING;
      this.outputMW = this.ratedMW;
    }
    return this.outputMW;
  }
}

export class MotorLoadBank {
  constructor({ motors = [] } = {}) {
    this.motors = motors.map((motor) => motor instanceof MotorLoad ? motor : new MotorLoad(motor));
    this.outputMW = this.motors.reduce((sum, motor) => sum + motor.outputMW, 0);
  }

  get startingCount() { return this.motors.filter((motor) => motor.isStarting).length; }
  get runningCount() { return this.motors.filter((motor) => motor.isRunning).length; }

  step(dtSeconds, context = {}) {
    this.outputMW = this.motors.reduce((sum, motor) => sum + motor.step(dtSeconds, context), 0);
    return this.outputMW;
  }
}

export { DEFAULT_PROFILES as DEFAULT_MOTOR_START_PROFILES };
