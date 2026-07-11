import { MOTOR_STATE } from '../equipment/motor-load.js';

export const PROCESS_SEQUENCE_STATE = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  TRIPPED: 'TRIPPED',
  STOPPED: 'STOPPED',
});

export const PROCESS_STEP_STATE = Object.freeze({
  WAITING: 'WAITING',
  BLOCKED: 'BLOCKED',
  QUEUED: 'QUEUED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
});

const normalizeReference = (reference) => {
  const value = String(reference ?? '').trim();
  if (!value.includes(':')) return `step:${value}`;
  return value;
};

export class ProcessSequenceController {
  constructor({ id = 'MINING-PROCESS', name = id, steps = [] } = {}) {
    if (!steps.length) throw new Error('ProcessSequenceController requires at least one step');
    this.id = id;
    this.name = name;
    this.steps = steps.map((step, index) => ({
      id: String(step.id),
      name: step.name ?? step.id,
      motorId: String(step.motorId),
      prerequisites: (step.prerequisites ?? []).map(normalizeReference),
      prerequisiteMode: step.prerequisiteMode === 'ANY' ? 'ANY' : 'ALL',
      priority: Math.max(1, Math.floor(Number(step.priority) || 1)),
      deadlineOffsetSeconds: Number.isFinite(step.deadlineOffsetSeconds)
        ? Math.max(0, step.deadlineOffsetSeconds)
        : Infinity,
      stopOnPrerequisiteLoss: step.stopOnPrerequisiteLoss !== false,
      critical: step.critical !== false,
      order: index,
      requestIssued: false,
      state: PROCESS_STEP_STATE.WAITING,
      blockedBy: [],
    }));
    this.stepById = new Map(this.steps.map((step) => [step.id, step]));
    if (this.stepById.size !== this.steps.length) throw new Error('Process step ids must be unique');
    this.validateReferencesAndCycles();

    this.conditions = new Map();
    this.state = PROCESS_SEQUENCE_STATE.IDLE;
    this.active = false;
    this.requestedAtSeconds = null;
    this.startedAtSeconds = null;
    this.trippedAtSeconds = null;
    this.lastTripReason = null;
    this.lastEvent = null;
  }

  validateReferencesAndCycles() {
    for (const step of this.steps) {
      if (!step.id || !step.motorId) throw new Error('Each process step requires id and motorId');
      for (const reference of step.prerequisites) {
        if (reference.startsWith('step:') && !this.stepById.has(reference.slice(5))) {
          throw new Error(`Unknown process prerequisite: ${reference}`);
        }
        if (!reference.startsWith('step:') && !reference.startsWith('condition:')) {
          throw new Error(`Unsupported process prerequisite: ${reference}`);
        }
      }
    }

    const visiting = new Set();
    const visited = new Set();
    const visit = (stepId) => {
      if (visiting.has(stepId)) throw new Error(`Process sequence cycle detected at ${stepId}`);
      if (visited.has(stepId)) return;
      visiting.add(stepId);
      const step = this.stepById.get(stepId);
      for (const reference of step.prerequisites) {
        if (reference.startsWith('step:')) visit(reference.slice(5));
      }
      visiting.delete(stepId);
      visited.add(stepId);
    };
    for (const step of this.steps) visit(step.id);
  }

  setCondition(conditionId, ready, timeSeconds = null) {
    const id = String(conditionId);
    const previous = this.conditions.get(id) ?? false;
    const next = Boolean(ready);
    this.conditions.set(id, next);
    if (previous === next) return null;
    const event = {
      timeSeconds,
      type: 'PROCESS_CONDITION_CHANGED',
      processId: this.id,
      conditionId: id,
      previousReady: previous,
      ready: next,
    };
    this.lastEvent = event;
    return event;
  }

  requestStart(timeSeconds = 0, reason = 'OPERATOR_REQUEST') {
    this.active = true;
    this.state = PROCESS_SEQUENCE_STATE.STARTING;
    this.requestedAtSeconds = timeSeconds;
    this.startedAtSeconds = null;
    this.trippedAtSeconds = null;
    this.lastTripReason = null;
    for (const step of this.steps) {
      step.requestIssued = false;
      step.state = PROCESS_STEP_STATE.WAITING;
      step.blockedBy = [];
    }
    const event = {
      timeSeconds,
      type: 'PROCESS_SEQUENCE_START_REQUESTED',
      processId: this.id,
      processName: this.name,
      reason,
    };
    this.lastEvent = event;
    return event;
  }

