import { createMinimumMiningAcceptanceScenario } from '../scenarios/mining-minimum-acceptance.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFor(engine, seconds) {
  const steps = Math.round(seconds / engine.dtSeconds);
  let last;
  for (let i = 0; i < steps; i += 1) last = engine.step();
  return last;
}

export function testMinimumMiningAcceptanceChain() {
  const {
    engine,
    load,
    bess,
    processMotor,
  } = createMinimumMiningAcceptanceScenario();

  engine.start();
  const baseline = runFor(engine, 20);
  assert(Math.abs(baseline.loadMW - 12) < 1e-6, `baseline mining load is not 12 MW: ${baseline.loadMW}`);
  assert(Math.abs(baseline.frequencyHz - 60) < 0.10, `baseline frequency is not stable: ${baseline.frequencyHz}`);
  assert(Math.abs(baseline.residualMW) < 0.10, `baseline power balance is not stable: ${baseline.residualMW}`);
  assert(processMotor.isRunning, 'slurry-pump motor is not running in the baseline mining state');

  const dieselTripTime = engine.timeSeconds;
  const dieselTrip = engine.tripLargestDiesel();
  assert(dieselTrip, 'largest diesel trip did not execute');
  const postDieselTrip = runFor(engine, 30);
  const dieselTripWindow = engine.history.filter((sample) => sample.timeSeconds >= dieselTripTime);
  const dieselTripFrequencyNadirHz = Math.min(...dieselTripWindow.map((sample) => sample.frequencyHz));
  const peakBessSupportMW = Math.max(...dieselTripWindow.map((sample) => sample.bessMW));
  const prematureUfls = engine.events.filter(
    (event) => event.type === 'UFLS_STAGE_OPERATED' && event.timeSeconds < engine.timeSeconds,
  );

  assert(dieselTripFrequencyNadirHz >= 58.5, `diesel-trip frequency nadir is below screening limit: ${dieselTripFrequencyNadirHz}`);
  assert(peakBessSupportMW >= 2.0, `BESS did not provide required diesel-trip support: ${peakBessSupportMW}`);
  assert(prematureUfls.length === 0, `UFLS operated while BESS support was available: ${JSON.stringify(prematureUfls)}`);
  assert(postDieselTrip.onlineDieselCount === 3, `unexpected online diesel count after trip: ${postDieselTrip.onlineDieselCount}`);

  const bessTripTime = engine.timeSeconds;
  const bessTrip = engine.tripBess();
  assert(bessTrip, 'BESS trip did not execute');
  const postBessTrip = runFor(engine, 20);
  const effectiveUflsEvents = engine.events.filter(
    (event) => event.type === 'UFLS_STAGE_OPERATED'
      && event.timeSeconds >= bessTripTime
      && event.shedMW > 0,
  );
  const shedBlockIds = effectiveUflsEvents.map((event) => event.shedBlockId);
  const criticalBlock = load.shedBlocks.find((block) => block.id === 'CONTROL-CRITICAL');

  assert(effectiveUflsEvents.length >= 2, `UFLS did not shed enough noncritical mining load: ${JSON.stringify(effectiveUflsEvents)}`);
  assert(shedBlockIds[0] === 'CRUSHER-AUX', `wrong first mining load shed: ${shedBlockIds[0]}`);
  assert(shedBlockIds[1] === 'VENT-NONCRITICAL', `wrong second mining load shed: ${shedBlockIds[1]}`);
  assert(effectiveUflsEvents.slice(0, 2).every((event) => !event.criticalLoadShed), 'critical mining load was shed before noncritical load');
  assert(criticalBlock && !criticalBlock.shed, 'critical control and safety load was shed');
  assert(postBessTrip.explicitUnservedLoadMW >= 2.2 - 1e-9, `explicit unserved load is too small after protection action: ${postBessTrip.explicitUnservedLoadMW}`);
  assert(postBessTrip.eensMWh > 0, 'EENS did not accumulate after explicit mining load shedding');

  bess.restore();
  engine.nextEmsDispatchSeconds = engine.timeSeconds;
  const recoveryStartSeconds = engine.timeSeconds;
  const recovered = runFor(engine, 60);
  const restorationEvents = engine.events.filter(
    (event) => event.type === 'LOAD_BLOCK_RESTORED'
      && event.timeSeconds >= recoveryStartSeconds,
  );
  const rollbackEvents = engine.events.filter(
    (event) => event.type === 'LOAD_RESTORATION_ROLLBACK'
      && event.timeSeconds >= recoveryStartSeconds,
  );

  assert(restorationEvents.length >= 2, `mining loads were not fully restored in stages: ${JSON.stringify(restorationEvents)}`);
  assert(restorationEvents[0].blockId === 'VENT-NONCRITICAL', `wrong first restored mining block: ${restorationEvents[0].blockId}`);
  assert(restorationEvents[1].blockId === 'CRUSHER-AUX', `wrong second restored mining block: ${restorationEvents[1].blockId}`);
  assert(rollbackEvents.length === 0, `load restoration rolled back unexpectedly: ${JSON.stringify(rollbackEvents)}`);
  assert(load.shedMW === 0, `shed mining load remains after recovery: ${load.shedMW}`);
  assert(recovered.bessAvailable === true, 'BESS did not remain available after restoration');
  assert(Math.abs(recovered.frequencyHz - 60) < 0.15, `recovered frequency is outside screening band: ${recovered.frequencyHz}`);
  assert(Math.abs(recovered.residualMW) < 0.15, `recovered power residual is too high: ${recovered.residualMW}`);
  assert(recovered.eensMWh > 0, 'reliability accounting lost accumulated EENS after restoration');

  return {
    name: 'Minimum mining acceptance chain',
    status: 'PASS',
    metrics: {
      baselineFrequencyHz: baseline.frequencyHz,
      dieselTripFrequencyNadirHz,
      peakBessSupportMW,
      effectiveUflsEvents,
      explicitUnservedLoadMWAfterBessTrip: postBessTrip.explicitUnservedLoadMW,
      restorationEvents,
      rollbackEvents,
      finalFrequencyHz: recovered.frequencyHz,
      finalResidualMW: recovered.residualMW,
      finalEensMWh: recovered.eensMWh,
    },
  };
}
