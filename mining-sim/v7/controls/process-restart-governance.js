export const PROCESS_TRIP_CLASS = Object.freeze({
  CONDITION_HOLD: 'CONDITION_HOLD',
  PROCESS_INTERLOCK: 'PROCESS_INTERLOCK',
  PROTECTION_TRIP: 'PROTECTION_TRIP',
  EMERGENCY_STOP: 'EMERGENCY_STOP',
});

export const PROCESS_RECOVERY_STATE = Object.freeze({
  NORMAL: 'NORMAL',
  AUTO_HOLD: 'AUTO_HOLD',
  AUTO_RESTART_PENDING: 'AUTO_RESTART_PENDING',
  OPERATOR_CONFIRMATION_REQUIRED: 'OPERATOR_CONFIRMATION_REQUIRED',
  LOCKED_OUT: 'LOCKED_OUT',
});

const DEFAULT_POLICIES = Object.freeze({
  CONDITION_HOLD: Object.freeze({ automaticRestart: true, confirmationRequired: false, lockout: false }),
  PROCESS_INTERLOCK: Object.freeze({ automaticRestart: true, confirmationRequired: false, lockout: false }),
  PROTECTION_TRIP: Object.freeze({ automaticRestart: false, confirmationRequired: true, lockout: false }),
  EMERGENCY_STOP: Object.freeze({ automaticRestart: false, confirmationRequired: true, lockout: true }),
});

export class ProcessRestartGovernance {
  constructor({
    automaticRestartDelaySeconds = 30,
    stableConditionSeconds = 10,
    maximumAutomaticRestarts = 2,
    policies = {},
  } = {}) {
    this.automaticRestartDelaySeconds = Math.max(0, Number(automaticRestartDelaySeconds) || 0);
    this.stableConditionSeconds = Math.max(0, Number(stableConditionSeconds) || 0);
    this.maximumAutomaticRestarts = Math.max(0, Math.floor(Number(maximumAutomaticRestarts) || 0));
    this.policies = { ...DEFAULT_POLICIES, ...policies };
    this.state = PROCESS_RECOVERY_STATE.NORMAL;
    this.tripClass = null;
    this.tripReason = null;
    this.trippedAtSeconds = null;
    this.conditionsHealthySinceSeconds = null;
    this.automaticRestartCount = 0;
    this.operatorConfirmed = false;
    this.lockoutReason = null;
  }

  classify({ tripClass, reason }) {
    if (Object.values(PROCESS_TRIP_CLASS).includes(tripClass)) return tripClass;
    const value = String(reason ?? '');
    if (value.includes('EMERGENCY')) return PROCESS_TRIP_CLASS.EMERGENCY_STOP;
    if (value.includes('PROTECTION')) return PROCESS_TRIP_CLASS.PROTECTION_TRIP;
    if (value.includes('PREREQUISITE') || value.includes('CONDITION')) return PROCESS_TRIP_CLASS.CONDITION_HOLD;
    return PROCESS_TRIP_CLASS.PROCESS_INTERLOCK;
  }

  handleTrip({ timeSeconds, tripClass = null, reason = 'PROCESS_TRIP' } = {}) {
    const resolvedClass = this.classify({ tripClass, reason });
    const policy = this.policies[resolvedClass] ?? DEFAULT_POLICIES.PROCESS_INTERLOCK;
    this.tripClass = resolvedClass;
    this.tripReason = reason;
    this.trippedAtSeconds = timeSeconds;
    this.conditionsHealthySinceSeconds = null;
    this.operatorConfirmed = false;

    if (policy.lockout) {
      this.state = PROCESS_RECOVERY_STATE.LOCKED_OUT;
      this.lockoutReason = reason;
    } else if (policy.confirmationRequired) {
      this.state = PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED;
    } else {
      this.state = PROCESS_RECOVERY_STATE.AUTO_HOLD;
    }

    return {
      timeSeconds,
      type: 'PROCESS_RESTART_GOVERNANCE_TRIP_CLASSIFIED',
      tripClass: resolvedClass,
      reason,
      recoveryState: this.state,
      automaticRestartAllowed: Boolean(policy.automaticRestart),
      operatorConfirmationRequired: Boolean(policy.confirmationRequired),
      lockedOut: Boolean(policy.lockout),
    };
  }

