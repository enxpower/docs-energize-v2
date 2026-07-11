import { AggregateLoad } from '../equipment/load.js';
import { MotorLoad, MotorLoadBank, MOTOR_START_MODE, MOTOR_STATE } from '../equipment/motor-load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { UflsController } from '../controls/ufls.js';
import { LoadRestorationController } from '../controls/load-restoration.js';
import { UflsEnabledSimulationEngine } from '../core/ufls-enabled-engine.js';

function dieselConfig(id) {
  return {
    id,
    ratedMW: 3.3,
    minLoadPU: 0.35,
    rampUpMWPerS: 0.2,
    rampDownMWPerS: 1.0,
    inertiaSeconds: 4,
    droopPU: 0.04,
    governorTimeConstantSeconds: 0.25,
    engineTimeConstantSeconds: 0.8,
    frequencyDeadbandHz: 0.025,
    nominalHz: 60,
    startDelaySeconds: 30,
    warmupSeconds: 60,
    cooldownSeconds: 30,
    minRunSeconds: 600,
    minDownSeconds: 300,
  };
}

export function createMinimumMiningAcceptanceScenario() {
  const processMotor = new MotorLoad({
    id: 'SLURRY-PUMP-A',
    name: 'Slurry Pump A',
    ratedMW: 1.5,
    startMode: MOTOR_START_MODE.VFD,
    startPowerPU: 1.10,
    accelerationSeconds: 20,
    minimumOffSeconds: 60,
    abortFrequencyHz: 58.5,
    abortDelaySeconds: 0.3,
    initialState: MOTOR_STATE.RUNNING,
  });
  const motorBank = new MotorLoadBank({ motors: [processMotor] });

  const load = new AggregateLoad({
    baseMW: 10.5,
    dynamicLoads: [motorBank],
    shedBlocks: [
      {
        id: 'CRUSHER-AUX',
        name: 'Crusher auxiliaries',
        mw: 1.0,
        priority: 1,
        critical: false,
        coldLoadPickupPU: 0.20,
        coldLoadPickupSeconds: 10,
      },
      {
        id: 'VENT-NONCRITICAL',
        name: 'Noncritical ventilation',
        mw: 1.2,
        priority: 2,
        critical: false,
        coldLoadPickupPU: 0.15,
        coldLoadPickupSeconds: 8,
      },
      {
        id: 'CONTROL-CRITICAL',
        name: 'Critical controls and safety systems',
        mw: 0.8,
        priority: 3,
        critical: true,
        coldLoadPickupPU: 0.05,
        coldLoadPickupSeconds: 5,
      },
    ],
  });

  const dieselFleet = createDieselFleet([1, 2, 3, 4].map((n) => dieselConfig(`DG-${n}`)));
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = 3.0;
    dg.governorCommandMW = 3.0;
    dg.mechanicalMW = 3.0;
    dg.outputMW = 3.0;
  }

  const bess = new Bess({
    powerMW: 8,
    energyMWh: 20,
    initialSoc: 0.60,
    minSoc: 0.18,
    maxSoc: 0.82,
    roundTripEfficiency: 0.965,
    rampMWPerS: 8,
    lowSocDeratingBand: 0.12,
    highSocDeratingBand: 0.12,
  });

  const uflsController = new UflsController({
    stages: [
      { id: 'UFLS-1', thresholdHz: 59.2, delaySeconds: 0.4, allowCritical: false },
      { id: 'UFLS-2', thresholdHz: 58.8, delaySeconds: 0.3, allowCritical: false },
      { id: 'UFLS-3', thresholdHz: 58.4, delaySeconds: 0.2, allowCritical: true },
    ],
    resetHz: 59.8,
    minimumRestoreDelaySeconds: 5,
  });

  const restorationController = new LoadRestorationController({
    restoreFrequencyHz: 59.85,
    maximumDeficitMW: 0.08,
    stableHoldSeconds: 5,
    minimumRestoreIntervalSeconds: 5,
    maximumRestoreBlockMW: 1.5,
    minimumPostRestoreReserveMW: 0.5,
    rollbackFrequencyHz: 59.3,
    rollbackObservationSeconds: 5,
    rollbackLockoutSeconds: 30,
  });

  const engine = new UflsEnabledSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    uflsController,
    restorationController,
    restorationEnabled: true,
    emsIntervalSeconds: 20,
    emsLoadChangeTriggerMW: 0.25,
    bessSecondaryBalanceGainPerSecond: 0.35,
    commitmentEnabled: false,
  });

  return {
    engine,
    load,
    dieselFleet,
    bess,
    processMotor,
    motorBank,
    uflsController,
    restorationController,
  };
}
