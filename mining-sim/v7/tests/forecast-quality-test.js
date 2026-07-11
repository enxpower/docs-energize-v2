import { DieselGenerator } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { AggregateLoad } from '../equipment/load.js';
import { PiecewiseLoadForecast } from '../forecast/load-forecast.js';
import { assessForecastQuality } from '../forecast/forecast-quality.js';
import { SimulationEngine } from '../core/simulation-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runningFleet(count = 3, outputMW = 2.0) {
  return Array.from({ length: count }, (_, index) => {
    const dg = new DieselGenerator({ id: `DG-${index + 1}`, ratedMW: 3.3, minLoadPU: 0.35 });
    dg.emsSetpointMW = outputMW;
    dg.governorCommandMW = outputMW;
    dg.mechanicalMW = outputMW;
    dg.outputMW = outputMW;
    return dg;
  });
}

export function testFreshForecastAllowsNormalPolicy() {
  const forecast = {
    forecastPlanningLoadMW: 5.0,
    source: 'SHIFT_PLAN',
    generatedAtSeconds: 100,
    validUntilSeconds: 400,
    qualityGrade: 'A',
  };
  const quality = assessForecastQuality({ forecast, currentTimeSeconds: 150, currentLoadMW: 4.0 });

  assert(quality.status === 'FRESH', `expected FRESH, received ${quality.status}`);
  assert(quality.allowAutomaticStop === true, 'fresh A-grade forecast should allow normal stop policy evaluation');
  assert(Math.abs(quality.effectivePlanningLoadMW - 5.0) < 1e-9, 'fresh forecast planning load was altered');

  return {
    name: 'Fresh forecast preserves normal commitment policy',
    status: 'PASS',
    metrics: quality,
  };
}

export function testStaleForecastBlocksAutomaticStop() {
  const load = new AggregateLoad({ baseMW: 4.0 });
  const dieselFleet = runningFleet(3, 2.0);
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const loadForecast = new PiecewiseLoadForecast({
    points: [{ timeSeconds: 0, loadMW: 4.2, uncertaintyMW: 0.1 }],
    source: 'SHIFT_PLAN',
    generatedAtSeconds: 0,
    validForSeconds: 10,
    qualityGrade: 'A',
  });
  const engine = new SimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 10,
    load,
    dieselFleet,
    bess,
    loadForecast,
    commitmentEnabled: true,
    commitmentIntervalSeconds: 60,
    commitmentLookAheadSeconds: 300,
    commitmentAllowStop: true,
    minimumOnlineUnits: 2,
    forecastStaleFallbackMarginMW: 0.8,
  });
  engine.timeSeconds = 20;
  engine.nextCommitmentEvaluationSeconds = 0;
  engine.start();
  const sample = engine.step();

  assert(sample.forecastStatus === 'STALE', `expected STALE, received ${sample.forecastStatus}`);
  assert(sample.forecastAutomaticStopAllowed === false, 'stale forecast allowed automatic stop');
  assert(sample.commitmentStopBlockedByForecastQuality === true, 'commitment did not record forecast-quality stop block');
  assert(!engine.lastCommitmentDecision?.action || engine.lastCommitmentDecision.action.type !== 'STOP', 'stale forecast caused an unsafe stop request');
  assert(sample.forecastPlanningLoadMW >= 4.8 - 1e-9, `stale fallback margin not applied: ${sample.forecastPlanningLoadMW}`);

  return {
    name: 'Stale forecast blocks automatic decommitment',
    status: 'PASS',
    metrics: {
      forecastStatus: sample.forecastStatus,
      forecastAgeSeconds: sample.forecastAgeSeconds,
      effectivePlanningLoadMW: sample.forecastPlanningLoadMW,
      automaticStopAllowed: sample.forecastAutomaticStopAllowed,
      stopBlocked: sample.commitmentStopBlockedByForecastQuality,
      action: engine.lastCommitmentDecision?.action ?? null,
    },
  };
}

export function testLowQualityForecastAddsConservativeMargin() {
  const forecast = {
    forecastPlanningLoadMW: 6.0,
    source: 'MANUAL_ESTIMATE',
    generatedAtSeconds: 0,
    validUntilSeconds: 600,
    qualityGrade: 'D',
  };
  const quality = assessForecastQuality({
    forecast,
    currentTimeSeconds: 100,
    currentLoadMW: 5.0,
    lowQualityMarginMW: 0.3,
  });

  assert(quality.status === 'DEGRADED', `expected DEGRADED, received ${quality.status}`);
  assert(quality.allowAutomaticStop === false, 'D-grade forecast allowed automatic stop');
  assert(Math.abs(quality.degradationMarginMW - 0.6) < 1e-9, `unexpected D-grade margin: ${quality.degradationMarginMW}`);
  assert(Math.abs(quality.effectivePlanningLoadMW - 6.6) < 1e-9, `quality margin not added: ${quality.effectivePlanningLoadMW}`);

  return {
    name: 'Low-quality forecast adds conservative capacity margin',
    status: 'PASS',
    metrics: quality,
  };
}
