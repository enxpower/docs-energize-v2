import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { UflsController } from '../controls/ufls.js';
import { UflsEnabledSimulationEngine } from '../core/ufls-enabled-engine.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createUflsScenario() {
  const load = new AggregateLoad({
    baseMW: 12,
    shedBlocks: [
      { id: 'CRUSHER-AUX', name: 'Crusher auxiliaries', mw: 1.0, priority: 1, critical: false },
      { id: 'VENT-NONCRITICAL', name: 'Noncritical ventilation', mw: 1.2, priority: 2, critical: false },
      { id: 'PROCESS-CRITICAL', name: 'Critical process load', mw: 0.8, priority: 3, critical: true },
    ],
  });
  const dieselFleet = createDieselFleet([1, 2, 3].map((n) => ({
    id: `DG-${n}`,
    ratedMW: 3.3,
    minLoadPU: 0.35,
    rampUpMWPerS: 0.2,
    rampDownMWPerS: 1.0,
    inertiaSeconds: 4,
  })));
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = 3.3;
    dg.governorCommandMW = 3.3;
    dg.mechanicalMW = 3.3;
    dg.outputMW = 3.3;
  }
  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const uflsController = new UflsController({
    stages: [
      { id: 'UFLS-1', thresholdHz: 59.2, delaySeconds: 0.4, allowCritical: false },
      { id: 'UFLS-2', thresholdHz: 58.8, delaySeconds: 0.3, allowCritical: false },
      { id: 'UFLS-3', thresholdHz: 58.4, delaySeconds: 0.2, allowCritical: true },
    ],
    minimumRestoreDelaySeconds: 60,
  });
  return new UflsEnabledSimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    uflsController,
    commitmentEnabled: false,
  });
}

export function testStagedUflsResponse() {
  const engine = createUflsScenario();
  engine.start();
  for (let i = 0; i < 300; i += 1) engine.step();

  const events = engine.events.filter((event) => event.type === 'UFLS_STAGE_OPERATED');
  const effectiveEvents = events.filter((event) => event.shedMW > 0);
  const final = engine.history.at(-1);

  assert(effectiveEvents.length >= 2, `expected at least two effective UFLS operations, received ${effectiveEvents.length}`);
  assert(effectiveEvents[0].shedBlockId === 'CRUSHER-AUX', `wrong first shed block: ${effectiveEvents[0].shedBlockId}`);
  assert(effectiveEvents[1].shedBlockId === 'VENT-NONCRITICAL', `wrong second shed block: ${effectiveEvents[1].shedBlockId}`);
  assert(effectiveEvents.slice(0, 2).every((event) => !event.criticalLoadShed), 'critical load was shed before noncritical stages');
  assert(final.shedLoadMW >= 2.2 - 1e-9, `insufficient load shed: ${final.shedLoadMW}`);
  assert(final.eensMWh > 0, 'EENS did not accumulate after explicit load shedding');
  assert(final.eensMWh <= final.shedLoadMW * final.timeSeconds / 3600 + 1e-9, 'EENS exceeds explicit shed-energy upper bound');

  return {
    name: 'Staged UFLS response and explicit EENS',
    status: 'PASS',
    metrics: {
      operations: effectiveEvents,
      finalFrequencyHz: final.frequencyHz,
      demandMW: final.demandMW,
      connectedLoadMW: final.connectedLoadMW,
      shedLoadMW: final.shedLoadMW,
      eensMWh: final.eensMWh,
      criticalLoadShed: effectiveEvents.some((event) => event.criticalLoadShed),
    },
  };
}

export function testUflsDelayReset() {
  const load = new AggregateLoad({
    baseMW: 5,
    shedBlocks: [{ id: 'BLOCK-1', mw: 1, priority: 1, critical: false }],
  });
  const controller = new UflsController({
    stages: [{ id: 'UFLS-1', thresholdHz: 59, delaySeconds: 0.5, allowCritical: false }],
  });

  for (let i = 0; i < 4; i += 1) {
    controller.evaluate({ frequencyHz: 58.9, residualMW: -1, dtSeconds: 0.1, load, timeSeconds: i * 0.1 });
  }
  controller.evaluate({ frequencyHz: 59.5, residualMW: -1, dtSeconds: 0.1, load, timeSeconds: 0.4 });
  const events = [];
  for (let i = 0; i < 4; i += 1) {
    events.push(...controller.evaluate({ frequencyHz: 58.9, residualMW: -1, dtSeconds: 0.1, load, timeSeconds: 0.5 + i * 0.1 }));
  }

  assert(load.shedMW === 0, 'UFLS timer failed to reset after frequency recovery');
  assert(events.length === 0, 'UFLS operated before the restarted delay expired');

  return {
    name: 'UFLS definite-time delay reset',
    status: 'PASS',
    metrics: { shedLoadMW: load.shedMW, events: events.length },
  };
}

export function testEensCappedByCurrentDemand() {
  const load = new AggregateLoad({
    baseMW: 1,
    shedBlocks: [{ id: 'OVERSIZED-BLOCK', mw: 3, priority: 1, critical: false }],
  });
  load.shedBlock('OVERSIZED-BLOCK', 0);

  assert(load.shedMW === 3, `nominal shed block should remain traceable: ${load.shedMW}`);
  assert(load.explicitUnservedMW === 1, `explicit unserved load should be capped by demand: ${load.explicitUnservedMW}`);
  assert(load.connectedMW === 0, `connected load should not become negative: ${load.connectedMW}`);

  load.setDemandMW(0.4);
  assert(load.explicitUnservedMW === 0.4, `unserved load did not follow reduced demand: ${load.explicitUnservedMW}`);

  return {
    name: 'EENS input capped by current explicit demand',
    status: 'PASS',
    metrics: {
      nominalShedBlockMW: load.shedMW,
      currentDemandMW: load.commandMW,
      explicitUnservedMW: load.explicitUnservedMW,
      connectedMW: load.connectedMW,
    },
  };
}
