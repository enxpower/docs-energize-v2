export const MOTOR_START_REQUEST_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  STARTED: 'STARTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
});

const normalizePriority = (value) => Math.max(1, Math.floor(Number(value) || 1));

export class MotorStartScheduler {
  constructor({
    controller,
    retryDelaySeconds = 30,
    maximumAttempts = 3,
  } = {}) {
    if (!controller) throw new Error('MotorStartScheduler requires a MotorStartController');
    this.controller = controller;
    this.retryDelaySeconds = Math.max(0, Number(retryDelaySeconds) || 0);
    this.maximumAttempts = Math.max(1, Math.floor(Number(maximumAttempts) || 1));
    this.requests = [];
    this.sequence = 0;
  }

  enqueue({
    motor,
    priority = 1,
    requestedAtSeconds = 0,
    earliestStartSeconds = requestedAtSeconds,
    deadlineSeconds = Infinity,
    reason = 'OPERATOR_REQUEST',
  }) {
    if (!motor?.id) throw new Error('Motor start request requires a motor');
    const existing = this.requests.find((request) => request.motor.id === motor.id
      && request.state === MOTOR_START_REQUEST_STATE.QUEUED);
    if (existing) return existing;

    const request = {
      id: `MSR-${++this.sequence}`,
      motor,
      priority: normalizePriority(priority),
      requestedAtSeconds: Math.max(0, Number(requestedAtSeconds) || 0),
      earliestStartSeconds: Math.max(0, Number(earliestStartSeconds) || 0),
      deadlineSeconds: Number.isFinite(deadlineSeconds) ? Math.max(0, deadlineSeconds) : Infinity,
      reason,
      state: MOTOR_START_REQUEST_STATE.QUEUED,
      attempts: 0,
      lastAttemptSeconds: null,
      lastBlockedReasons: [],
      startedAtSeconds: null,
    };
    this.requests.push(request);
    return request;
  }

  cancel(requestId, timeSeconds = null) {
    const request = this.requests.find((candidate) => candidate.id === requestId);
    if (!request || request.state !== MOTOR_START_REQUEST_STATE.QUEUED) return null;
    request.state = MOTOR_START_REQUEST_STATE.CANCELLED;
    return {
      timeSeconds,
      type: 'MOTOR_START_REQUEST_CANCELLED',
      requestId: request.id,
      motorId: request.motor.id,
    };
  }

  activeQueue(timeSeconds) {
    return this.requests
      .filter((request) => request.state === MOTOR_START_REQUEST_STATE.QUEUED)
      .filter((request) => timeSeconds + 1e-9 >= request.earliestStartSeconds)
      .sort((a, b) => b.priority - a.priority
        || a.deadlineSeconds - b.deadlineSeconds
        || a.requestedAtSeconds - b.requestedAtSeconds
        || a.id.localeCompare(b.id));
  }

  expireRequests(timeSeconds) {
    const events = [];
    for (const request of this.requests) {
      if (request.state !== MOTOR_START_REQUEST_STATE.QUEUED) continue;
      if (timeSeconds <= request.deadlineSeconds + 1e-9) continue;
      request.state = MOTOR_START_REQUEST_STATE.EXPIRED;
      events.push({
        timeSeconds,
        type: 'MOTOR_START_REQUEST_EXPIRED',
        requestId: request.id,
        motorId: request.motor.id,
        priority: request.priority,
        deadlineSeconds: request.deadlineSeconds,
      });
    }
    return events;
  }

  evaluate({
    motorBank,
    frequencyHz,
    residualMW,
    reserve60MW,
    timeSeconds,
  }) {
    const events = this.expireRequests(timeSeconds);
    const queue = this.activeQueue(timeSeconds);
    if (!queue.length) return events;

    for (const request of queue) {
      if (request.attempts >= this.maximumAttempts) {
        request.state = MOTOR_START_REQUEST_STATE.EXPIRED;
        events.push({
          timeSeconds,
          type: 'MOTOR_START_REQUEST_EXPIRED',
          requestId: request.id,
          motorId: request.motor.id,
          reason: 'MAXIMUM_ATTEMPTS_REACHED',
          attempts: request.attempts,
        });
        continue;
      }
      if (request.lastAttemptSeconds !== null
        && timeSeconds - request.lastAttemptSeconds + 1e-9 < this.retryDelaySeconds) {
        continue;
      }

      const result = this.controller.requestStart({
        motor: request.motor,
        motorBank,
        frequencyHz,
        residualMW,
        reserve60MW,
        timeSeconds,
      });
      request.attempts += 1;
      request.lastAttemptSeconds = timeSeconds;
      request.lastBlockedReasons = result.reasons ?? [];

      if (result.type === 'MOTOR_START_ACCEPTED') {
        request.state = MOTOR_START_REQUEST_STATE.STARTED;
        request.startedAtSeconds = timeSeconds;
        events.push({
          ...result,
          requestId: request.id,
          requestPriority: request.priority,
          requestReason: request.reason,
          queueDelaySeconds: timeSeconds - request.requestedAtSeconds,
          attempts: request.attempts,
        });
        break;
      }

      events.push({
        ...result,
        requestId: request.id,
        requestPriority: request.priority,
        requestReason: request.reason,
        retryEligibleAtSeconds: timeSeconds + this.retryDelaySeconds,
        attempts: request.attempts,
      });

      // A blocked high-priority request must not starve lower-priority requests
      // when the reason is motor-specific. System-wide constraints stop the scan.
      const systemWideBlock = (result.reasons ?? []).some((reason) => [
        'FREQUENCY_BELOW_START_PERMISSIVE',
        'ACTIVE_POWER_DEFICIT_PRESENT',
        'MAXIMUM_CONCURRENT_STARTS_REACHED',
        'MINIMUM_START_INTERVAL_NOT_ELAPSED',
        'INSUFFICIENT_60_SECOND_RESERVE',
      ].includes(reason));
      if (systemWideBlock) break;
    }

    return events;
  }

  snapshot() {
    return this.requests.map((request) => ({
      id: request.id,
      motorId: request.motor.id,
      priority: request.priority,
      state: request.state,
      requestedAtSeconds: request.requestedAtSeconds,
      earliestStartSeconds: request.earliestStartSeconds,
      deadlineSeconds: request.deadlineSeconds,
      attempts: request.attempts,
      lastBlockedReasons: [...request.lastBlockedReasons],
      startedAtSeconds: request.startedAtSeconds,
    }));
  }
}
