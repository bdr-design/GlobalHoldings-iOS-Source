# GLOBAL HOLDINGS — BUILD 339 PHASE 1A CHECKPOINT

**DATE:** 2026-09-24  
**STATUS:** LOCKED SOURCE CHECKPOINT / NOT PRODUCTION APPROVED  
**ACTIVE PHASE:** Phase 1A complete — Phase 1B next  
**BUILD:** 339  
**VERSION:** 3.0.0  
**SAVE SCHEMA:** 2.0.0

## 1. Authoritative portable source

This checkpoint supersedes every Phase 0 archive for active development.

- Runtime source tree SHA-256:
  `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`
- WebApp tree SHA-256:
  `7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901`
- Canonical full source archive:
  `GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- ZIP SHA-256:
  `ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`
- ZIP bytes: **132,292,257**
- Library path:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- Library file ID:
  `libfile_a073f623e3a08191b19729b246946975`
- Checksum file:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip.sha256`
- Canonical verification:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.verification.json`
- Verification Library file ID:
  `libfile_31aa4d6145ec8191b79a76171d259543`

The canonical archive was independently rechecked:
- ZIP checksum matches;
- CRC passes;
- no IPA, .app, Payload, or .git development source is present;
- embedded RUNTIME_SOURCE_MANIFEST identifies Build 339 / Save Schema 2.0.0 / Phase 1A and matches both runtime and WebApp hashes above.

## 2. Frozen fallback

Build 338 remains frozen fallback/provenance only.

- Build338 runtime source tree:
  `387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b`

Do not resume functional development on Build338. Return to it only if Build339 develops an unacceptable architectural regression that cannot be safely isolated.

## 3. Phase 1A accepted architecture

### A. Deterministic time planner

Added:
- `WebApp/simulation-time-core.js`

Responsibilities are intentionally pure:
- calculate hour/day boundary arithmetic;
- calculate next boundary;
- clamp a requested slice to the next boundary;
- plan a slice;
- expose deterministic boundary order.

It does **not** own state and does **not** write `simSeconds`.

`state.simSeconds` remains the authoritative committed simulation time through the existing simulation owner.

### B. Golden time compatibility contract

Added:
- `tests/build339-time-golden.cjs`
- `tests/fixtures/build339-time-golden-v1.json`

Pinned behavior:
- manual advance to 90,000 seconds completes exactly;
- 25 hourly boundaries and one day boundary;
- current maintenance cadence remains hours 11 and 23;
- midnight slice is 82,800 → 86,400;
- midnight order remains **day → hour**;
- a 1-second real interval at speed 600 from sim 3500 splits as 3500→3600 then 3600→4100;
- a real stall beyond maxRealDelta is dropped according to the current safety policy and does not silently advance economic time.

### C. Transaction write-set proof tooling

The existing rollback architecture was **not replaced**.

Added opt-in architecture instrumentation to `GH_TRANSACTION_CORE`:
- declared root writes;
- actual mutated root writes;
- undeclared roots;
- declared-but-unchanged roots;
- failure-before-rollback evidence;
- optional enforcement in architecture tests.

Normal gameplay does not enable this audit and does not take the audit-only full baseline.

Full hour/day rollback snapshots remain enabled.

### D. Proven root write maps

Actual clean-source hourly market owner mutated roots:

- advanced
- controlPlane
- deliveryClosure
- domainRuntime
- lastMarketHour
- maPortfolio
- portfolio
- portfolioBook
- realism
- simulationWorld

Ordinary simulation probe mutated roots:

- assets
- mobility
- sectorProfitToday
- simSeconds
- simulationKernel
- todayProfit

A deliberately undeclared root write is rejected under enforcement and the state rolls back byte-equivalent.

## 4. Local provenance commits

- `8d5c6f2` — Build339 Phase1: extract deterministic simulation time planner
- `d125e2e` — Build339 Phase1: add opt-in transaction write-set audit
- `cc4b023bcfcfc08cbad5a071572dc467ba804677` — Build339 Phase1A: lock time contract and write-set proof

Local git commit IDs are provenance. The portable archive + source tree hash are the continuation authority.

## 5. Regression evidence from locked HEAD

PASS:
- Build339 architecture bootstrap: 12/12
- Build339 time golden: PASS
- transaction write-set audit: 5/5
- simulation write-set contract: 2/2
- hour-boundary write map: 2/2
- simulation time contract: PASS
- calendar owner cadence: PASS
- 600-air calendar regression: PASS
- calendar safety contract: 7/7
- scheduler liveness: 14/14
- late-frame liveness: 4/4
- Hour83 calendar/proof corruption rollback: PASS
- source-layout: 10/10
- official source verifier: PASS

The 600-air Node regression completed one simulated day with:
- 24 hour calls;
- one day call;
- 600 moved assets;
- no conflicts;
- no cancels.

This is a regression contract, **not an iPhone performance benchmark**.

## 6. Explicit non-changes

Phase 1A did NOT:
- remove hourly/day fullSnapshot;
- replace rollback storage with COW/journal;
- change Save Schema;
- change persistence format;
- change export/import;
- change route ownership;
- change asset storage layout;
- change map renderer;
- mutate Build338 runtime.

## 7. Mandatory pending gates

Not yet claimed:
- Node 24 + ESLint + full source acceptance CI;
- Fresh Xcode/iPhoneOS Release;
- WKWebView/navigation gates;
- native storage / A-B vault gates;
- physical iPhone Build339 diagnostic;
- architecture stress testing on device.

## 8. NEXT ACTION — Phase 1B

Do not repeat Phase 0 or Phase 1A.

Order:

1. **Complete the real Day-boundary write map** using the same opt-in write-set proof system.
2. **Separate pacing/backlog/render cadence from authoritative simulation time** while preserving the Phase1A golden contract exactly.
3. Keep `state.simSeconds` as the sole committed economic time source.
4. Preserve exact boundary ordering and no skipped/duplicated hour/day effects during normal speed, 600x, manual advance, late frames and backlog catch-up.
5. Keep the existing full rollback snapshots during Phase 1B.
6. Re-run Hour83, day close, scheduler liveness, late-frame, 600-air, write-set and save-related regressions after each accepted sub-batch.
7. Only after Phase 1B write coverage is proven may **Phase 1C** implement root-journal / snapshot-on-first-write / copy-on-write rollback storage with automatic full-snapshot fallback for unproven writers.
8. Update this checkpoint/master after every accepted batch.

## 9. New-chat recovery protocol

A new conversation must:

1. read `GLOBAL_HOLDINGS_MASTER_HANDOFF.md` from `globalholdings-project-control`;
2. read `GLOBAL_HOLDINGS_BUILD339_MASTER.md` and this file from `build339-architecture-control-20260924`;
3. materialize the canonical Phase1A archive from Library;
4. verify ZIP SHA-256 `ea9e58c...`;
5. run `tools/verify_current_source.py` and require runtime source hash `2d9773fc...`;
6. continue Phase 1B only.

Do not use an IPA, unpacked app, Phase0 archive, or a reconstructed patch stack as active source.
