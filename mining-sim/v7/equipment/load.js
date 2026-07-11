const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class AggregateLoad {
  constructor({ baseMW, shedBlocks = [], dynamicLoads = [] }) {
    this.baseMW = Math.max(0, baseMW);
    this.commandMW = this.baseMW;
    this.actualMW = this.baseMW;
    this.dynamicLoads = [...dynamicLoads];
    this.dynamicLoadMW = 0;
    this.shedBlocks = [...shedBlocks]
      .map((block, index) => ({
        id: block.id ?? `LOAD-BLOCK-${index + 1}`,
        name: block.name ?? block.id ?? `Load Block ${index + 1}`,
        mw: Math.max(0, Number(block.mw) || 0),
        priority: Math.max(1, Number(block.priority) || index + 1),
        critical: Boolean(block.critical),
        coldLoadPickupPU: Math.max(0, Number(block.coldLoadPickupPU) || 0),
        coldLoadPickupSeconds: Math.max(0, Number(block.coldLoadPickupSeconds) || 0),
        shed: false,
        shedAtSeconds: null,
        restoredAtSeconds: null,
        pickupElapsedSeconds: Infinity,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  attachDynamicLoad(dynamicLoad) {
    if (!dynamicLoad || typeof dynamicLoad.step !== 'function') {
      throw new Error('Dynamic load must expose step(dtSeconds, context)');
    }
    this.dynamicLoads.push(dynamicLoad);
    return dynamicLoad;
  }

  setDemandMW(mw) {
    this.commandMW = Math.max(0, mw);
  }

  get demandMW() {
    return this.commandMW + this.dynamicLoadMW;
  }

  get shedMW() {
    return this.shedBlocks
      .filter((block) => block.shed)
      .reduce((sum, block) => sum + block.mw, 0);
  }

  coldPickupForBlockMW(block) {
    if (block.shed || block.coldLoadPickupPU <= 0 || block.coldLoadPickupSeconds <= 0) return 0;
    if (block.pickupElapsedSeconds >= block.coldLoadPickupSeconds) return 0;
    const remainingPU = 1 - block.pickupElapsedSeconds / block.coldLoadPickupSeconds;
    return block.mw * block.coldLoadPickupPU * clamp(remainingPU, 0, 1);
  }

  get coldLoadPickupMW() {
    return this.shedBlocks.reduce((sum, block) => sum + this.coldPickupForBlockMW(block), 0);
  }

  get connectedMW() {
    return Math.max(0, this.commandMW - this.shedMW + this.coldLoadPickupMW + this.dynamicLoadMW);
  }

  get availableShedBlocks() {
    return this.shedBlocks.filter((block) => !block.shed);
  }

  get restorableBlocks() {
    return this.shedBlocks
      .filter((block) => block.shed)
      .sort((a, b) => b.priority - a.priority || a.mw - b.mw);
  }

  shedBlock(blockId, timeSeconds = null) {
    const block = this.shedBlocks.find((candidate) => candidate.id === blockId);
    if (!block || block.shed) return null;
    block.shed = true;
    block.shedAtSeconds = timeSeconds;
    block.restoredAtSeconds = null;
    block.pickupElapsedSeconds = Infinity;
    return { ...block };
  }

  shedNextBlock({ allowCritical = false, timeSeconds = null } = {}) {
    const candidate = this.shedBlocks.find((block) => !block.shed && (allowCritical || !block.critical));
    return candidate ? this.shedBlock(candidate.id, timeSeconds) : null;
  }

  restoreBlock(blockId, timeSeconds = null) {
    const block = this.shedBlocks.find((candidate) => candidate.id === blockId);
    if (!block || !block.shed) return null;
    block.shed = false;
    block.restoredAtSeconds = timeSeconds;
    block.pickupElapsedSeconds = 0;
    return {
      ...block,
      coldPickupInitialMW: block.mw * block.coldLoadPickupPU,
      expectedPickupTotalMW: block.mw * (1 + block.coldLoadPickupPU),
    };
  }

  restoreAll(timeSeconds = null) {
    const restored = [];
    for (const block of this.shedBlocks) {
      if (!block.shed) continue;
      const result = this.restoreBlock(block.id, timeSeconds);
      if (result) restored.push(result);
    }
    return restored;
  }

  step(dtSeconds = 0, context = {}) {
    const dt = Math.max(0, Number(dtSeconds) || 0);
    for (const block of this.shedBlocks) {
      if (!block.shed && Number.isFinite(block.pickupElapsedSeconds)) {
        block.pickupElapsedSeconds += dt;
      }
    }
    this.dynamicLoadMW = this.dynamicLoads.reduce(
      (sum, dynamicLoad) => sum + Math.max(0, Number(dynamicLoad.step(dt, context)) || 0),
      0,
    );
    this.actualMW = clamp(
      this.connectedMW,
      0,
      this.commandMW + this.coldLoadPickupMW + this.dynamicLoadMW,
    );
    return this.actualMW;
  }
}
