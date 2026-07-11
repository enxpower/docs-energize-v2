import { calculatePowerBalance } from '../physics/power-balance.js';
import { stepIslandFrequency } from '../physics/frequency.js';
import { dispatchIsland } from '../controls/ems.js';
import { commandBessFastResponse } from '../controls/bess-fast-controller.js';
import { deriveSystemState } from './state-machine.js';

export class SimulationEngine {
  constructor({ dtSeconds, nominalHz, systemBaseMW, load, dieselFleet, bess, emsIntervalSeconds = 20 }) {
    this.dtSeconds = dtSeconds;
    this.nominalHz = nominalHz;
    this.systemBaseMW = systemBaseMW;
    this.load = load;
    this.dieselFleet = dieselFleet;
    this.bess = bess;
    this.emsIntervalSeconds = emsIntervalSeconds;
    this.nextEmsDispatchSeconds = 0;
    this.lastEmsResult = null;
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

  tripLargestDiesel() {
    const online = this.dieselFleet.filter((dg) => dg.isOnline);
    if (!online.length) return null;
    const target = online.reduce((largest, dg) => (dg.ratedMW > largest.ratedMW ? dg : largest), online[0]);
    const preTripMW = target.outputMW;
    target.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'DG_TRIP', equipmentId: target.id, ratedMW: target.ratedMW, preTripMW };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    return event;
  }

  tripBess() {
    if (!this.bess.isAvailable) return null;
    const preTripMW = this.bess.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'BESS_TRIP', preTripMW, soc: this.bess.soc };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    return event;
  }

  step() {
    if (!this.running) throw new Error('Simulation engine is not running');

    const loadMW = this.load.step(this.dtSeconds);
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
      emsNextDispatchSeconds: this.nextEmsDispatchSeconds,
    };
    this.history.push(sample);
    return sample;
  }
}
