import { DieselGenerator, DIESEL_STATE } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { assessReserve } from '../reliability/reserve-engine.js';
import { evaluateGeneratorCommitment, applyGeneratorCommitmentAction } from '../controls/generator-commitment.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function testGeneratorStateMachine() {
  const dg = new DieselGenerator({
    id: 'DG-TEST',
    ratedMW: 3.3,
    initialState: DIESEL_STATE.OFF,
    minDownSeconds: 0,
    startDelaySeconds: 2,
    warmupSeconds: 3,
    minRunSeconds: 5,
    cooldownSeconds: 2,
  });

  assert(dg.isStartable, 'generator should be startable from OFF');
  assert(dg.requestStart(), 'start request rejected');
  assert(dg.state === DIESEL_STATE.STARTING, `expected STARTING, received ${dg.state}`);

  dg.step(1.9);
  assert(dg.state === DIESEL_STATE.STARTING, 'generator left STARTING too early');
  dg.step(0.2);
  assert(dg.state === DIESEL_STATE.WARMUP, `expected WARMUP, received ${dg.state}`);
  dg.step(3.0);
  assert(dg.state === DIESEL_STATE.RUNNING, `expected RUNNING, received ${dg.state}`);
  assert(Math.abs(dg.outputMW - dg.minimumMW) < 1e-9, 'generator did not synchronize at minimum load');

  dg.step(5.0);
  assert(dg.requestStop(), 'stop request rejected after minimum run time');
  assert(dg.state === DIESEL_STATE.COOLDOWN, `expected COOLDOWN, received ${dg.state}`);
  dg.step(2.0);
  assert(dg.state === DIESEL_STATE.OFF, `expected OFF, received ${dg.state}`);

  return {
    name: 'Generator commitment state machine',
    status: 'PASS',
    metrics: {
      finalState: dg.state,
      startDelaySeconds: dg.startDelaySeconds,
      warmupSeconds: dg.warmupSeconds,
      minRunSeconds: dg.minRunSeconds,
      cooldownSeconds: dg.cooldownSeconds,
    },
  };
}

export function testReserveN1Classification() {
  const fleet = [1, 2, 3].map((n) => {
    const dg = new DieselGenerator({ id: `DG-${n}`, ratedMW: 3.3, rampUpMWPerS: 0.2 });
    dg.emsSetpointMW = 3.0;
    dg.governorCommandMW = 3.0;
    dg.mechanicalMW = 3.0;
    dg.outputMW = 3.0;
    return dg;
  });
  fleet.push(new DieselGenerator({
    id: 'DG-4',
    ratedMW: 3.3,
    initialState: DIESEL_STATE.OFF,
    minDownSeconds: 0,
    startDelaySeconds: 20,
    warmupSeconds: 20,
  }));

  const bess = new Bess({ powerMW: 2, energyMWh: 4, initialSoc: 0.6 });
  const reserve = assessReserve({ dieselFleet: fleet, bess });

  assert(Math.abs(reserve.largestOnlineContingencyMW - 3.0) < 1e-9, `unexpected contingency size: ${reserve.largestOnlineContingencyMW}`);
  assert(reserve.fast10MW < reserve.largestOnlineContingencyMW, '10-second reserve should be insufficient in this test');
  assert(reserve.reserve60MW >= reserve.largestOnlineContingencyMW, '60-second reserve should cover the contingency');
  assert(reserve.n1Status === 'CONDITIONAL', `expected CONDITIONAL, received ${reserve.n1Status}`);

  return {
    name: 'Reserve engine N-1 classification',
    status: 'PASS',
    metrics: {
      largestOnlineContingencyMW: reserve.largestOnlineContingencyMW,
      fast10MW: reserve.fast10MW,
      reserve60MW: reserve.reserve60MW,
      reserve600MW: reserve.reserve600MW,
      n1Status: reserve.n1Status,
      n1CoverageRatio: reserve.n1CoverageRatio,
    },
  };
}

export function testCommitmentStartDecision() {
  const fleet = [1, 2].map((n) => {
    const dg = new DieselGenerator({ id: `DG-${n}`, ratedMW: 3.3 });
    dg.emsSetpointMW = 3.0;
    dg.governorCommandMW = 3.0;
    dg.mechanicalMW = 3.0;
    dg.outputMW = 3.0;
    return dg;
  });
  fleet.push(new DieselGenerator({
    id: 'DG-3',
    ratedMW: 3.3,
    initialState: DIESEL_STATE.OFF,
    minDownSeconds: 0,
    startDelaySeconds: 5,
    warmupSeconds: 5,
  }));

  const bess = new Bess({ powerMW: 0, energyMWh: 0, initialSoc: 0 });
  const decision = evaluateGeneratorCommitment({
    loadMW: 8.5,
    dieselFleet: fleet,
    bess,
    allowStop: false,
  });
  const applied = applyGeneratorCommitmentAction({ dieselFleet: fleet, decision });

  assert(decision.action?.type === 'START', `expected START decision, received ${decision.action?.type ?? 'none'}`);
  assert(decision.action?.equipmentId === 'DG-3', `unexpected start candidate: ${decision.action?.equipmentId}`);
  assert(applied?.accepted === true, 'start action was not accepted');
  assert(fleet[2].state === DIESEL_STATE.STARTING, `expected DG-3 STARTING, received ${fleet[2].state}`);

  return {
    name: 'Generator commitment start decision',
    status: 'PASS',
    metrics: {
      committedRatedMW: decision.committedRatedMW,
      requiredCommittedMW: decision.requiredCommittedMW,
      action: decision.action,
      applied,
      resultingState: fleet[2].state,
    },
  };
}
