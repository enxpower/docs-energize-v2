const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class AggregateLoad {
  constructor({ baseMW, shedBlocks = [] }) {
    this.baseMW = Math.max(0, baseMW);
    this.commandMW = this.baseMW;
    this.actualMW = this.baseMW;
    this.shedBlocks = [...shedBlocks]
      .map((block, index) => ({
        id: block.id ?? `LOAD-BLOCK-${index + 1}`,
        name: block.name ?? block.id ?? `Load Block ${index + 1}`,
        mw: Math.max(0, Number(block.mw) || 0),
        priority: Math.max(1, Number(block.priority) || index + 1),
        critical: Boolean(block.critical),
        shed: false,
        shedAtSeconds: null,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  setDemandMW(mw) {
    this.commandMW = Math.max(0, mw);
  }

  get demandMW() {
    return this.commandMW;
  }

  get shedMW() {
    return this.shedBlocks
      .filter((block) => block.shed)
      .reduce((sum, block) => sum + block.mw, 0);
  }

  get connectedMW() {
    return Math.max(0, this.commandMW - this.shedMW);
  }

  get availableShedBlocks() {
    return this.shedBlocks.filter((block) => !block.shed);
  }

  shedBlock(blockId, timeSeconds = null) {
    const block = this.shedBlocks.find((candidate) => candidate.id === blockId);
    if (!block || block.shed) return null;
    block.shed = true;
    block.shedAtSeconds = timeSeconds;
    return { ...block };
  }

  shedNextBlock({ allowCritical = false, timeSeconds = null } = {}) {
    const candidate = this.shedBlocks.find((block) => !block.shed && (allowCritical || !block.critical));
    return candidate ? this.shedBlock(candidate.id, timeSeconds) : null;
  }

  restoreBlock(blockId) {
    const block = this.shedBlocks.find((candidate) => candidate.id === blockId);
    if (!block || !block.shed) return false;
    block.shed = false;
    block.shedAtSeconds = null;
    return true;
  }

  restoreAll() {
    for (const block of this.shedBlocks) {
      block.shed = false;
      block.shedAtSeconds = null;
    }
  }

  step() {
    this.actualMW = clamp(this.connectedMW, 0, this.commandMW);
    return this.actualMW;
  }
}
