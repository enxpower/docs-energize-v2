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

function makeFleet({ offlineLeadSeconds = 90 } = {}) {
  const online = [1, 2].map((n) => {
    const dg = new DieselGenerator({ id: `DG-${n}`, ratedMW: 3.3 });
    dg.emsSetpointMW = 2.75;
    dg.governorCommandMW = 2.75;
    dg.mechanicalMW = 2.75;
    dg.outputMW = 2.75;
    return dg;
  });
  online.push(new DieselGenerator({
    id: 'DG-3',
    ratedMW: 3.3,
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
  load.setDemandMW(8.5);
  const afterRise = runFor(engine, 20);
  assert(afterRise.onlineDieselCount === 3, `expected 3 online units, received ${afterRise.onlineDieselCount}`);
  assert(Math.abs(afterRise.residualMW) < 0.25, `forecast-prepared system failed load rise: ${afterRise.residualMW}`);

  return {
    name: 'Predictive commitment starts generator before load rise',
    status: 'PASS',
    metrics: {
      startEvent,
      dg3StateBeforeRise: fleet[2].state,
      onlineDieselCountAfterRise: afterRise.onlineDieselCount,
      residualMWAfterRise: afterRise.residualMW,
      frequencyHzAfterRise: afterRise.frequencyHz,
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
