import { AggregateLoad } from '../equipment/load.js';
import { createDieselFleet } from '../equipment/diesel-generator.js';
import { Bess } from '../equipment/bess.js';
import { SimulationEngine } from '../core/simulation-engine.js';

export function createBaseOffgridScenario() {
  const load = new AggregateLoad({ baseMW: 12 });
  const dieselFleet = createDieselFleet([
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.2, rampDownMWPerS: 1.0, inertiaSeconds: 4, droopPU: 0.04, nominalHz: 60 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.2, rampDownMWPerS: 1.0, inertiaSeconds: 4, droopPU: 0.04, nominalHz: 60 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.2, rampDownMWPerS: 1.0, inertiaSeconds: 4, droopPU: 0.04, nominalHz: 60 },
    { ratedMW: 3.3, minLoadPU: 0.35, rampUpMWPerS: 0.2, rampDownMWPerS: 1.0, inertiaSeconds: 4, droopPU: 0.04, nominalHz: 60 },
  ]);

  const steadyShareMW = load.baseMW / dieselFleet.length;
  for (const dg of dieselFleet) {
    dg.emsSetpointMW = steadyShareMW;
    dg.governorCommandMW = steadyShareMW;
    dg.mechanicalMW = steadyShareMW;
    dg.outputMW = steadyShareMW;
  }

  const bess = new Bess({
    powerMW: 8,
    energyMWh: 20,
    initialSoc: 0.6,
    minSoc: 0.18,
    maxSoc: 0.82,
    roundTripEfficiency: 0.965,
    rampMWPerS: 8,
  });

  return new SimulationEngine({
    dtSeconds: 0.1,
    nominalHz: 60,
    systemBaseMW: 12,
    load,
    dieselFleet,
    bess,
    emsIntervalSeconds: 20,
  });
}
