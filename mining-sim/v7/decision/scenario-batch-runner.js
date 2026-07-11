const normalizeActions = (actions = []) => [...actions]
  .map((action, index) => ({
    id: action.id ?? `ACTION-${index + 1}`,
    timeSeconds: Math.max(0, Number(action.timeSeconds) || 0),
    apply: action.apply,
    order: index,
  }))
  .sort((a, b) => a.timeSeconds - b.timeSeconds || a.order - b.order);

export class ScenarioBatchRunner {
  constructor({ durationSeconds, actions = [] } = {}) {
    this.durationSeconds = Math.max(0, Number(durationSeconds) || 0);
    if (this.durationSeconds <= 0) throw new Error('ScenarioBatchRunner requires durationSeconds > 0');
    this.actions = normalizeActions(actions);
    for (const action of this.actions) {
      if (typeof action.apply !== 'function') throw new Error(`Scenario action ${action.id} requires apply(engine)`);
    }
  }

  runScenario(definition) {
    if (!definition?.id) throw new Error('Scenario definition requires id');
    if (typeof definition.createEngine !== 'function') {
      throw new Error(`Scenario ${definition.id} requires createEngine()`);
    }
    const engine = definition.createEngine();
    if (!engine || typeof engine.step !== 'function') {
      throw new Error(`Scenario ${definition.id} createEngine() did not return a simulation engine`);
    }
    const dtSeconds = Number(engine.dtSeconds);
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      throw new Error(`Scenario ${definition.id} engine requires dtSeconds > 0`);
    }

    const samples = [];
    const executedActions = [];
    const actions = normalizeActions([...(this.actions ?? []), ...(definition.actions ?? [])]);
    let actionIndex = 0;
    if (typeof engine.start === 'function') engine.start();

    const maximumSteps = Math.ceil(this.durationSeconds / dtSeconds) + 2;
    for (let step = 0; step < maximumSteps && (engine.timeSeconds ?? 0) < this.durationSeconds - 1e-12; step += 1) {
      const currentTime = Number(engine.timeSeconds) || 0;
      while (actionIndex < actions.length && actions[actionIndex].timeSeconds <= currentTime + 1e-9) {
        const action = actions[actionIndex];
        const result = action.apply(engine, {
          scenarioId: definition.id,
          scheduledTimeSeconds: action.timeSeconds,
          actualTimeSeconds: currentTime,
        });
        executedActions.push({
          id: action.id,
          scheduledTimeSeconds: action.timeSeconds,
          actualTimeSeconds: currentTime,
          result: result ?? null,
        });
        actionIndex += 1;
      }
      samples.push(engine.step());
    }

    return {
      id: String(definition.id),
      name: definition.name ?? definition.id,
      samples,
      events: [...(engine.events ?? [])],
      assumptions: { ...(definition.assumptions ?? {}) },
      capitalCostEstimate: Number.isFinite(Number(definition.capitalCostEstimate))
        ? Number(definition.capitalCostEstimate)
        : null,
      execution: {
        durationSeconds: this.durationSeconds,
        dtSeconds,
        sampleCount: samples.length,
        executedActions,
        unexecutedActionIds: actions.slice(actionIndex).map((action) => action.id),
      },
    };
  }

  runAll(definitions = []) {
    if (!Array.isArray(definitions) || definitions.length < 2) {
      throw new Error('Scenario batch requires at least two definitions');
    }
    const ids = new Set(definitions.map((definition) => String(definition.id)));
    if (ids.size !== definitions.length) throw new Error('Scenario definition ids must be unique');
    return definitions.map((definition) => this.runScenario(definition));
  }
}
