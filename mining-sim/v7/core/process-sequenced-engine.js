import { MotorScheduledSimulationEngine } from './motor-scheduled-engine.js';

export class ProcessSequencedSimulationEngine extends MotorScheduledSimulationEngine {
  constructor({ processSequenceController, ...config }) {
    super(config);
    if (!processSequenceController) {
      throw new Error('ProcessSequencedSimulationEngine requires a processSequenceController');
    }
    this.processSequenceController = processSequenceController;
    this.processEventCount = 0;
  }

  recordProcessEvents(events) {
    for (const event of events) {
      this.events.push(event);
      this.processEventCount += 1;
    }
  }

  setProcessCondition(conditionId, ready) {
    const event = this.processSequenceController.setCondition(
      conditionId,
      ready,
      this.timeSeconds,
    );
    if (event) this.recordProcessEvents([event]);
    return event;
  }

  requestProcessStart(reason = 'OPERATOR_REQUEST') {
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
    this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
    this.nextCommitmentEvaluationSeconds = Math.min(
      this.nextCommitmentEvaluationSeconds,
      this.timeSeconds,
    );
    return events;
  }

  step() {
    const sample = super.step();
    const processEvents = this.processSequenceController.evaluate({
      timeSeconds: sample.timeSeconds,
      motorBank: this.motorBank,
      scheduler: this.motorStartScheduler,
    });
    this.recordProcessEvents(processEvents);

    if (processEvents.some((event) => [
      'PROCESS_EQUIPMENT_STOPPED',
      'PROCESS_SEQUENCE_TRIPPED',
    ].includes(event.type))) {
      this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
      this.nextCommitmentEvaluationSeconds = Math.min(
        this.nextCommitmentEvaluationSeconds,
        this.timeSeconds,
      );
    }

    sample.processEvents = processEvents;
    sample.processEventCount = this.processEventCount;
    sample.processSequence = this.processSequenceController.snapshot();
    sample.processState = sample.processSequence.state;
    return sample;
  }
}
