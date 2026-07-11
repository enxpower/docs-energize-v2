# V7 Debt Cleanup Status

## Exit criteria

Debt cleanup is complete only when all items below are satisfied:

1. The full regression suite executes in Node and in the browser harness.
2. The pull-request CI run is visible and green.
3. Connected demand, explicit unserved load, nominal shed blocks, transient power residual, and EENS remain separate quantities.
4. Dynamic loads receive the simulation frequency and time context.
5. Every protective or supervisory action creates traceable evidence.
6. The minimum mining acceptance scenario passes without hidden assumptions.

## Current status

- Unified test registry: complete.
- Node test entry point: complete.
- Pull-request CI observability: in progress.
- Dynamic-load frequency propagation: complete.
- Explicit-unserved and EENS semantics: corrected; regression verification pending.
- Minimum mining acceptance scenario: pending.

No new feature work is permitted until the exit criteria are met.