  setConditionsHealthy({ timeSeconds, healthy }) {
    if (!healthy) {
      this.conditionsHealthySinceSeconds = null;
      return null;
    }
    if (this.conditionsHealthySinceSeconds === null) this.conditionsHealthySinceSeconds = timeSeconds;
    return null;
  }

  confirm({ timeSeconds, reason = 'OPERATOR_CONFIRMATION' } = {}) {
    if (![PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED, PROCESS_RECOVERY_STATE.LOCKED_OUT].includes(this.state)) return null;
    this.operatorConfirmed = true;
    if (this.state === PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED) {
      this.state = PROCESS_RECOVERY_STATE.AUTO_HOLD;
    }
    return {
      timeSeconds,
      type: 'PROCESS_RESTART_OPERATOR_CONFIRMED',
      tripClass: this.tripClass,
      reason,
      recoveryState: this.state,
    };
  }

  resetLockout({ timeSeconds, reason = 'OPERATOR_LOCKOUT_RESET' } = {}) {
    if (this.state !== PROCESS_RECOVERY_STATE.LOCKED_OUT) return null;
    this.state = PROCESS_RECOVERY_STATE.AUTO_HOLD;
    this.operatorConfirmed = true;
    this.lockoutReason = null;
    return {
      timeSeconds,
      type: 'PROCESS_RESTART_LOCKOUT_RESET',
      tripClass: this.tripClass,
      reason,
      recoveryState: this.state,
    };
  }

  evaluate({ timeSeconds, conditionsHealthy }) {
    this.setConditionsHealthy({ timeSeconds, healthy: conditionsHealthy });
    if (this.state !== PROCESS_RECOVERY_STATE.AUTO_HOLD) return null;
    const policy = this.policies[this.tripClass] ?? DEFAULT_POLICIES.PROCESS_INTERLOCK;
    if (!policy.automaticRestart && !this.operatorConfirmed) return null;
    if (!conditionsHealthy || this.conditionsHealthySinceSeconds === null) return null;
    if (timeSeconds - this.conditionsHealthySinceSeconds + 1e-9 < this.stableConditionSeconds) return null;
    if (timeSeconds - this.trippedAtSeconds + 1e-9 < this.automaticRestartDelaySeconds) return null;
    if (policy.automaticRestart && this.automaticRestartCount >= this.maximumAutomaticRestarts) {
      this.state = PROCESS_RECOVERY_STATE.OPERATOR_CONFIRMATION_REQUIRED;
      return {
        timeSeconds,
        type: 'PROCESS_AUTOMATIC_RESTART_LIMIT_REACHED',
        tripClass: this.tripClass,
        automaticRestartCount: this.automaticRestartCount,
        recoveryState: this.state,
      };
    }

    this.state = PROCESS_RECOVERY_STATE.AUTO_RESTART_PENDING;
    if (policy.automaticRestart) this.automaticRestartCount += 1;
    return {
      timeSeconds,
      type: 'PROCESS_RESTART_AUTHORIZED',
      tripClass: this.tripClass,
      automatic: Boolean(policy.automaticRestart && !this.operatorConfirmed),
      automaticRestartCount: this.automaticRestartCount,
      recoveryState: this.state,
    };
  }

  handleRestarted({ timeSeconds }) {
    this.state = PROCESS_RECOVERY_STATE.NORMAL;
    this.tripClass = null;
    this.tripReason = null;
    this.trippedAtSeconds = null;
    this.conditionsHealthySinceSeconds = null;
    this.operatorConfirmed = false;
    return { timeSeconds, type: 'PROCESS_RESTART_COMPLETED', recoveryState: this.state };
  }

  snapshot() {
    return {
      state: this.state,
      tripClass: this.tripClass,
      tripReason: this.tripReason,
      trippedAtSeconds: this.trippedAtSeconds,
      conditionsHealthySinceSeconds: this.conditionsHealthySinceSeconds,
      automaticRestartCount: this.automaticRestartCount,
      operatorConfirmed: this.operatorConfirmed,
      lockoutReason: this.lockoutReason,
    };
  }
}
