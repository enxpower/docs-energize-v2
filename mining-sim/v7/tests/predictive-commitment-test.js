import { AggregateLoad } from '../equipment/load.js';
import { DieselGenerator, DIESEL_STATE } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { PiecewiseLoadForecast } from '../forecast/load-forecast.js';
import { SimulationEngine } from '../core/simulation-engine.js';
import { evaluateGeneratorCommitment } from '../controls/generator-commitment.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

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
  };
}

function makeFleet({ offlineLeadSeconds = 90 } = {}) {
  const online = [1, 2].map((n) => {
    const dg = new DieselGenerator(dieselConfig(`DG-${n}`));
    dg.emsSetpointMW = 2.75;
    dg.governorCommandMW = 2.75;
    dg.mechanicalMW = 2.75;
    dg.outputMW = 2.75;
    return dg;
  });
  online.push(new DieselGenerator({
    ...dieselConfig('DG-3'),
    initialState: DIESEL_STATE.OFF,
    minDownSeconds: 0,
    startDelaySeconds: Math.max(0, offlineLeadSeconds - 60),
    warmupSeconds: Math.min(60, offlineLeadSeconds),
  }));
  return online;
}

export function testPredictiveCommitmentStartsOnTime() {
  const load = new AggregateLoad({ baseMW: 5.5 });
  const fleet = makeFleet({ offlineLeadSeconds: 90 });
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const forecast = new PiecewiseLoadForecast({
    fallbackMW: 5.5,
    points: [
      { timeSeconds: 0, loadMW: 5.5 },
      { timeSeconds: 120, loadMW: 8.5 },
    ],
  });
  const engine = new SimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 8.5,
    load,
    dieselFleet: fleet,
    bess,
    loadForecast: forecast,
    commitmentIntervalSeconds: 30,
    commitmentLookAheadSeconds: 180,
    commitmentAllowStop: false,
  });

  engine.start();
  runFor(engine, 1);
  const startEvent = engine.events.find((event) => event.type === 'DG_START_REQUEST');
  assert(startEvent, 'predictive start event was not created');
  assert(startEvent.predictive === true, 'start event was not marked predictive');
  assert(startEvent.predictedReadyOnTime === true, 'generator should be predicted ready on time');

  runFor(engine, 99);
  assert(fleet[2].state === DIESEL_STATE.RUNNING, `DG-3 should be RUNNING before load rise, received ${fleet[2].state}`);

  runFor(engine, 20);
  const preRise = engine.history.at(-1);
  load.setDemandMW(8.5);
  const disturbanceTime = engine.timeSeconds;
  const firstAfterRise = engine.step();
  assert(
    firstAfterRise.dieselEmsSetpointMW >= 8.49,
    `event-triggered EMS did not assume load rise: pre=${preRise.dieselEmsSetpointMW}, first=${firstAfterRise.dieselEmsSetpointMW}`,
  );

  const afterRise = runFor(engine, 59.9);
  const settledWindow = engine.history.filter(
    (sample) => sample.timeSeconds >= disturbanceTime + 50
      && sample.timeSeconds <= disturbanceTime + 60 + 1e-9,
  );
  const maxSettledResidualMW = Math.max(...settledWindow.map((sample) => Math.abs(sample.residualMW)));
  const maxSettledFrequencyErrorHz = Math.max(...settledWindow.map((sample) => Math.abs(sample.frequencyHz - 60)));
  const fleetDiagnostics = fleet.map((dg) => ({
    id: dg.id,
    state: dg.state,
    emsSetpointMW: dg.emsSetpointMW,
    governorCommandMW: dg.governorCommandMW,
    mechanicalMW: dg.mechanicalMW,
    outputMW: dg.outputMW,
    runTimeSeconds: dg.runTimeSeconds,
  }));

  assert(afterRise.onlineDieselCount === 3, `expected 3 online units, received ${afterRise.onlineDieselCount}`);
  assert(
    maxSettledResidualMW < 0.25,
    `forecast-prepared system did not settle power balance: maxResidual=${maxSettledResidualMW}, finalResidual=${afterRise.residualMW}, finalFrequency=${afterRise.frequencyHz}, fleet=${JSON.stringify(fleetDiagnostics)}`,
  );
  assert(
    maxSettledFrequencyErrorHz < 0.15,
    `forecast-prepared system did not settle frequency: maxError=${maxSettledFrequencyErrorHz}, finalFrequency=${afterRise.frequencyHz}`,
  );

  return {
    name: 'Predictive commitment starts generator before load rise',
    status: 'PASS',
    metrics: {
      startEvent,
      dg3StateBeforeRise: fleet[2].state,
      preRiseEmsSetpointMW: preRise.dieselEmsSetpointMW,
      firstAfterRiseEmsSetpointMW: firstAfterRise.dieselEmsSetpointMW,
      onlineDieselCountAfterRise: afterRise.onlineDieselCount,
      maxSettledResidualMW,
      maxSettledFrequencyErrorHz,
      residualMWAfterRise: afterRise.residualMW,
      dieselMWAfterRise: afterRise.dieselMW,
      frequencyHzAfterRise: afterRise.frequencyHz,
      fleetDiagnostics,
    },
  };
}

export function testPredictiveCommitmentFlagsLateReadiness() {
  const fleet = makeFleet({ offlineLeadSeconds: 180 });
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const decision = evaluateGeneratorCommitment({
    loadMW: 5.5,
    forecastLoadMW: 8.5,
    forecastHorizonSeconds: 60,
    dieselFleet: fleet,
    bess,
    allowStop: false,
  });

  assert(decision.action?.type === 'START', `expected START decision, received ${decision.action?.type ?? 'none'}`);
  assert(decision.action.predictive === true, 'late-readiness action should still be predictive');
  assert(decision.action.predictedReadyOnTime === false, 'late unit was incorrectly marked ready on time');
  assert(decision.forecastCapacityShortfallMW > 0, 'forecast capacity shortfall was not detected');

  return {
    name: 'Predictive commitment flags insufficient start lead time',
    status: 'PASS',
    metrics: {
      forecastLoadMW: decision.forecastLoadMW,
      forecastHorizonSeconds: decision.forecastHorizonSeconds,
      forecastCapacityShortfallMW: decision.forecastCapacityShortfallMW,
      action: decision.action,
    },
  };
}
