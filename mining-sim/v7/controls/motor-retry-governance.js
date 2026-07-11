export const MOTOR_RECOVERY_STATE = Object.freeze({
  READY: 'READY',
  WAITING_RETRY: 'WAITING_RETRY',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  LOCKED_OUT: 'LOCKED_OUT',
});

export const MOTOR_FAILURE_CLASS = Object.freeze({
  AUTO_RETRY: 'AUTO_RETRY',
  OPERATOR_CONFIRMATION: 'OPERATOR_CONFIRMATION',
  LOCKOUT: 'LOCKOUT',
});

const DEFAULT_AUTO_RETRY_REASONS = Object.freeze([
  'LOW_FREQUENCY_DURING_START',
  'TEMPORARY_RESERVE_SHORTFALL',
  'START_INTERVAL_NOT_ELAPSED',
]);

const DEFAULT_CONFIRMATION_REASONS = Object.freeze([
  'PROCESS_INTERLOCK_OPEN',
  'UPSTREAM_BREAKER_NOT_READY',
  'PROTECTION_TRIP',
]);

const DEFAULT_LOCKOUT_REASONS = Object.freeze([
  'MOTOR_INTERNAL_FAULT',
  'STARTER_FAULT',
  'REPEATED_START_FAILURE',
]);

export class MotorRetryGovernance {
  constructor({
    retryDelaySeconds = 60,
    maximumAutomaticRetries = 2,
    lockoutAfterConsecutiveFailures = 3,
    defaultRetryPriority = 1,
    autoRetryReasons = DEFAULT_AUTO_RETRY_REASONS,
    confirmationReasons = DEFAULT_CONFIRMATION_REASONS,
    lockoutReasons = DEFAULT_LOCKOUT_REASONS,
  } = {}) {
    this.retryDelaySeconds = Math.max(0, Number(retryDelaySeconds) || 0);
    this.maximumAutomaticRetries = Math.max(0, Math.floor(Number(maximumAutomaticRetries) || 0));
    this.lockoutAfterConsecutiveFailures = Math.max(1, Math.floor(Number(lockoutAfterConsecutiveFailures) || 1));
    this.defaultRetryPriority = Math.max(1, Math.floor(Number(defaultRetryPriority) || 1));
    this.autoRetryReasons = new Set(autoRetryReasons);
    this.confirmationReasons = new Set(confirmationReasons);
    this.lockoutReasons = new Set(lockoutReasons);
    this.records = new Map();
  }

  recordFor(motor) {
    if (!this.records.has(motor.id)) {
      this.records.set(motor.id, {
        motor,
        state: MOTOR_RECOVERY_STATE.READY,
        consecutiveFailures: 0,
        automaticRetries: 0,
        retryEligibleAtSeconds: null,
        lastFailureReason: null,
        lastFailureSeconds: null,
        lastRequestPriority: this.defaultRetryPriority,
      });
    }
    return this.records.get(motor.id);
  }

  classifyFailure(reason) {
    if (this.lockoutReasons.has(reason)) return MOTOR_FAILURE_CLASS.LOCKOUT;
    if (this.confirmationReasons.has(reason)) return MOTOR_FAILURE_CLASS.OPERATOR_CONFIRMATION;
    if (this.autoRetryReasons.has(reason)) return MOTOR_FAILURE_CLASS.AUTO_RETRY;
    return MOTOR_FAILURE_CLASS.OPERATOR_CONFIRMATION;
  }

  handleFailure({ motor, timeSeconds, requestPriority = this.defaultRetryPriority }) {
    const record = this.recordFor(motor);
    const reason = motor.lastFailureReason ?? 'UNKNOWN_START_FAILURE';
    const failureClass = this.classifyFailure(reason);
    record.consecutiveFailures += 1;
    record.lastFailureReason = reason;
    record.lastFailureSeconds = timeSeconds;
    record.lastRequestPriority = Math.max(1, Number(requestPriority) || this.defaultRetryPriority);

    const repeatedFailure = record.consecutiveFailures >= this.lockoutAfterConsecutiveFailures;
    const autoRetryExhausted = record.automaticRetries >= this.maximumAutomaticRetries;
    if (failureClass === MOTOR_FAILURE_CLASS.LOCKOUT || repeatedFailure || (failureClass === MOTOR_FAILURE_CLASS.AUTO_RETRY && autoRetryExhausted)) {
      record.state = MOTOR_RECOVERY_STATE.LOCKED_OUT;
      record.retryEligibleAtSeconds = null;
      return {
        timeSeconds,
        type: 'MOTOR_LOCKED_OUT',
        motorId: motor.id,
        failureReason: reason,
        failureClass,
        consecutiveFailures: record.consecutiveFailures,
        automaticRetries: record.automaticRetries,
        lockoutReason: repeatedFailure ? 'CONSECUTIVE_FAILURE_LIMIT' : autoRetryExhausted ? 'AUTOMATIC_RETRY_LIMIT' : reason,
      };
    }

    if (failureClass === MOTOR_FAILURE_CLASS.OPERATOR_CONFIRMATION) {
      record.state = MOTOR_RECOVERY_STATE.AWAITING_CONFIRMATION;
      record.retryEligibleAtSeconds = null;
      return {
        timeSeconds,
        type: 'MOTOR_OPERATOR_CONFIRMATION_REQUIRED',
        motorId: motor.id,
        failureReason: reason,
        failureClass,
        consecutiveFailures: record.consecutiveFailures,
      };
    }

    record.state = MOTOR_RECOVERY_STATE.WAITING_RETRY;
    record.retryEligibleAtSeconds = timeSeconds + this.retryDelaySeconds;
    return {
      timeSeconds,
      type: 'MOTOR_RETRY_SCHEDULED',
      motorId: motor.id,
      failureReason: reason,
      failureClass,
      retryEligibleAtSeconds: record.retryEligibleAtSeconds,
      automaticRetries: record.automaticRetries,
      maximumAutomaticRetries: this.maximumAutomaticRetries,
    };
  }

