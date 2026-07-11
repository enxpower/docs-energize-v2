export class MotorStartController {
  constructor({
    minimumStartFrequencyHz = 59.5,
    maximumResidualDeficitMW = 0.1,
    minimumPostStartReserveMW = 0.5,
    minimumStartIntervalSeconds = 30,
    maximumConcurrentStarts = 1,
  } = {}) {
    this.minimumStartFrequencyHz = minimumStartFrequencyHz;
    this.maximumResidualDeficitMW = Math.max(0, maximumResidualDeficitMW);
    this.minimumPostStartReserveMW = Math.max(0, minimumPostStartReserveMW);
    this.minimumStartIntervalSeconds = Math.max(0, minimumStartIntervalSeconds);
    this.maximumConcurrentStarts = Math.max(1, Math.floor(maximumConcurrentStarts));
    this.lastStartSeconds = -Infinity;
  }

  evaluatePermissive({ motor, motorBank, frequencyHz, residualMW, reserve60MW, timeSeconds }) {
    const reasons = [];
    if (!motor?.isStartable) reasons.push('MOTOR_NOT_STARTABLE');
    if (frequencyHz < this.minimumStartFrequencyHz) reasons.push('FREQUENCY_BELOW_START_PERMISSIVE');
    if (Math.max(0, -residualMW) > this.maximumResidualDeficitMW) reasons.push('ACTIVE_POWER_DEFICIT_PRESENT');
    if ((motorBank?.startingCount ?? 0) >= this.maximumConcurrentStarts) reasons.push('MAXIMUM_CONCURRENT_STARTS_REACHED');
    if (timeSeconds - this.lastStartSeconds < this.minimumStartIntervalSeconds) reasons.push('MINIMUM_START_INTERVAL_NOT_ELAPSED');

    const requiredReserveMW = (motor?.initialPickupMW ?? Infinity) + this.minimumPostStartReserveMW;
    if (reserve60MW + 1e-9 < requiredReserveMW) reasons.push('INSUFFICIENT_60_SECOND_RESERVE');

    return {
      permitted: reasons.length === 0,
      reasons,
      requiredReserveMW,
      availableReserveMW: reserve60MW,
      estimatedInitialPickupMW: motor?.initialPickupMW ?? null,
    };
  }

  requestStart({ motor, motorBank, frequencyHz, residualMW, reserve60MW, timeSeconds }) {
    const permissive = this.evaluatePermissive({
      motor,
      motorBank,
      frequencyHz,
      residualMW,
      reserve60MW,
      timeSeconds,
    });

    if (!permissive.permitted) {
      return {
        timeSeconds,
        type: 'MOTOR_START_BLOCKED',
        motorId: motor?.id ?? null,
        startMode: motor?.startMode ?? null,
        ...permissive,
      };
    }

    const accepted = motor.requestStart(timeSeconds);
    if (!accepted) {
      return {
        timeSeconds,
        type: 'MOTOR_START_BLOCKED',
        motorId: motor.id,
        startMode: motor.startMode,
        permitted: false,
        reasons: ['MOTOR_REJECTED_START_REQUEST'],
        requiredReserveMW: permissive.requiredReserveMW,
        availableReserveMW: reserve60MW,
        estimatedInitialPickupMW: motor.initialPickupMW,
      };
    }

    this.lastStartSeconds = timeSeconds;
    return {
      timeSeconds,
      type: 'MOTOR_START_ACCEPTED',
      motorId: motor.id,
      motorName: motor.name,
      startMode: motor.startMode,
      ratedMW: motor.ratedMW,
      estimatedInitialPickupMW: motor.initialPickupMW,
      accelerationSeconds: motor.accelerationSeconds,
      requiredReserveMW: permissive.requiredReserveMW,
      availableReserveMW: reserve60MW,
    };
  }
}
