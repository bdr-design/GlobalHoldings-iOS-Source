# GLOBAL HOLDINGS — BUILD 339 PHASE 1C-A CHECKPOINT

**Date:** 2026-09-24
**Build:** 339
**Version:** 3.0.0
**Save Schema:** 2.0.0
**Production approval:** CLOSED

## Parent

Phase 1C-A starts only from the locked Phase 1B-B source. No rejected Phase 1C experiment was reused.

- Parent runtime SHA-256: `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`
- Parent WebApp SHA-256: `ada2977ddadc0f6df1558acd0b4543de77163da5ae0bfa6b63eb087522a9489e`
- Parent ZIP SHA-256: `acd6cc9f324d6eb2975f74f076421f253e3cff5229104dc319f50a819b2fde77`

## Locked Phase 1C-A source

- Runtime source tree SHA-256: `1e158524e74d6360b334568af89f088e7fe65b22574a8de2ece49ab0de0c4779`
- WebApp tree SHA-256: `fe2d7fc5e10b4695c9dec3feb9f0d0fe4be27cfa8cf08e8bb094d9a6206e5026`
- Full source archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1C_A_TRANSACTION_FOUNDATION_SOURCE.zip`
- ZIP SHA-256: `574dbe1d213ba0b10d011c5e703a565107332c11f10ec82959848538fc47b7ea`
- Archive Library ID: `libfile_c39fc7197a2c81919e26d6f2198966a3`
- Verification Library ID: `libfile_7e3fa202a9ec81918e5726d57d498839`
- Checksum Library ID: `libfile_eade2b2309ec81918413e329aea92de7`
- Runtime files: **482**

The archive was re-extracted and `tools/verify_current_source.py` passed on the extracted copy.

## What changed

Only transaction/journal foundation and tests. The simulation runtime does **not** request journal mode yet.

Implemented in `WebApp/transaction-core.js`:

- opt-in `rollbackMode: 'journal'`;
- pre-execution Full Snapshot fallback for unproven writer contracts;
- pre-execution fallback for structural writers and unproven/mutating validation;
- conservative journal → Full Snapshot promotion before joined writers;
- conservative promotion before mutating or unproven critical hooks;
- terminal irreversible critical ordering guard so persistence cannot run before later rollback-capable critical work;
- primitive own-data field journal for explicitly declared asset fields;
- descriptor-based restoration for field-level rollback without delete/reinsert;
- telemetry for rollback storage, fallback reason and journal record count;
- root-order rollback guard that avoids accessor reads when order did not change.

## Tests-first evidence

`tests/build339-phase1c-adversarial-contract.cjs`: **PASS 8/8**.

The original clean Phase 1B-B baseline failed all eight new Phase 1C activation tests, including real leaks outside scoped rollback and a persistence ordering case where browser cache could publish a rolled-back state. Phase 1C-A closes those test contracts inside the transaction owner.

`tests/build339-phase1c-equivalence-gate.cjs`: **PASS** with 600 assets.

- Full Snapshot success result == Journal success result byte-for-byte.
- Full Snapshot rollback == Journal rollback byte-for-byte.
- Integrity critical set unchanged after rollback.
- Journal records: **1202** in the 600-asset fixture.
- Whole 600-asset array copies on journal path: **0**.

This is Node architecture evidence only, not an iPhone benchmark.

Regression PASS after the transaction-core change:

- Build339 Golden Time
- Phase1B-B pacing separation
- transaction write-set audit
- simulation write-set contract
- Hour write map
- Day write map
- both historical transaction-promotion suites 5/5
- Hour83
- durable post-commit
- durable authorization
- finance settlement
- delivery atomic reconciliation
- scheduler liveness
- late-frame liveness
- 600-air calendar
- persistence snapshot consistency
- persistence root coalescing
- deferred save lifecycle
- source-layout 10/10
- official source verifier

## Activation state

- Steady simulation journal: **OFF**
- Hour boundary journal: **OFF**
- Day boundary journal: **OFF**
- Full Snapshot fallback: **ON**
- Production approval: **CLOSED**

## NEXT ACTION — PHASE 1C-B

1. Prove exact write contracts for steady-slice joined owners: finance, corporate, operations and mobility.
2. Prove `integrity-final` hooks are read-only before marking them read-only.
3. Only then wire journal to no-boundary / no-delivery steady slices.
4. Keep Hour and Day boundaries on Full Snapshot.
5. Re-run Hour83, Day-close, scheduler, late-frame, 600-air, save/restore and persistence gates.
6. Measure on JavaScriptCore/iPhone before any performance claim or broader activation.
