import { MotorScheduledSimulationEngine } from './motor-scheduled-engine.js';
import { PROCESS_RECOVERY_STATE } from '../controls/process-restart-governance.js';

export class ProcessSequencedSimulationEngine extends MotorScheduledSimulationEngine {
  constructor({ processSequenceController, processRestartGovernance = null, ...config }) {
    super(config);
    if (!processSequenceController) {
      throw new Error('ProcessSequencedSimulationEngine requires a processSequenceController');
    }
    this.processSequenceController = processSequenceController;
    this.processRestartGovernance = processRestartGovernance;
    this.processEventCount = 0;
  }

  recordProcessEvents(events) {
    for (const event of events) {
      if (!event) continue;
      this.events.push(event);
      this.processEventCount += 1;
    }
  }

  setProcessCondition(conditionId, ready) {
    const event = this.processSequenceController.setCondition(conditionId, ready, this.timeSeconds);
    if (event) this.recordProcessEvents([event]);
    return event;
  }

  requestProcessStart(reason = 'OPERATOR_REQUEST') {
    if (this.processRestartGovernance
      && this.processRestartGovernance.state !== PROCESS_RECOVERY_STATE.NORMAL
      && this.processRestartGovernance.state !== PROCESS_RECOVERY_STATE.AUTO_RESTART_PENDING) {
      const blocked = {
        timeSeconds: this.timeSeconds,
        type: 'PROCESS_SEQUENCE_START_BLOCKED_BY_GOVERNANCE',
        reason,
        recoveryState: this.processRestartGovernance.state,
      };
      this.recordProcessEvents([blocked]);
      return blocked;
    }
    const event = this.processSequenceController.requestStart(this.timeSeconds, reason);
    this.recordProcessEvents([event]);
    return event;
  }

  stopProcessSequence(reason = 'OPERATOR_STOP') {
    const events = this.processSequenceController.stop({
      timeSeconds: this.timeSeconds,
      motorBank: this.motorBank,
      reason,
    });
    this.recordProcessEvents(events);
    this.forceSupervisoryReevaluation();
    return events;
  }

  tripProcessSequence({ tripClass = null, reason = 'PROCESS_TRIP' } = {}) {
    const stopEvents = this.processSequenceController.stop({
      timeSeconds: this.timeSeconds,
      motorBank: this.motorBank,
      reason,
    });
    this.processSequenceController.state = 'TRIPPED';
    this.processSequenceController.trippedAtSeconds = this.timeSeconds;
    this.processSequenceController.lastTripReason = reason;
    const classified = this.processRestartGovernance?.handleTrip({
      timeSeconds: this.timeSeconds,
      tripClass,
      reason,
    });
    const events = [...stopEvents, classified].filter(Boolean);
    this.recordProcessEvents(events);
    this.forceSupervisoryReevaluation();
    return events;
  }

  confirmProcessRestart(reason = 'OPERATOR_CONFIRMATION') {
    const event = this.processRestartGovernance?.confirm({ timeSeconds: this.timeSeconds, reason }) ?? null;
    if (event) this.recordProcessEvents([event]);
    return event;
  }

  resetProcessLockout(reason = 'OPERATOR_LOCKOUT_RESET') {
    const event = this.processRestartGovernance?.resetLockout({ timeSeconds: this.timeSeconds, reason }) ?? null;
    if (event) this.recordProcessEvents([event]);
    return event;
  }

  forceSupervisoryReevaluation() {
    this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
    this.nextCommitmentEvaluationSeconds = Math.min(
      this.nextCommitmentEvaluationSeconds,
      this.timeSeconds,
    );
  }

  allProcessConditionsHealthy() {
    const values = [...this.processSequenceController.conditions.values()];
    return values.length === 0 || values.every(Boolean);
  }

  step() {
    const sample = super.step();
    const processEvents = this.processSequenceController.evaluate({
      timeSeconds: sample.timeSeconds,
      motorBank: this.motorBank,
      scheduler: this.motorStartScheduler,
    });

    const governanceEvents = [];
    for (const event of processEvents) {
      if (event.type !== 'PROCESS_SEQUENCE_TRIPPED' || !this.processRestartGovernance) continue;
      if (this.processRestartGovernance.state !== PROCESS_RECOVERY_STATE.NORMAL) continue;
      governanceEvents.push(this.processRestartGovernance.handleTrip({
        timeSeconds: sample.timeSeconds,
        reason: event.reason,
      }));
    }

    const restartAuthorization = this.processRestartGovernance?.evaluate({
      timeSeconds: sample.timeSeconds,
      conditionsHealthy: this.allProcessConditionsHealthy(),
    }) ?? null;
    if (restartAuthorization) {
      governanceEvents.push(restartAuthorization);
      if (restartAuthorization.type === 'PROCESS_RESTART_AUTHORIZED') {
        governanceEvents.push(this.processSequenceController.requestStart(
          sample.timeSeconds,
          restartAuthorization.automatic ? 'AUTOMATIC_RESTART' : 'CONFIRMED_RESTART',
        ));
      }
    }

    if (this.processRestartGovernance?.state === PROCESS_RECOVERY_STATE.AUTO_RESTART_PENDING
      && this.processSequenceController.state === 'RUNNING') {
      governanceEvents.push(this.processRestartGovernance.handleRestarted({ timeSeconds: sample.timeSeconds }));
    }

    const allEvents = [...processEvents, ...governanceEvents].filter(Boolean);
    this.recordProcessEvents(allEvents);

    if (allEvents.some((event) => [
      'PROCESS_EQUIPMENT_STOPPED',
      'PROCESS_SEQUENCE_TRIPPED',
      'PROCESS_RESTART_AUTHORIZED',
    ].includes(event.type))) {
      this.forceSupervisoryReevaluation();
    }

    sample.processEvents = allEvents;
    sample.processEventCount = this.processEventCount;
    sample.processSequence = this.processSequenceController.snapshot();
    sample.processState = sample.processSequence.state;
    sample.processRestartGovernance = this.processRestartGovernance?.snapshot() ?? null;
    return sample;
  }
}
