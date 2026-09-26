# GLOBAL HOLDINGS — BUILD 339 PHASE 1B-B CHECKPOINT

**Date:** 2026-09-24  
**Build:** 339  
**Version:** 3.0.0  
**Save Schema:** 2.0.0  
**Production approval:** CLOSED

## Authoritative parent

Phase 1B-B was developed only from the verified Phase 1B-A archive:

- `GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- Parent runtime SHA-256: `835709c802e82d968a259224563dda0a3c7e242f21ac322bc09703e1226f6cb8`
- Parent WebApp SHA-256: `3bdd4ae860baee183dc54715a9bb0d4298cd9073371f9d2eee60508c6cb33338`
- Parent ZIP SHA-256 verified from actual archive bytes / checksum / verification JSON: `c3c747a187ecee6def4fe94125205f5ea0ff61015ec2be5b05e7cfd63909f1ee`

The alternate Phase 1B-A ZIP hash beginning `c3c747a1fce8...` is a documentation typo and MUST NOT be used as source identity.

Build 338 remains frozen fallback only. No IPA, unpacked IPA, `.app`, or Payload tree was used as development source.

## Phase 1B-B result

Phase 1B-B separates the following runtime concerns from authoritative simulation time:

- wall-clock pacing;
- backlog accumulation;
- cooperative execution budget;
- render cadence;
- persistence cadence.

`state.simSeconds` remains the only committed economic simulation-time source.

### New runtime owner

Created:

- `WebApp/simulation-pacing-core.js`

This owner is runtime-only. It has no `state` ownership and no `simSeconds` concept. It owns the wall-clock anchor, runtime backlog, hidden/suspended/paused pacing behavior, per-frame execution deadline, and render/persist cadence timers.

### Scheduler integration

Updated `WebApp/simulation-core.js` so that:

- variable deterministic slices remain unchanged;
- 30x / 120x / 300x / 600x remain variable rates rather than a fixed 600-second scheduler;
- exact Hour/Day boundary clamping remains owned by `simulation-time-core.js`;
- manual advance remains target-driven and may use up to 3600-second batches subject to domain-owner limits;
- manual advance refreshes the wall-clock anchor each frame so time spent inside manual advance cannot leak into later live catch-up;
- hidden/background time is never replayed as economic catch-up;
- backlog is consumed only after a committed slice;
- execution budget and render/persist cadence are runtime pacing concerns only;
- full rollback snapshots remain enabled.

### Persistence separation

Updated `WebApp/app.js` to stop copying `simulationEngine.snapshot()` into persisted `state.simulationKernel` during render cadence.

Updated `WebApp/save-schema.js` so normalization removes legacy runtime scheduler/pacing snapshot fields from `simulationKernel`, while retaining semantic/audit fields such as:

- `lastAtomicCommit`;
- `lastAtomicCancel`;
- `lastAdvanceFailure`;
- `lastCompactDay`;
- `boundaryRecovery`.

Save Schema remains **2.0.0**.

## Locked Phase 1B-B runtime identity

- Runtime source tree SHA-256: `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`
- WebApp tree SHA-256: `ada2977ddadc0f6df1558acd0b4543de77163da5ae0bfa6b63eb087522a9489e`
- Runtime files: 482

## Regression evidence

PASS locally:

- Build339 architecture bootstrap: 12/12
- Build339 Golden Time Contract
- Build339 Phase1B-B pacing separation contract
- Build339 transaction write-set audit: 5/5
- Build339 simulation write-set contract: 2/2
- Build339 Hour-boundary write map: 2/2
- Build339 Day-boundary write map: 2/2
- Build334 simulation-time contract, including exact 30/120/300/600 rates
- Build334 scheduler liveness: 14/14
- Build334 late-frame liveness: 4/4
- Build334 R3 calendar work: 13/13
- Build334 calendar owner cadence
- Build336 Hour83 proof/calendar regression
- durable post-commit contract: 6/6
- finance settlement contract
- document-proof v3 security
- durable authorization: 5/5
- 600-air calendar regression
- deferred save lifecycle
- persistence snapshot consistency
- persistence root coalescing
- Build338 idempotency/save-lag root compatibility
- source-layout validation: 10/10
- official `tools/verify_current_source.py`: PASS

### Local lint limitation

`npm run lint` could not start because the current local source environment does not contain the `eslint` package (`MODULE_NOT_FOUND`). No dependency was injected into the source to hide this environment limitation. Node 24 / ESLint / full CI remains a mandatory gate.

## Explicit non-changes

Phase 1B-B does NOT:

- remove full snapshots;
- activate root-journal/COW;
- change Save Schema;
- change Day → Hour midnight ordering;
- change finance/day-close semantics;
- redesign route assignment;
- slim the asset data model;
- redesign tripArchive;
- implement export/import repair;
- migrate the dense map renderer;
- approve production or an IPA candidate.

## Next action — Phase 1C

Only after continuing from the exact locked Phase 1B-B source may Phase 1C begin.

Phase 1C scope:

1. Capture-On-First-Write / sparse undo journal.
2. Root/entity hybrid rollback.
3. Automatic full-snapshot fallback for any unproven writer.
4. Never remove full snapshots until writer coverage and byte-equivalent rollback are proven for the migrated scope.
5. Re-run Hour83, Day-close, scheduler, late-frame, 600-air, write-set, save/restore, and integrity regressions after each sub-batch.

Later phases remain queued: slim asset/data-oriented model, persistence/export/import, map/render architecture, route diversity/anti-congestion, tripArchive growth control, and 5k/10k/20k stress harness.
