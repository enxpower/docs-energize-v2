import { DieselGenerator, DIESEL_STATE } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { buildForecastEnvelope } from '../forecast/load-forecast.js';
import { evaluateGeneratorCommitment } from '../controls/generator-commitment.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runningUnit(id, outputMW = 3.0) {
  const dg = new DieselGenerator({ id, ratedMW: 3.3, minLoadPU: 0.35 });
  dg.emsSetpointMW = outputMW;
  dg.governorCommandMW = outputMW;
  dg.mechanicalMW = outputMW;
  dg.outputMW = outputMW;
  return dg;
}

function offUnit(id) {
  return new DieselGenerator({
    id,
    ratedMW: 3.3,
    initialState: DIESEL_STATE.OFF,
    minDownSeconds: 0,
    startDelaySeconds: 30,
    warmupSeconds: 60,
  });
}

export function testUncertaintyDrivesPreStart() {
  const fleet = [runningUnit('DG-1'), runningUnit('DG-2'), offUnit('DG-3')];
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const envelope = buildForecastEnvelope({
    p50LoadMW: 6.0,
    uncertaintyMW: 1.0,
    securityMarginMW: 0.2,
  });

  const decision = evaluateGeneratorCommitment({
    loadMW: 5.8,
    forecastLoadMW: envelope.p50LoadMW,
    forecastPlanningLoadMW: envelope.planningLoadMW,
    forecastHorizonSeconds: 180,
    forecastRiskLevel: envelope.riskLevel,
    forecastErrorMW: envelope.forecastErrorMW,
    dieselFleet: fleet,
    bess,
    allowStop: false,
  });

  assert(envelope.p50LoadMW <= decision.availableByForecastMW, 'P50 should fit existing forecast capacity');
  assert(envelope.planningLoadMW > decision.availableByForecastMW, 'planning upper bound should exceed existing capacity');
  assert(decision.action?.type === 'START', `expected START, received ${decision.action?.type ?? 'none'}`);
  assert(decision.action?.uncertaintyDriven === true, 'start decision should be marked uncertainty-driven');
  assert(decision.forecastCapacityShortfallMW > 0, 'forecast upper-bound shortfall was not detected');

  return {
    name: 'Forecast uncertainty drives preventive start',
    status: 'PASS',
    metrics: {
      p50LoadMW: envelope.p50LoadMW,
      forecastErrorMW: envelope.forecastErrorMW,
      planningLoadMW: envelope.planningLoadMW,
      riskLevel: envelope.riskLevel,
      availableByForecastMW: decision.availableByForecastMW,
      forecastShortfallMW: decision.forecastCapacityShortfallMW,
      action: decision.action,
    },
  };
}

export function testUncertaintyBlocksUnsafeStop() {
  const fleet = [runningUnit('DG-1', 2.0), runningUnit('DG-2', 2.0), runningUnit('DG-3', 2.0)];
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const envelope = buildForecastEnvelope({
    p50LoadMW: 4.5,
    uncertaintyMW: 2.0,
    securityMarginMW: 0.5,
  });

  const decision = evaluateGeneratorCommitment({
    loadMW: 4.0,
    forecastLoadMW: envelope.p50LoadMW,
    forecastPlanningLoadMW: envelope.planningLoadMW,
    forecastHorizonSeconds: 300,
    forecastRiskLevel: envelope.riskLevel,
    forecastErrorMW: envelope.forecastErrorMW,
    dieselFleet: fleet,
    bess,
    minimumOnlineUnits: 2,
    allowStop: true,
  });

  assert(envelope.p50LoadMW < 6.6, 'P50 should appear compatible with two remaining units');
  assert(envelope.planningLoadMW > 6.6, 'planning upper bound should require all three units');
  assert(decision.action?.type !== 'STOP', 'uncertainty-aware controller allowed an unsafe stop');

  return {
    name: 'Forecast uncertainty blocks unsafe stop',
    status: 'PASS',
    metrics: {
      p50LoadMW: envelope.p50LoadMW,
      forecastErrorMW: envelope.forecastErrorMW,
      planningLoadMW: envelope.planningLoadMW,
      riskLevel: envelope.riskLevel,
      action: decision.action,
      requiredForecastMW: decision.requiredForecastMW,
    },
  };
}
