# GLOBAL HOLDINGS — BUILD 339 PHASE 1B-A CHECKPOINT

**DATE:** 2026-09-24  
**STATUS:** LOCKED PORTABLE SOURCE / NOT PRODUCTION APPROVED  
**ACTIVE PHASE:** Phase 1B-A complete — Phase 1B-B next  
**BUILD:** 339  
**VERSION:** 3.0.0  
**SAVE SCHEMA:** 2.0.0

## 1. Authoritative source

This checkpoint supersedes Build339 Phase1A for active development.

- Runtime source tree SHA-256:
  `835709c802e82d968a259224563dda0a3c7e242f21ac322bc09703e1226f6cb8`
- WebApp tree SHA-256:
  `3bdd4ae860baee183dc54715a9bb0d4298cd9073371f9d2eee60508c6cb33338`
- Canonical full source archive:
  `GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- ZIP SHA-256:
  `c3c747a187ecee6def4fe94125205f5ea0ff61015ec2be5b05e7cfd63909f1ee`
- ZIP bytes: **132,278,323**
- Tracked source files in archive: **821**
- Runtime inventory files: **481**
- Library path:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- Library file ID:
  `libfile_45d494d042188191a4809466fa56cb19`
- Checksum:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip.sha256`
- Verification:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.verification.json`
- Verification Library file ID:
  `libfile_68ba3bb085a08191965fc527a81c63fb`

Archive verification:
- SHA-256 matches;
- ZIP CRC clean;
- embedded runtime manifest matches the source/WebApp hashes above;
- no IPA, .app, Payload, or .git development source is present;
- old_ipa_used=false.

## 2. Local provenance

- `93cbb47` — Build339 Phase1B-A: prove day writes and exact rollback order
- `ba6875a` — Build339 Phase1B-A: lock day-boundary rollback checkpoint

The portable source archive + runtime source hash are authoritative. Local commit IDs are provenance only.

## 3. Accepted Phase1B-A changes

### Day-boundary ownership proof

New contract:
`tests/build339-day-boundary-write-map.cjs`

It executes the actual `processFinancialDay()` body with real domain owners across 30 sequential simulated days and pins representative write maps.

Normal day roots:
- acceptedContracts
- advanced
- assets
- bank
- businessWorld
- cash
- companyBudgets
- companyFinance
- contractStartDays
- documentProofs
- domainRuntime
- failedBids
- finance
- groupValue
- lastClosedProfit
- lastClosedSectorProfit
- lastFinancialDay
- mobility
- operations
- profile
- realism
- todayProfit
- treasury

Payroll day roots:
- alerts
- businessWorld
- cash
- companyBudgets
- companyFinance
- documentProofs
- domainRuntime
- eventLog
- finance
- groupValue
- lastClosedProfit
- lastClosedSectorProfit
- lastFinancialDay
- operations
- realism
- sequences
- treasury

Month-end roots:
- alerts
- businessWorld
- cash
- companyBudgets
- companyFinance
- documentProofs
- domainRuntime
- eventLog
- finance
- groupValue
- lastFinancialDay
- operations
- realism
- sequences
- treasury

This proves Day boundaries are materially wider than ordinary Hour boundaries. Full Day rollback remains mandatory during Phase1B.

### Exact rollback serialization

The previous rollback restored equivalent values but could preserve property insertion order changed during a failed transaction. This was exposed by the month-end test in:
- `companyFinance`
- `finance`
- `treasury`

Root cause:
- plain-object `restoreValue()` restored values into existing objects without restoring snapshot key order;
- legacy scoped→full promotion constructed the promoted snapshot with remaining roots first and captured scoped roots later, changing top-level order.

Accepted fix in `WebApp/transaction-core.js`:
- plain-object rollback now reuses existing nested references where possible but deletes/reinserts enumerable keys in snapshot order;
- transaction context records initial root order;
- scoped rollback restores initial root ordering;
- scoped→full promotion rebuilds its full snapshot in original root order.

Result:
- month-end critical failure restores `JSON.stringify(state)` byte-equivalent to pre-transaction state;
- existing write-set undeclared-write rollback remains byte-equivalent;
- Hour/day full snapshots remain enabled.

## 4. Regression evidence

PASS:
- `npm run test:build339` including Day write map
- Build339 time golden
- transaction write-set audit 5/5
- simulation write-set 2/2
- hour-boundary write-map 2/2
- day-boundary write-map 2/2
- Hour83 corruption/rollback
- durable post-commit 6/6
- durable publication recovery 3/3
- simulation time contract
- calendar owner cadence
- calendar safety 7/7
- scheduler liveness 14/14
- late-frame liveness 4/4
- simulation fault isolation 3/3
- document-proof v3 security
- durable authorization 5/5
- finance settlement
- 600-air calendar regression
- Build338 idempotency/save/lag root contract
- source-layout 10/10
- official source verifier PASS

Local Node remains v22.16.0. Node24/full acceptance CI is not claimed.

## 5. Explicit non-changes

Phase1B-A did NOT:
- remove Full Snapshot rollback;
- activate root-journal/COW rollback;
- change Save Schema;
- change persistence/export/import;
- change route assignment;
- change asset layout;
- change map rendering;
- change Build338 runtime.

Any local/uncommitted root-journal experiment created before this checkpoint is **not accepted source** and must not be copied into continuation work.

## 6. NEXT ACTION — Phase 1B-B

Start only from the exact Phase1B-A source above.

Goal:
**separate simulation pacing/backlog/render cadence from authoritative economic time while preserving all pinned time and boundary semantics.**

Required order:
1. Map current `simulation-core.js` frame accumulator, backlog, governor, yield, render and persistence cadence owners.
2. Define a pure pacing/backlog policy object/component that owns no economic state.
3. Keep `state.simSeconds` as the sole committed simulation-time source.
4. Keep `simulation-time-core.js` as the pure boundary planner.
5. Rendering cadence may decide when to draw but may never advance economic time.
6. Persistence cadence may request a save but may never mutate simulation progression.
7. Preserve:
   - 30/120/300/600 rates;
   - maxRealDelta stall behavior unless separately migrated with a golden contract change;
   - exact Hour/Day boundary order;
   - manual advance exactness;
   - no skipped/duplicated boundary effects;
   - Hour83 rollback;
   - Day-close accounting.
8. Full rollback snapshots remain enabled throughout Phase1B-B.
9. Root-journal/COW implementation remains Phase1C only.
10. After each accepted sub-batch: rerun the full Phase1B-A regression set and update this MASTER/checkpoint immediately.

## 7. New-chat continuation

A new conversation must:
1. read `GLOBAL_HOLDINGS_MASTER_HANDOFF.md`;
2. read `GLOBAL_HOLDINGS_BUILD339_MASTER.md`;
3. read this checkpoint;
4. materialize the Phase1B-A canonical archive;
5. verify ZIP SHA-256 `c3c747a187...09f1ee`;
6. run `tools/verify_current_source.py` and require runtime source SHA `835709c802...6f6cb8`;
7. continue Phase1B-B only.

Do not resume from Phase0, Phase1A, Build338, an IPA, or an uncommitted local experiment.
