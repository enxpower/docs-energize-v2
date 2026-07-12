const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function allocateDieselMW(onlineFleet, targetMW) {
  const minimumTotalMW = onlineFleet.reduce((sum, dg) => sum + dg.minimumMW, 0);
  const ratedTotalMW = onlineFleet.reduce((sum, dg) => sum + dg.ratedMW, 0);
  const clampedTargetMW = clamp(targetMW, minimumTotalMW, ratedTotalMW);
  const additionalMW = Math.max(0, clampedTargetMW - minimumTotalMW);
  const totalHeadroomMW = Math.max(0, ratedTotalMW - minimumTotalMW);

  return onlineFleet.map((dg) => {
    const headroomMW = Math.max(0, dg.ratedMW - dg.minimumMW);
    const shareMW = totalHeadroomMW > 0 ? additionalMW * headroomMW / totalHeadroomMW : 0;
    return { dg, outputMW: clamp(dg.minimumMW + shareMW, dg.minimumMW, dg.ratedMW) };
  });
}

export function initializeIslandSteadyState({ load, dieselFleet, bess, nominalHz = 60 } = {}) {
  if (!load || !Array.isArray(dieselFleet) || !bess) {
    throw new Error('Initial steady-state requires load, dieselFleet and bess');
  }

  const loadMW = Number(load.step(0, {
    frequencyHz: nominalHz,
    rocofHzPerS: 0,
    timeSeconds: 0,
  })) || 0;
  const onlineFleet = dieselFleet.filter((dg) => dg.isOnline);
  const minimumTotalMW = onlineFleet.reduce((sum, dg) => sum + dg.minimumMW, 0);
  const ratedTotalMW = onlineFleet.reduce((sum, dg) => sum + dg.ratedMW, 0);
  const dieselTargetMW = clamp(loadMW, minimumTotalMW, ratedTotalMW);
  const allocations = allocateDieselMW(onlineFleet, dieselTargetMW);

  for (const dg of dieselFleet) {
    if (!dg.isOnline) continue;
    const allocation = allocations.find((item) => item.dg === dg)?.outputMW ?? dg.minimumMW;
    dg.emsSetpointMW = allocation;
    dg.governorCommandMW = allocation;
    dg.mechanicalMW = allocation;
    dg.outputMW = allocation;
  }

  const dieselMW = allocations.reduce((sum, item) => sum + item.outputMW, 0);
  const requestedBessMW = loadMW - dieselMW;
  const bessMW = requestedBessMW >= 0
    ? Math.min(requestedBessMW, bess.availableDischargeMW())
    : -Math.min(-requestedBessMW, bess.availableChargeMW());
  bess.commandMW = bessMW;
  bess.outputMW = bessMW;

  const residualMW = dieselMW + bessMW - loadMW;
  return {
    loadMW,
    dieselMW,
    bessMW,
    residualMW,
    balanced: Math.abs(residualMW) <= 1e-9,
    onlineDieselCount: onlineFleet.length,
    minimumTotalMW,
    ratedTotalMW,
    allocations: allocations.map(({ dg, outputMW }) => ({ equipmentId: dg.id, outputMW })),
  };
}
