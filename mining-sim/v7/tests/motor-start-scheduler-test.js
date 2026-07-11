import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { MotorStartController } from '../controls/motor-start.js';
import { MotorStartScheduler, MOTOR_START_REQUEST_STATE } from '../controls/motor-start-scheduler.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createScheduler({ retryDelaySeconds = 10, maximumAttempts = 3 } = {}) {
  const controller = new MotorStartController({
    minimumStartFrequencyHz: 59.5,
    minimumPostStartReserveMW: 0.5,
    minimumStartIntervalSeconds: 0,
    maximumConcurrentStarts: 1,
  });
  return new MotorStartScheduler({ controller, retryDelaySeconds, maximumAttempts });
}

export function testMotorSchedulerPriorityAndDeadline() {
  const crusher = new MotorLoad({ id: 'CRUSHER', ratedMW: 1.5, startMode: MOTOR_START_MODE.VFD, minimumOffSeconds: 0 });
  const vent = new MotorLoad({ id: 'VENT', ratedMW: 0.8, startMode: MOTOR_START_MODE.VFD, minimumOffSeconds: 0 });
  const bank = new MotorLoadBank({ motors: [crusher, vent] });
  const scheduler = createScheduler();

  const low = scheduler.enqueue({ motor: vent, priority: 2, requestedAtSeconds: 0, deadlineSeconds: 120 });
  const high = scheduler.enqueue({ motor: crusher, priority: 5, requestedAtSeconds: 0, deadlineSeconds: 60 });
  const events = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 4,
    timeSeconds: 0,
  });

  const accepted = events.find((event) => event.type === 'MOTOR_START_ACCEPTED');
  assert(accepted?.motorId === 'CRUSHER', `highest-priority motor was not selected: ${accepted?.motorId ?? 'none'}`);
  assert(high.state === MOTOR_START_REQUEST_STATE.STARTED, `high-priority request state: ${high.state}`);
  assert(low.state === MOTOR_START_REQUEST_STATE.QUEUED, `lower-priority request should remain queued: ${low.state}`);

  return {
    name: 'Motor scheduler priority and deadline ordering',
    status: 'PASS',
    metrics: { accepted, queue: scheduler.snapshot() },
  };
}

export function testMotorSchedulerReserveDelayAndRetry() {
  const pump = new MotorLoad({ id: 'SLURRY-PUMP', ratedMW: 1.2, startMode: MOTOR_START_MODE.SOFT_STARTER, minimumOffSeconds: 0 });
  const bank = new MotorLoadBank({ motors: [pump] });
  const scheduler = createScheduler({ retryDelaySeconds: 15, maximumAttempts: 3 });
  const request = scheduler.enqueue({ motor: pump, priority: 4, requestedAtSeconds: 0, deadlineSeconds: 120 });

  const blocked = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 1,
    timeSeconds: 0,
  });
  const blockedEvent = blocked.find((event) => event.type === 'MOTOR_START_BLOCKED');
  assert(blockedEvent?.reasons.includes('INSUFFICIENT_60_SECOND_RESERVE'), 'reserve block reason missing');
  assert(blockedEvent.retryEligibleAtSeconds === 15, `unexpected retry time: ${blockedEvent.retryEligibleAtSeconds}`);

  const tooEarly = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 4,
    timeSeconds: 10,
  });
  assert(!tooEarly.some((event) => event.type === 'MOTOR_START_ACCEPTED'), 'scheduler retried before retry delay');

  const acceptedEvents = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 4,
    timeSeconds: 15,
  });
  const accepted = acceptedEvents.find((event) => event.type === 'MOTOR_START_ACCEPTED');
  assert(accepted?.motorId === pump.id, 'motor was not started after reserve recovered');
  assert(accepted.attempts === 2, `unexpected attempt count: ${accepted.attempts}`);
  assert(request.state === MOTOR_START_REQUEST_STATE.STARTED, `request state: ${request.state}`);

  return {
    name: 'Motor scheduler reserve delay and retry',
    status: 'PASS',
    metrics: { blockedEvent, accepted, queue: scheduler.snapshot() },
  };
}

export function testMotorSchedulerExpiry() {
  const fan = new MotorLoad({ id: 'AUX-FAN', ratedMW: 0.5, startMode: MOTOR_START_MODE.VFD, minimumOffSeconds: 0 });
  const bank = new MotorLoadBank({ motors: [fan] });
  const scheduler = createScheduler();
  const request = scheduler.enqueue({ motor: fan, priority: 1, requestedAtSeconds: 0, earliestStartSeconds: 5, deadlineSeconds: 8 });

  const beforeEarliest = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 3,
    timeSeconds: 4,
  });
  assert(beforeEarliest.length === 0, 'request was processed before earliest start');

  const expiredEvents = scheduler.evaluate({
    motorBank: bank,
    frequencyHz: 60,
    residualMW: 0,
    reserve60MW: 3,
    timeSeconds: 9,
  });
  const expired = expiredEvents.find((event) => event.type === 'MOTOR_START_REQUEST_EXPIRED');
  assert(expired?.motorId === fan.id, 'deadline expiry event missing');
  assert(request.state === MOTOR_START_REQUEST_STATE.EXPIRED, `request state: ${request.state}`);
  assert(fan.state === MOTOR_STATE.OFF, `expired motor unexpectedly started: ${fan.state}`);

  return {
    name: 'Motor scheduler deadline expiry',
    status: 'PASS',
    metrics: { expired, queue: scheduler.snapshot() },
  };
}
