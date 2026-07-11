import { calculatePowerBalance } from '../physics/power-balance.js';
import { stepIslandFrequency } from '../physics/frequency.js';
import { dispatchIsland } from '../controls/ems.js';
import { commandBessFastResponse } from '../controls/bess-fast-controller.js';
import { evaluateGeneratorCommitment, applyGeneratorCommitmentAction } from '../controls/generator-commitment.js';
import { assessReserve } from '../reliability/reserve-engine.js';
import { deriveSystemState } from './state-machine.js';

export class SimulationEngine {
  constructor({
    dtSeconds,
    nominalHz,
    systemBaseMW,
    load,
    dieselFleet,
    bess,
    emsIntervalSeconds = 20,
    commitmentEnabled = true,
    commitmentIntervalSeconds = 60,
    commitmentAllowStop = false,
    minimumOnlineUnits = 1,
    commitmentReserveMarginMW = 0,
  }) {
    this.dtSeconds = dtSeconds;
    this.nominalHz = nominalHz;
    this.systemBaseMW = systemBaseMW;
    this.load = load;
    this.dieselFleet = dieselFleet;
    this.bess = bess;
    this.emsIntervalSeconds = emsIntervalSeconds;
    this.nextEmsDispatchSeconds = 0;
    this.lastEmsResult = null;
    this.commitmentEnabled = commitmentEnabled;
    this.commitmentIntervalSeconds = commitmentIntervalSeconds;
    this.commitmentAllowStop = commitmentAllowStop;
    this.minimumOnlineUnits = minimumOnlineUnits;
    this.commitmentReserveMarginMW = commitmentReserveMarginMW;
    this.nextCommitmentEvaluationSeconds = 0;
    this.lastCommitmentDecision = null;
    this.timeSeconds = 0;
    this.frequencyHz = nominalHz;
    this.rocofHzPerS = 0;
    this.running = false;
    this.faulted = false;
    this.state = 'OFF';
    this.history = [];
    this.events = [];
  }

  start() { this.running = true; }
  stop() { this.running = false; }

  runEmsIfDue(loadMW) {
    if (this.timeSeconds + 1e-9 < this.nextEmsDispatchSeconds) return this.lastEmsResult;
    this.lastEmsResult = dispatchIsland({ loadMW, dieselFleet: this.dieselFleet, bess: this.bess });
    this.nextEmsDispatchSeconds = this.timeSeconds + this.emsIntervalSeconds;
    return this.lastEmsResult;
  }

  runCommitmentIfDue(loadMW) {
    if (!this.commitmentEnabled) return this.lastCommitmentDecision;
    if (this.timeSeconds + 1e-9 < this.nextCommitmentEvaluationSeconds) return this.lastCommitmentDecision;

    const decision = evaluateGeneratorCommitment({
      loadMW,
      dieselFleet: this.dieselFleet,
      bess: this.bess,
      minimumOnlineUnits: this.minimumOnlineUnits,
      reserveMarginMW: this.commitmentReserveMarginMW,
      allowStop: this.commitmentAllowStop,
    });
    const actionResult = applyGeneratorCommitmentAction({ dieselFleet: this.dieselFleet, decision });
    this.lastCommitmentDecision = { ...decision, actionResult };
    this.nextCommitmentEvaluationSeconds = this.timeSeconds + this.commitmentIntervalSeconds;

    if (actionResult?.accepted) {
      this.events.push({
        timeSeconds: this.timeSeconds,
        type: `DG_${actionResult.type}_REQUEST`,
        equipmentId: actionResult.equipmentId,
        reason: actionResult.reason,
      });
      this.nextEmsDispatchSeconds = this.timeSeconds;
    }

    return this.lastCommitmentDecision;
  }