  evaluate({ timeSeconds, scheduler }) {
    const events = [];
    for (const record of this.records.values()) {
      if (record.state !== MOTOR_RECOVERY_STATE.WAITING_RETRY) continue;
      if (timeSeconds + 1e-9 < record.retryEligibleAtSeconds) continue;
      if (!record.motor.resetFailure()) continue;
      record.automaticRetries += 1;
      record.state = MOTOR_RECOVERY_STATE.READY;
      const request = scheduler.enqueue({
        motor: record.motor,
        priority: record.lastRequestPriority,
        requestedAtSeconds: timeSeconds,
        earliestStartSeconds: timeSeconds,
        reason: 'AUTOMATIC_RETRY',
      });
      events.push({
        timeSeconds,
        type: 'MOTOR_AUTOMATIC_RETRY_QUEUED',
        motorId: record.motor.id,
        requestId: request.id,
        automaticRetryNumber: record.automaticRetries,
        maximumAutomaticRetries: this.maximumAutomaticRetries,
      });
    }
    return events;
  }

  acknowledge({ motorId, timeSeconds, scheduler, priority = null }) {
    const record = this.records.get(motorId);
    if (!record || record.state !== MOTOR_RECOVERY_STATE.AWAITING_CONFIRMATION) return null;
    if (!record.motor.resetFailure()) return null;
    record.state = MOTOR_RECOVERY_STATE.READY;
    const request = scheduler.enqueue({
      motor: record.motor,
      priority: priority ?? record.lastRequestPriority,
      requestedAtSeconds: timeSeconds,
      earliestStartSeconds: timeSeconds,
      reason: 'OPERATOR_CONFIRMED_RETRY',
    });
    return {
      timeSeconds,
      type: 'MOTOR_OPERATOR_RETRY_CONFIRMED',
      motorId,
      requestId: request.id,
    };
  }

  resetLockout({ motorId, timeSeconds }) {
    const record = this.records.get(motorId);
    if (!record || record.state !== MOTOR_RECOVERY_STATE.LOCKED_OUT) return null;
    if (record.motor.state === 'FAILED') record.motor.resetFailure();
    record.state = MOTOR_RECOVERY_STATE.READY;
    record.consecutiveFailures = 0;
    record.automaticRetries = 0;
    record.retryEligibleAtSeconds = null;
    return { timeSeconds, type: 'MOTOR_LOCKOUT_RESET', motorId };
  }

  handleSuccess({ motor, timeSeconds }) {
    const record = this.recordFor(motor);
    if (record.consecutiveFailures === 0 && record.automaticRetries === 0) return null;
    const event = {
      timeSeconds,
      type: 'MOTOR_RECOVERY_CLEARED',
      motorId: motor.id,
      previousConsecutiveFailures: record.consecutiveFailures,
      previousAutomaticRetries: record.automaticRetries,
    };
    record.state = MOTOR_RECOVERY_STATE.READY;
    record.consecutiveFailures = 0;
    record.automaticRetries = 0;
    record.retryEligibleAtSeconds = null;
    record.lastFailureReason = null;
    return event;
  }

  snapshot() {
    return [...this.records.values()].map((record) => ({
      motorId: record.motor.id,
      state: record.state,
      consecutiveFailures: record.consecutiveFailures,
      automaticRetries: record.automaticRetries,
      retryEligibleAtSeconds: record.retryEligibleAtSeconds,
      lastFailureReason: record.lastFailureReason,
      lastFailureSeconds: record.lastFailureSeconds,
    }));
  }
}
