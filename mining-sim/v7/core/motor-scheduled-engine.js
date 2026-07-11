import { SimulationEngine } from './simulation-engine.js';
import { MOTOR_STATE } from '../equipment/motor-load.js';

export class MotorScheduledSimulationEngine extends SimulationEngine {
  constructor({ motorBank, motorStartScheduler, ...config }) {
    super(config);
    if (!motorBank) throw new Error('MotorScheduledSimulationEngine requires a motorBank');
    if (!motorStartScheduler) throw new Error('MotorScheduledSimulationEngine requires a motorStartScheduler');
    this.motorBank = motorBank;
    this.motorStartScheduler = motorStartScheduler;
    this.motorEventCount = 0;
    this.lastMotorStates = new Map(
      this.motorBank.motors.map((motor) => [motor.id, motor.state]),
    );
  }

  requestMotorStart({
    motorId,
    priority = 1,
    earliestStartSeconds = this.timeSeconds,
    deadlineSeconds = Infinity,
    reason = 'OPERATOR_REQUEST',
  }) {
    const motor = this.motorBank.motors.find((candidate) => candidate.id === motorId);
    if (!motor) throw new Error(`Unknown motor: ${motorId}`);
    const request = this.motorStartScheduler.enqueue({
      motor,
      priority,
      requestedAtSeconds: this.timeSeconds,
      earliestStartSeconds,
      deadlineSeconds,
      reason,
    });
    const event = {
      timeSeconds: this.timeSeconds,
      type: 'MOTOR_START_REQUEST_QUEUED',
      requestId: request.id,
      motorId,
      priority: request.priority,
      earliestStartSeconds: request.earliestStartSeconds,
      deadlineSeconds: request.deadlineSeconds,
      reason,
    };
    this.events.push(event);
    this.motorEventCount += 1;
    return event;
  }

  detectMotorStateEvents(timeSeconds) {
    const events = [];
    for (const motor of this.motorBank.motors) {
      const previousState = this.lastMotorStates.get(motor.id) ?? motor.state;
      if (previousState === MOTOR_STATE.STARTING && motor.state === MOTOR_STATE.RUNNING) {
        events.push({
          timeSeconds,
          type: 'MOTOR_START_COMPLETED',
          motorId: motor.id,
          motorName: motor.name,
          ratedMW: motor.ratedMW,
          startMode: motor.startMode,
          startDurationSeconds: motor.stateElapsedSeconds,
        });
      }
      if (previousState === MOTOR_STATE.STARTING && motor.state === MOTOR_STATE.FAILED) {
        events.push({
          timeSeconds,
          type: 'MOTOR_START_FAILED',
          motorId: motor.id,
          motorName: motor.name,
          ratedMW: motor.ratedMW,
          startMode: motor.startMode,
          failureReason: motor.lastFailureReason,
        });
      }
      this.lastMotorStates.set(motor.id, motor.state);
    }
    return events;
  }

  step() {
    const sample = super.step();
    const stateEvents = this.detectMotorStateEvents(sample.timeSeconds);
    const schedulingEvents = this.motorStartScheduler.evaluate({
      motorBank: this.motorBank,
      frequencyHz: sample.frequencyHz,
      residualMW: sample.residualMW,
      reserve60MW: sample.reserve60MW,
      timeSeconds: sample.timeSeconds,
    });

    const motorEvents = [...stateEvents, ...schedulingEvents];
    for (const event of motorEvents) {
      this.events.push(event);
      this.motorEventCount += 1;
      if (event.type === 'MOTOR_START_ACCEPTED') {
        this.nextEmsDispatchSeconds = Math.min(this.nextEmsDispatchSeconds, this.timeSeconds);
        this.nextCommitmentEvaluationSeconds = Math.min(
          this.nextCommitmentEvaluationSeconds,
          this.timeSeconds,
        );
      }
    }

    sample.motorStartEvents = motorEvents;
    sample.motorEventCount = this.motorEventCount;
    sample.motorStartQueue = this.motorStartScheduler.snapshot();
    sample.motorStates = this.motorBank.motors.map((motor) => ({
      id: motor.id,
      name: motor.name,
      state: motor.state,
      ratedMW: motor.ratedMW,
      outputMW: motor.outputMW,
      startMode: motor.startMode,
      lastFailureReason: motor.lastFailureReason,
    }));
    sample.startingMotorCount = this.motorBank.startingCount;
    sample.runningMotorCount = this.motorBank.runningCount;
    sample.motorLoadMW = this.motorBank.outputMW;

    return sample;
  }
}