  tripLargestDiesel() {
    const online = this.dieselFleet.filter((dg) => dg.isOnline);
    if (!online.length) return null;
    const target = online.reduce((largest, dg) => (dg.ratedMW > largest.ratedMW ? dg : largest), online[0]);
    const preTripMW = target.outputMW;
    target.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'DG_TRIP', equipmentId: target.id, ratedMW: target.ratedMW, preTripMW };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    this.nextCommitmentEvaluationSeconds = this.timeSeconds;
    return event;
  }

  tripBess() {
    if (!this.bess.isAvailable) return null;
    const preTripMW = this.bess.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'BESS_TRIP', preTripMW, soc: this.bess.soc };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    this.nextCommitmentEvaluationSeconds = this.timeSeconds;
    return event;
  }

  step() {
    if (!this.running) throw new Error('Simulation engine is not running');

    const loadMW = this.load.step(this.dtSeconds);
    this.runCommitmentIfDue(loadMW);
    this.runEmsIfDue(loadMW);

    const dieselMW = this.dieselFleet.reduce(
      (sum, dg) => sum + dg.step(this.dtSeconds, { frequencyHz: this.frequencyHz }),
      0,
    );
    const dieselEmsSetpointMW = this.dieselFleet.reduce((sum, dg) => sum + dg.emsSetpointMW, 0);
    const dieselMechanicalMW = this.dieselFleet.reduce((sum, dg) => sum + dg.mechanicalMW, 0);
    const dieselPrimaryResponseMW = this.dieselFleet.reduce(
      (sum, dg) => sum + (dg.governorCommandMW - dg.emsSetpointMW),
      0,
    );

    const preBessResidualMW = dieselMW - loadMW;
    const bessCommandMW = commandBessFastResponse({
      bess: this.bess,
      residualBeforeBessMW: preBessResidualMW,
      frequencyHz: this.frequencyHz,
      nominalHz: this.nominalHz,
      rocofHzPerS: this.rocofHzPerS,
    });
    const bessMW = this.bess.step(this.dtSeconds);

    const balance = calculatePowerBalance({ loadMW, dieselMW, bessMW });
    const onlineFleet = this.dieselFleet.filter((dg) => dg.isOnline);
    const totalInertiaSeconds = Math.max(
      0.1,
      onlineFleet.reduce((sum, dg) => sum + dg.inertiaSeconds * dg.ratedMW, 0) / Math.max(this.systemBaseMW, 0.1),
    );

    const frequency = stepIslandFrequency(
      { frequencyHz: this.frequencyHz },
      {
        nominalHz: this.nominalHz,
        systemBaseMW: this.systemBaseMW,
        inertiaSeconds: totalInertiaSeconds,
        loadDampingMWPerHz: 0.02 * this.systemBaseMW,
        generationMW: dieselMW + bessMW,
        loadMW,
      },
      this.dtSeconds,
    );

    this.frequencyHz = frequency.frequencyHz;
    this.rocofHzPerS = frequency.rocofHzPerS;
    this.state = deriveSystemState({
      running: this.running,
      faulted: this.faulted,
      frequencyHz: this.frequencyHz,
      nominalHz: this.nominalHz,
      powerResidualMW: balance.residualMW,
    });

    const reserve = assessReserve({ dieselFleet: this.dieselFleet, bess: this.bess });
    this.timeSeconds += this.dtSeconds;
    const requestedSupportMW = Math.max(0, loadMW - dieselMW);
    const sample = {
      timeSeconds: this.timeSeconds,
      state: this.state,
      loadMW,
      dieselMW,
      dieselEmsSetpointMW,
      dieselMechanicalMW,
      dieselPrimaryResponseMW,
      dieselStates: this.dieselFleet.map((dg) => ({ id: dg.id, state: dg.state, outputMW: dg.outputMW })),
      bessCommandMW,
      bessMW,
      bessSoc: this.bess.soc,
      bessAvailable: this.bess.isAvailable,
      bessAvailableDischargeMW: this.bess.availableDischargeMW(),
      bessUsableEnergyMWh: this.bess.usableDischargeEnergyMWh(),
      bessSupportDurationMinutes: this.bess.dischargeDurationMinutes(requestedSupportMW),
      residualMW: balance.residualMW,
      frequencyHz: this.frequencyHz,
      rocofHzPerS: this.rocofHzPerS,
      onlineDieselCount: onlineFleet.length,
      startingDieselCount: this.dieselFleet.filter((dg) => dg.isStarting).length,
      reserveFast10MW: reserve.fast10MW,
      reserve60MW: reserve.reserve60MW,
      reserve600MW: reserve.reserve600MW,
      largestOnlineContingencyMW: reserve.largestOnlineContingencyMW,
      n1Status: reserve.n1Status,
      n1CoverageRatio: reserve.n1CoverageRatio,
      emsNextDispatchSeconds: this.nextEmsDispatchSeconds,
      commitmentNextEvaluationSeconds: this.nextCommitmentEvaluationSeconds,
    };
    this.history.push(sample);
    return sample;
  }
}