  stop({ timeSeconds = null, motorBank, reason = 'OPERATOR_STOP' } = {}) {
    const events = [];
    const motors = new Map((motorBank?.motors ?? []).map((motor) => [motor.id, motor]));
    for (const step of [...this.steps].reverse()) {
      const motor = motors.get(step.motorId);
      if (!motor || (![MOTOR_STATE.STARTING, MOTOR_STATE.RUNNING].includes(motor.state))) continue;
      motor.stop();
      step.state = PROCESS_STEP_STATE.STOPPED;
      events.push({
        timeSeconds,
        type: 'PROCESS_EQUIPMENT_STOPPED',
        processId: this.id,
        stepId: step.id,
        motorId: step.motorId,
        reason,
      });
    }
    this.active = false;
    this.state = PROCESS_SEQUENCE_STATE.STOPPED;
    const stopped = {
      timeSeconds,
      type: 'PROCESS_SEQUENCE_STOPPED',
      processId: this.id,
      reason,
    };
    events.push(stopped);
    this.lastEvent = stopped;
    return events;
  }

  referenceSatisfied(reference, motors) {
    if (reference.startsWith('condition:')) {
      return this.conditions.get(reference.slice(10)) === true;
    }
    const step = this.stepById.get(reference.slice(5));
    const motor = motors.get(step.motorId);
    return motor?.state === MOTOR_STATE.RUNNING;
  }

  blockedReferences(step, motors) {
    const results = step.prerequisites.map((reference) => ({
      reference,
      satisfied: this.referenceSatisfied(reference, motors),
    }));
    if (!results.length) return [];
    if (step.prerequisiteMode === 'ANY') {
      return results.some((result) => result.satisfied) ? [] : results.map((result) => result.reference);
    }
    return results.filter((result) => !result.satisfied).map((result) => result.reference);
  }

  chainSatisfied(step, motors, visiting = new Set()) {
    if (visiting.has(step.id)) return false;
    visiting.add(step.id);
    const outcomes = step.prerequisites.map((reference) => {
      if (reference.startsWith('condition:')) return this.conditions.get(reference.slice(10)) === true;
      const upstream = this.stepById.get(reference.slice(5));
      const upstreamMotor = motors.get(upstream.motorId);
      return upstreamMotor?.state === MOTOR_STATE.RUNNING
        && this.chainSatisfied(upstream, motors, new Set(visiting));
    });
    if (!outcomes.length) return true;
    return step.prerequisiteMode === 'ANY' ? outcomes.some(Boolean) : outcomes.every(Boolean);
  }

  tripForPrerequisiteLoss({ timeSeconds, motorBank, motors }) {
    const affected = [...this.steps]
      .reverse()
      .filter((step) => {
        const motor = motors.get(step.motorId);
        return step.stopOnPrerequisiteLoss
          && [MOTOR_STATE.STARTING, MOTOR_STATE.RUNNING].includes(motor?.state)
          && !this.chainSatisfied(step, motors);
      });
    if (!affected.length) return [];

    const events = [];
    for (const step of affected) {
      const motor = motors.get(step.motorId);
      motor.stop();
      step.state = PROCESS_STEP_STATE.STOPPED;
      step.requestIssued = false;
      events.push({
        timeSeconds,
        type: 'PROCESS_EQUIPMENT_STOPPED',
        processId: this.id,
        stepId: step.id,
        motorId: step.motorId,
        reason: 'PREREQUISITE_LOST',
      });
    }
    this.active = false;
    this.state = PROCESS_SEQUENCE_STATE.TRIPPED;
    this.trippedAtSeconds = timeSeconds;
    this.lastTripReason = 'PREREQUISITE_LOST';
    const trip = {
      timeSeconds,
      type: 'PROCESS_SEQUENCE_TRIPPED',
      processId: this.id,
      reason: this.lastTripReason,
      stoppedStepIds: affected.map((step) => step.id),
    };
    events.push(trip);
    this.lastEvent = trip;
    return events;
  }

