import { calculatePowerBalance } from '../physics/power-balance.js';
import { stepIslandFrequency } from '../physics/frequency.js';
import { dispatchIsland } from '../controls/ems.js';
import { deriveSystemState } from './state-machine.js';

export class SimulationEngine {
  constructor({ dtSeconds, nominalHz, systemBaseMW, load, dieselFleet, bess }) {
    this.dtSeconds = dtSeconds;
    this.nominalHz = nominalHz;
    this.systemBaseMW = systemBaseMW;
    this.load = load;
    this.dieselFleet = dieselFleet;
    this.bess = bess;
    this.timeSeconds = 0;
    this.frequencyHz = nominalHz;
    this.rocofHzPerS = 0;
    this.running = false;
    this.faulted = false;
    this.state = 'OFF';
    this.history = [];
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  step() {
    if (!this.running) throw new Error('Simulation engine is not running');

    const loadMW = this.load.step(this.dtSeconds);
    dispatchIsland({ loadMW, dieselFleet: this.dieselFleet, bess: this.bess });

    const dieselMW = this.dieselFleet.reduce((sum, dg) => sum + dg.step(this.dtSeconds), 0);
    const preBessResidualMW = dieselMW - loadMW;
    this.bess.setCommandMW(-preBessResidualMW);
    const bessMW = this.bess.step(this.dtSeconds);

    const balance = calculatePowerBalance({ loadMW, dieselMW, bessMW });
    const totalInertiaSeconds = Math.max(
      0.1,
      this.dieselFleet.reduce((sum, dg) => sum + dg.inertiaSeconds * dg.ratedMW, 0) / Math.max(this.systemBaseMW, 0.1),
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
    const sample = {
      timeSeconds: this.timeSeconds,
      state: this.state,
      loadMW,
      dieselMW,
      bessMW,
      bessSoc: this.bess.soc,
      residualMW: balance.residualMW,
      frequencyHz: this.frequencyHz,
      rocofHzPerS: this.rocofHzPerS,
    };
    this.history.push(sample);
    return sample;
  }
}
