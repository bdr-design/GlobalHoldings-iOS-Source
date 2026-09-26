# GLOBAL HOLDINGS — BUILD 339 PHASE 1C-A CHECKPOINT

**Date:** 2026-09-24  
**Build:** 339  
**Version:** 3.0.0  
**Save Schema:** 2.0.0  
**Production approval:** CLOSED

## Parent

Phase 1C-A starts only from the locked Phase 1B-B archive and runtime hash. No rejected Phase 1C experiment was reused.

- Parent runtime: `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`
- Parent WebApp: `ada2977ddadc0f6df1558acd0b4543de77163da5ae0bfa6b63eb087522a9489e`
- Parent ZIP: `acd6cc9f324d6eb2975f74f076421f253e3cff5229104dc319f50a819b2fde77`

## Phase 1C-A scope

Transaction-core foundation only. The simulation runtime does **not** request journal mode yet. Hour/Day boundaries and all existing app transactions therefore remain on their previous rollback behavior.

Implemented in `WebApp/transaction-core.js`:

- opt-in `rollbackMode: 'journal'`;
- pre-execution Full Snapshot fallback for unproven/structural writers and unproven validation;
- conservative journal→Full promotion before any joined writer;
- conservative promotion before mutating/unproven critical hooks;
- terminal irreversible critical ordering guard for persistence publication;
- primitive own-data field journal for explicitly declared asset fields;
- descriptor-based restoration of existing asset fields;
- telemetry: rollback storage, fallback reason, journal record count;
- root-order rollback guard that avoids reading accessors when order is unchanged.

## New gates

`tests/build339-phase1c-adversarial-contract.cjs`: **PASS 8/8**.

`tests/build339-phase1c-equivalence-gate.cjs`: **PASS** with 600 assets. Successful journal commit matched Full Snapshot output byte-for-byte; forced rollback matched Full Snapshot rollback; integrity critical set remained identical; `wholeAssetCopies=0`; journal records=1202 for the 600-asset fixture. This is architecture evidence on Node, not an iPhone performance benchmark.

All selected Phase1B-B / Hour83 / finance / delivery / scheduler / persistence regressions passed after the transaction-core change. Both historical transaction-promotion suites pass 5/5.

## Locked runtime identity

- Runtime source tree SHA-256: `1e158524e74d6360b334568af89f088e7fe65b22574a8de2ece49ab0de0c4779`
- WebApp tree SHA-256: `fe2d7fc5e10b4695c9dec3feb9f0d0fe4be27cfa8cf08e8bb094d9a6206e5026`
- Runtime files: 482

## Activation state

- Simulation steady-slice journal: **OFF**
- Hour boundary journal: **OFF**
- Day boundary journal: **OFF**
- Full Snapshot fallback: **ON**

## NEXT ACTION — Phase 1C-B

1. Prove exact write contracts for steady-slice joined owners (`finance`, `corporate`, `operations`, mobility path).
2. Prove integrity-final hooks are read-only before marking them read-only.
3. Wire journal only to no-boundary / no-delivery steady slices after those proofs.
4. Keep every Hour/Day boundary on Full Snapshot.
5. Run 600-air, Hour83, save/restore, late-frame, and persistence regressions again.
6. Benchmark on JavaScriptCore/iPhone before any performance claim or broader activation.