  evaluate({ timeSeconds, motorBank, scheduler }) {
    if (!this.active) return [];
    const motors = new Map((motorBank?.motors ?? []).map((motor) => [motor.id, motor]));
    for (const step of this.steps) {
      if (!motors.has(step.motorId)) throw new Error(`Process step ${step.id} references unknown motor ${step.motorId}`);
    }

    const prerequisiteTrip = this.tripForPrerequisiteLoss({ timeSeconds, motorBank, motors });
    if (prerequisiteTrip.length) return prerequisiteTrip;

    const failedStep = this.steps.find((step) => motors.get(step.motorId)?.state === MOTOR_STATE.FAILED);
    if (failedStep) {
      failedStep.state = PROCESS_STEP_STATE.FAILED;
      this.active = false;
      this.state = PROCESS_SEQUENCE_STATE.TRIPPED;
      this.trippedAtSeconds = timeSeconds;
      this.lastTripReason = `STEP_FAILED:${failedStep.id}`;
      const event = {
        timeSeconds,
        type: 'PROCESS_SEQUENCE_TRIPPED',
        processId: this.id,
        reason: this.lastTripReason,
        failedStepId: failedStep.id,
        motorId: failedStep.motorId,
      };
      this.lastEvent = event;
      return [event];
    }

    const events = [];
    let blockedCount = 0;
    for (const step of this.steps) {
      const motor = motors.get(step.motorId);
      if (motor.state === MOTOR_STATE.RUNNING) {
        step.state = PROCESS_STEP_STATE.RUNNING;
        step.blockedBy = [];
        continue;
      }
      if (motor.state === MOTOR_STATE.STARTING) {
        step.state = PROCESS_STEP_STATE.STARTING;
        step.blockedBy = [];
        continue;
      }

      const blockedBy = this.blockedReferences(step, motors);
      step.blockedBy = blockedBy;
      if (blockedBy.length) {
        blockedCount += 1;
        step.state = PROCESS_STEP_STATE.BLOCKED;
        continue;
      }

      if (!step.requestIssued && motor.isStartable) {
        const request = scheduler.enqueue({
          motor,
          priority: step.priority,
          requestedAtSeconds: timeSeconds,
          earliestStartSeconds: timeSeconds,
          deadlineSeconds: Number.isFinite(step.deadlineOffsetSeconds)
            ? timeSeconds + step.deadlineOffsetSeconds
            : Infinity,
          reason: `PROCESS_SEQUENCE:${this.id}:${step.id}`,
        });
        step.requestIssued = true;
        step.state = PROCESS_STEP_STATE.QUEUED;
        events.push({
          timeSeconds,
          type: 'PROCESS_STEP_START_REQUESTED',
          processId: this.id,
          stepId: step.id,
          stepName: step.name,
          motorId: step.motorId,
          requestId: request.id,
          priority: step.priority,
        });
      } else {
        step.state = PROCESS_STEP_STATE.WAITING;
      }
    }

    const allRunning = this.steps.every((step) => motors.get(step.motorId)?.state === MOTOR_STATE.RUNNING);
    if (allRunning && this.state !== PROCESS_SEQUENCE_STATE.RUNNING) {
      this.state = PROCESS_SEQUENCE_STATE.RUNNING;
      this.startedAtSeconds = timeSeconds;
      const event = {
        timeSeconds,
        type: 'PROCESS_SEQUENCE_RUNNING',
        processId: this.id,
        processName: this.name,
        startupDurationSeconds: timeSeconds - this.requestedAtSeconds,
      };
      events.push(event);
      this.lastEvent = event;
    } else if (!allRunning) {
      this.state = blockedCount > 0 ? PROCESS_SEQUENCE_STATE.BLOCKED : PROCESS_SEQUENCE_STATE.STARTING;
    }

    return events;
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      active: this.active,
      requestedAtSeconds: this.requestedAtSeconds,
      startedAtSeconds: this.startedAtSeconds,
      trippedAtSeconds: this.trippedAtSeconds,
      lastTripReason: this.lastTripReason,
      conditions: Object.fromEntries(this.conditions.entries()),
      steps: this.steps.map((step) => ({
        id: step.id,
        name: step.name,
        motorId: step.motorId,
        state: step.state,
        prerequisites: [...step.prerequisites],
        prerequisiteMode: step.prerequisiteMode,
        blockedBy: [...step.blockedBy],
        requestIssued: step.requestIssued,
        priority: step.priority,
      })),
    };
  }
}
