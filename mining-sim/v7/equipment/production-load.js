const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ProductionLoad {
  constructor({
    id,
    name = id,
    normalMW,
    minimumMW = 0,
    priority = 1,
    safetyCritical = false,
    continuousCurtailment = true,
    curtailRampMWPerS = Infinity,
    restoreRampMWPerS = Infinity,
    productionUnitsPerMWh = 1,
    normalThroughputTPH = 0,
    throughputExponent = 1,
  } = {}) {
    if (!id) throw new Error('ProductionLoad requires id');
    this.id = String(id);
    this.name = name;
    this.normalMW = Math.max(0, Number(normalMW) || 0);
    this.minimumMW = clamp(Number(minimumMW) || 0, 0, this.normalMW);
    this.priority = Math.max(1, Number(priority) || 1);
    this.safetyCritical = Boolean(safetyCritical);
    this.continuousCurtailment = continuousCurtailment !== false;
    this.curtailRampMWPerS = Math.max(0, Number(curtailRampMWPerS) || Infinity);
    this.restoreRampMWPerS = Math.max(0, Number(restoreRampMWPerS) || Infinity);
    this.productionUnitsPerMWh = Math.max(0, Number(productionUnitsPerMWh) || 0);
    this.normalThroughputTPH = Math.max(0, Number(normalThroughputTPH) || 0);
    this.throughputExponent = Math.max(0.01, Number(throughputExponent) || 1);
    this.targetMW = this.normalMW;
    this.outputMW = this.normalMW;
    this.curtailmentReason = null;
    this.lastChangedAtSeconds = null;
  }

  get curtailedMW() {
    return Math.max(0, this.normalMW - this.outputMW);
  }

  get availableCurtailmentMW() {
    if (this.safetyCritical) return 0;
    return Math.max(0, this.outputMW - this.minimumMW);
  }

  get availableRestorationMW() {
    return Math.max(0, this.normalMW - this.outputMW);
  }

  get loadFraction() {
    if (this.normalMW <= 0) return 0;
    return clamp(this.outputMW / this.normalMW, 0, 1);
  }

  get throughputTPH() {
    if (this.normalThroughputTPH <= 0) return 0;
    return this.normalThroughputTPH * (this.loadFraction ** this.throughputExponent);
  }

  get deferredThroughputTPH() {
    return Math.max(0, this.normalThroughputTPH - this.throughputTPH);
  }

  setTargetMW(targetMW, { timeSeconds = null, reason = null } = {}) {
    const next = clamp(Number(targetMW) || 0, this.minimumMW, this.normalMW);
    if (!this.continuousCurtailment && next < this.normalMW) {
      this.targetMW = next <= this.minimumMW + 1e-9 ? this.minimumMW : this.normalMW;
    } else {
      this.targetMW = next;
    }
    this.curtailmentReason = this.targetMW < this.normalMW ? reason : null;
    this.lastChangedAtSeconds = timeSeconds;
    return this.targetMW;
  }

  step(dtSeconds = 0) {
    const dt = Math.max(0, Number(dtSeconds) || 0);
    const delta = this.targetMW - this.outputMW;
    if (Math.abs(delta) < 1e-9) {
      this.outputMW = this.targetMW;
      return this.outputMW;
    }
    const rate = delta < 0 ? this.curtailRampMWPerS : this.restoreRampMWPerS;
    const maximumChange = Number.isFinite(rate) ? rate * dt : Math.abs(delta);
    this.outputMW += Math.sign(delta) * Math.min(Math.abs(delta), maximumChange);
    this.outputMW = clamp(this.outputMW, this.minimumMW, this.normalMW);
    return this.outputMW;
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      normalMW: this.normalMW,
      minimumMW: this.minimumMW,
      targetMW: this.targetMW,
      outputMW: this.outputMW,
      curtailedMW: this.curtailedMW,
      priority: this.priority,
      safetyCritical: this.safetyCritical,
      curtailmentReason: this.curtailmentReason,
      normalThroughputTPH: this.normalThroughputTPH,
      throughputTPH: this.throughputTPH,
      deferredThroughputTPH: this.deferredThroughputTPH,
      throughputExponent: this.throughputExponent,
    };
  }
}

export class ProductionLoadBank {
  constructor({ loads = [] } = {}) {
    this.loads = [...loads];
    const ids = new Set(this.loads.map((load) => load.id));
    if (ids.size !== this.loads.length) throw new Error('Production load ids must be unique');
  }

  step(dtSeconds = 0) {
    return this.loads.reduce((sum, load) => sum + load.step(dtSeconds), 0);
  }

  get outputMW() {
    return this.loads.reduce((sum, load) => sum + load.outputMW, 0);
  }

  get normalMW() {
    return this.loads.reduce((sum, load) => sum + load.normalMW, 0);
  }

  get curtailedMW() {
    return this.loads.reduce((sum, load) => sum + load.curtailedMW, 0);
  }

  get throughputTPH() {
    return this.loads.reduce((sum, load) => sum + load.throughputTPH, 0);
  }

  get normalThroughputTPH() {
    return this.loads.reduce((sum, load) => sum + load.normalThroughputTPH, 0);
  }

  get deferredThroughputTPH() {
    return this.loads.reduce((sum, load) => sum + load.deferredThroughputTPH, 0);
  }

  snapshot() {
    return this.loads.map((load) => load.snapshot());
  }
}