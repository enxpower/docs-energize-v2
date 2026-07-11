const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const uniqueIds = (items, label) => {
  const ids = items.map((item) => String(item.id ?? ''));
  if (ids.some((id) => !id)) throw new Error(`${label} requires non-empty ids`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ids must be unique`);
  return new Set(ids);
};

export function validateScenarioConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Scenario config must be an object');
  if (!config.id) throw new Error('Scenario config requires id');
  if (!finitePositive(config.simulation?.dtSeconds)) throw new Error('simulation.dtSeconds must be > 0');
  if (!finitePositive(config.simulation?.durationSeconds)) throw new Error('simulation.durationSeconds must be > 0');
  if (!finitePositive(config.site?.systemBaseMW)) throw new Error('site.systemBaseMW must be > 0');
  if (!Number.isFinite(Number(config.site?.baseLoadMW)) || Number(config.site.baseLoadMW) < 0) {
    throw new Error('site.baseLoadMW must be >= 0');
  }

  const diesel = config.equipment?.diesel ?? [];
  const motors = config.equipment?.motors ?? [];
  const productionLoads = config.equipment?.productionLoads ?? [];
  if (!diesel.length) throw new Error('At least one diesel generator is required');
  if (!motors.length) throw new Error('At least one motor is required');
  if (!productionLoads.length) throw new Error('At least one production load is required');
  const dieselIds = uniqueIds(diesel, 'Diesel generators');
  const motorIds = uniqueIds(motors, 'Motors');
  uniqueIds(productionLoads, 'Production loads');

  for (const unit of diesel) {
    if (!finitePositive(unit.ratedMW)) throw new Error(`Diesel ${unit.id} ratedMW must be > 0`);
  }
  for (const motor of motors) {
    if (!finitePositive(motor.ratedMW)) throw new Error(`Motor ${motor.id} ratedMW must be > 0`);
  }
  for (const load of productionLoads) {
    if (!finitePositive(load.normalMW)) throw new Error(`Production load ${load.id} normalMW must be > 0`);
    if (Number(load.minimumMW ?? 0) < 0 || Number(load.minimumMW ?? 0) > Number(load.normalMW)) {
      throw new Error(`Production load ${load.id} minimumMW must be between 0 and normalMW`);
    }
  }

  const steps = config.process?.steps ?? [];
  if (!steps.length) throw new Error('process.steps requires at least one step');
  uniqueIds(steps, 'Process steps');
  for (const step of steps) {
    if (!motorIds.has(String(step.motorId))) throw new Error(`Process step ${step.id} references unknown motor ${step.motorId}`);
  }

  const supportedActions = new Set([
    'DIESEL_TRIP', 'DIESEL_RESET', 'BESS_TRIP', 'BESS_RESTORE', 'SET_BASE_LOAD',
    'SET_PROCESS_CONDITION', 'PROCESS_START', 'PROCESS_TRIP', 'MOTOR_START_REQUEST',
  ]);
  for (const action of config.disturbances ?? []) {
    if (!supportedActions.has(action.type)) throw new Error(`Unsupported disturbance type: ${action.type}`);
    if (!Number.isFinite(Number(action.timeSeconds)) || Number(action.timeSeconds) < 0) {
      throw new Error(`Disturbance ${action.id ?? action.type} requires timeSeconds >= 0`);
    }
    if (action.type.startsWith('DIESEL_') && !dieselIds.has(String(action.targetId))) {
      throw new Error(`Disturbance references unknown diesel ${action.targetId}`);
    }
    if (action.type === 'MOTOR_START_REQUEST' && !motorIds.has(String(action.targetId))) {
      throw new Error(`Disturbance references unknown motor ${action.targetId}`);
    }
  }
  return config;
}

export function compileScenarioActions(config) {
  validateScenarioConfig(config);
  return (config.disturbances ?? []).map((action, index) => ({
    id: action.id ?? `${action.type}-${index + 1}`,
    timeSeconds: Number(action.timeSeconds),
    apply(engine) {
      switch (action.type) {
        case 'DIESEL_TRIP': {
          const unit = engine.dieselFleet.find((candidate) => candidate.id === action.targetId);
          unit.trip();
          return { type: action.type, targetId: action.targetId };
        }
        case 'DIESEL_RESET': {
          const unit = engine.dieselFleet.find((candidate) => candidate.id === action.targetId);
          return { type: action.type, targetId: action.targetId, reset: unit.resetTripToOff() };
        }
        case 'BESS_TRIP': return { type: action.type, preTripMW: engine.bess.trip() };
        case 'BESS_RESTORE': engine.bess.restore(); return { type: action.type };
        case 'SET_BASE_LOAD': engine.load.setDemandMW(Number(action.valueMW)); return { type: action.type, valueMW: Number(action.valueMW) };
        case 'SET_PROCESS_CONDITION': return engine.setProcessCondition(action.conditionId, Boolean(action.ready));
        case 'PROCESS_START': return engine.requestProcessStart(action.reason ?? 'SCENARIO_ACTION');
        case 'PROCESS_TRIP': return engine.tripProcessSequence({ tripClass: action.tripClass, reason: action.reason ?? 'SCENARIO_ACTION' });
        case 'MOTOR_START_REQUEST': return engine.requestMotorStart({
          motorId: action.targetId,
          priority: action.priority ?? 1,
          deadlineSeconds: action.deadlineSeconds ?? Infinity,
          reason: action.reason ?? 'SCENARIO_ACTION',
        });
        default: throw new Error(`Unsupported disturbance type: ${action.type}`);
      }
    },
  }));
}
