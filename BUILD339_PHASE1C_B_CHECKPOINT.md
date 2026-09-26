# GLOBAL HOLDINGS — BUILD 339 PHASE 1C-B WRITER PROOF CHECKPOINT

**Date:** 2026-09-24  
**Build:** 339  
**Version:** 3.0.0  
**Save Schema:** 2.0.0  
**Production approval:** CLOSED

## Parent

Phase 1C-B starts only from locked Phase 1C-A. No rejected Phase 1C experiment was reused.

- Parent runtime SHA-256: `1e158524e74d6360b334568af89f088e7fe65b22574a8de2ece49ab0de0c4779`
- Parent WebApp SHA-256: `fe2d7fc5e10b4695c9dec3feb9f0d0fe4be27cfa8cf08e8bb094d9a6206e5026`
- Parent ZIP SHA-256: `574dbe1d213ba0b10d011c5e703a565107332c11f10ec82959848538fc47b7ea`

## Source identity

- Runtime source tree SHA-256: `8570d5d7c6b9add34196b564d7f4498648c719a397eb598a65b21b00c9ac9325`
- WebApp tree SHA-256: `6f12bf6b4f76859229936d1f382d7865275c390e6eb6e7eb7aee9bc2591e91af`
- Runtime files: **482**
- Live simulation journal: **OFF**
- Hour journal: **OFF**
- Day journal: **OFF**
- Full Snapshot fallback: **ON**

## Phase 1C-B changes

- Composite writer admission: `mayJoin` forces Full Snapshot before apply; an unexpected late `join()` from journal mode is rejected rather than promoted after prior writes.
- Journal field values are restricted to JSON-safe primitives: finite number, string, boolean, or null.
- Nested asset mutation is not admitted to field journal; it requires broader protection.
- Write-set barrier is executed before irreversible critical persistence.
- `dependency-core.detectCycles()` is read-only and no longer calls `ensure(state)`, allowing `integrity-final` to be proven read-only on frozen realistic state.
- Exact tested root contracts were captured for steady owners.

## Writer proof

- finance `apply-simulation-journal`: `finance`, `sectorProfitToday`, `todayProfit`, `tripCountAccrued`, `tripFuelAccrued`, `tripMaintenanceAccrued`, `tripProfitAccrued`, `tripRevenueAccrued`
- corporate `adjust-group-value`: `groupValue`
- operations `record-alert`: `alerts`, `eventLog`, `operations`
- mobility inactive steady owner: `mobility`
- integrity-final: read-only on realistic deep-frozen state
- tested owner entrypoints are synchronous and contain no scheduler primitives

These are tested contracts, not blanket proof for every helper/active mobility branch.

## Test gates

- Phase1C-B readiness: **PASS 7/7**
- Phase1C-A adversarial: **PASS 8/8**
- Phase1C 600-asset equivalence: **PASS**; journalRecords=1202; wholeAssetCopies=0
- Phase1C-B writer proof: **PASS 6/6**
- historical selected regressions: PASS

## 20,000+ asset rule

This checkpoint is **not 20k-ready journal activation**. The current test journal pre-captures many asset fields and can allocate too many records at 20k. Before live activation, Phase 1C-C must implement or prove a capture-on-first-write / flat-buffer or equivalently allocation-bounded journal path, then benchmark on iPhone JavaScriptCore at 600 / 2k / 5k / 10k / 20k / 25k assets.

## NEXT ACTION — PHASE 1C-C

1. Design allocation-bounded capture-on-first-write for hot asset fields without Proxy.
2. Preserve pre-execution writer admission and Full Snapshot fallback.
3. Prove active mobility/helper branches and no async/stale-reference state writes.
4. Keep Hour/Day/delivery/structural paths on Full Snapshot.
5. Do not wire live steady slices until Node equivalence gates and physical iPhone JavaScriptCore measurements pass.
