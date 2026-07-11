# V7 Debt Cleanup Status

## Exit criteria

Debt cleanup is complete only when all items below are satisfied:

1. The full regression suite executes in Node and in the browser harness.
2. The pull-request CI run is visible and green.
3. Connected demand, explicit unserved load, nominal shed blocks, transient power residual, and EENS remain separate quantities.
4. Dynamic loads receive the simulation frequency and time context.
5. Every protective or supervisory action creates traceable evidence.
6. The minimum mining acceptance scenario passes without hidden assumptions.

## Final status

- Unified test registry: complete.
- Node test entry point: complete.
- Browser harness uses the same registry: complete.
- Pull-request CI observability: complete.
- Test-output artifact retention: complete.
- Dynamic-load frequency and time propagation: complete.
- Explicit-unserved, nominal shed-block, connected-demand, transient-residual, and EENS separation: complete.
- Persistent BESS balance error: corrected with secondary balance bias.
- Event-triggered EMS dispatch for material load changes: complete.
- Predictive commitment scenario uses explicit diesel dynamic parameters: complete.
- Minimum mining acceptance scenario: complete.
- Final regression result: 35/35 passed.

## Minimum mining acceptance chain

The accepted chain is:

`12 MW stable operation → largest DG trip → BESS fast support → BESS trip → staged noncritical UFLS → frequency recovery → BESS restoration → staged load restoration → retained EENS evidence`.

## Governance

Debt cleanup is closed for the current V7 scope. New feature work may resume only through the same test-first pull-request workflow. Any change to equipment physics, control authority, protection behavior, reserve accounting, or reliability metrics must add or update deterministic regression evidence.
