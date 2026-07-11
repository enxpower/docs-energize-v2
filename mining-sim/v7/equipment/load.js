export class AggregateLoad {
  constructor({ baseMW }) {
    this.baseMW = baseMW;
    this.commandMW = baseMW;
    this.actualMW = baseMW;
  }

  setDemandMW(mw) {
    this.commandMW = Math.max(0, mw);
  }

  step() {
    this.actualMW = this.commandMW;
    return this.actualMW;
  }
}
