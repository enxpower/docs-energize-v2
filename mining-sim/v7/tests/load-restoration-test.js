import { AggregateLoad } from '../equipment/load.js';
import { LoadRestorationController } from '../controls/load-restoration.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stabilize(controller, { load, startTimeSeconds = 0, steps = 3, reserve60MW = 3 }) {
  const events = [];
  for (let i = 1; i <= steps; i += 1) {
    events.push(...controller.evaluate({
      frequencyHz: 60,
      residualMW: 0,
      reserve60MW,
      dtSeconds: 0.1,
      load,
      timeSeconds: startTimeSeconds + i * 0.1,
      restorationPermitted: true,
    }));
  }
  return events;
}

export function testStagedLoadRestorationPriority() {
  const load = new AggregateLoad({
    baseMW: 6,
    shedBlocks: [
      { id: 'NONCRITICAL', mw: 1.0, priority: 1, critical: false, coldLoadPickupPU: 0.5, coldLoadPickupSeconds: 10 },
      { id: 'CRITICAL', mw: 0.8, priority: 3, critical: true, coldLoadPickupPU: 0.25, coldLoadPickupSeconds: 5 },
    ],
  });
  load.shedBlock('NONCRITICAL', 0);
  load.shedBlock('CRITICAL', 0);

  const controller = new LoadRestorationController({
    stableHoldSeconds: 0.3,
    minimumRestoreIntervalSeconds: 0.3,
    maximumRestoreBlockMW: 2,
    minimumPostRestoreReserveMW: 0.5,
    rollbackObservationSeconds: 0.2,
  });

  const firstEvents = stabilize(controller, { load, reserve60MW: 3 });
  const first = firstEvents.find((event) => event.type === 'LOAD_BLOCK_RESTORED');
  assert(first?.blockId === 'CRITICAL', `critical block was not restored first: ${first?.blockId ?? 'none'}`);
  assert(Math.abs(first.estimatedPickupMW - 1.0) < 1e-9, `unexpected critical pickup estimate: ${first.estimatedPickupMW}`);
  assert(load.shedBlocks.find((block) => block.id === 'NONCRITICAL').shed, 'noncritical block restored too early');

  const secondEvents = stabilize(controller, { load, startTimeSeconds: 0.6, steps: 4, reserve60MW: 3 });
  const second = secondEvents.find((event) => event.type === 'LOAD_BLOCK_RESTORED');
  assert(second?.blockId === 'NONCRITICAL', `noncritical block was not restored second: ${second?.blockId ?? 'none'}`);
  assert(load.shedMW === 0, `shed load remained after staged restoration: ${load.shedMW}`);

  return {
    name: 'Staged load restoration priority and reserve gate',
    status: 'PASS',
    metrics: { first, second, finalShedMW: load.shedMW },
  };
}

export function testColdLoadPickupDecay() {
  const load = new AggregateLoad({
    baseMW: 5,
    shedBlocks: [
      { id: 'MOTOR-BLOCK', mw: 1, priority: 1, coldLoadPickupPU: 0.5, coldLoadPickupSeconds: 10 },
    ],
  });
  load.shedBlock('MOTOR-BLOCK', 0);
  const restored = load.restoreBlock('MOTOR-BLOCK', 1);
  const initialPickupMW = load.coldLoadPickupMW;
  load.step(5);
  const midpointPickupMW = load.coldLoadPickupMW;
  load.step(5.1);
  const finalPickupMW = load.coldLoadPickupMW;

  assert(Math.abs(restored.coldPickupInitialMW - 0.5) < 1e-9, `unexpected initial cold pickup: ${restored.coldPickupInitialMW}`);
  assert(Math.abs(initialPickupMW - 0.5) < 1e-9, `initial pickup not applied: ${initialPickupMW}`);
  assert(Math.abs(midpointPickupMW - 0.25) < 1e-9, `pickup did not decay linearly: ${midpointPickupMW}`);
  assert(finalPickupMW === 0, `pickup did not expire: ${finalPickupMW}`);

  return {
    name: 'Cold-load pickup transient decay',
    status: 'PASS',
    metrics: { initialPickupMW, midpointPickupMW, finalPickupMW },
  };
}

export function testRestorationRollbackAndLockout() {
  const load = new AggregateLoad({
    baseMW: 5,
    shedBlocks: [
      { id: 'BLOCK-1', mw: 1, priority: 1, coldLoadPickupPU: 0.5, coldLoadPickupSeconds: 10 },
    ],
  });
  load.shedBlock('BLOCK-1', 0);

  const controller = new LoadRestorationController({
    stableHoldSeconds: 0.2,
    minimumRestoreIntervalSeconds: 0,
    minimumPostRestoreReserveMW: 0.2,
    rollbackFrequencyHz: 59.4,
    rollbackObservationSeconds: 10,
    rollbackLockoutSeconds: 30,
  });

  const restoreEvents = stabilize(controller, { load, steps: 2, reserve60MW: 3 });
  const restored = restoreEvents.find((event) => event.type === 'LOAD_BLOCK_RESTORED');
  assert(restored?.blockId === 'BLOCK-1', 'test block did not restore');

  const rollbackEvents = controller.evaluate({
    frequencyHz: 59.2,
    residualMW: -0.4,
    reserve60MW: 1,
    dtSeconds: 0.1,
    load,
    timeSeconds: 0.3,
    restorationPermitted: false,
  });
  const rollback = rollbackEvents.find((event) => event.type === 'LOAD_RESTORATION_ROLLBACK');

  assert(rollback?.blockId === 'BLOCK-1', 'failed restoration was not rolled back');
  assert(load.shedMW === 1, `rollback did not re-shed block: ${load.shedMW}`);
  assert(controller.lockoutUntilSeconds > 0.3, 'rollback lockout was not applied');

  return {
    name: 'Load restoration rollback and anti-oscillation lockout',
    status: 'PASS',
    metrics: { restored, rollback, lockoutUntilSeconds: controller.lockoutUntilSeconds },
  };
}
