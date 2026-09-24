# GLOBAL HOLDINGS — BUILD 339 ARCHITECTURE MASTER

**STATUS:** ACTIVE ARCHITECTURE MIGRATION — PHASE 1C-B LOCKED / PHASE 1C-C NEXT
**CREATED:** 2026-09-24  
**CONTROL BRANCH:** `build339-architecture-control-20260924`  
**REPOSITORY:** `bdr-design/GlobalHoldings-iOS-Source`

## HISTORICAL CHECKPOINT — Build 339 Phase 1A

**Historical evidence only. This Phase 1A section is superseded by the Phase 1B-B continuation section at the end of this MASTER.**

- Active development source: **Build 339 Phase 1A**
- Version: **3.0.0**
- Build: **339**
- Save Schema: **2.0.0**
- Runtime source tree SHA-256: `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`
- WebApp tree SHA-256: `7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901`
- Full source archive: `GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- Source ZIP SHA-256: `ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`
- Source ZIP bytes: **132,292,257**
- Library path: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- Library file id: `libfile_a073f623e3a08191b19729b246946975`
- Runtime files in source manifest: **481**
- old_ipa_used: **false**
- production_approved: **false**
- physical_device_tested: **false**

### Phase 1A accepted architecture

1. **Time ownership was not blindly rewritten.** Clean-source tracing proved the existing scheduler already keeps economic time authoritative through the simulation adapter / `state.simSeconds`, accumulates backlog separately, commits atomic slices first, and only then synchronizes external simulation time.
2. Exact hour/day boundary arithmetic was extracted to the new owner `WebApp/simulation-time-core.js` while preserving scheduler semantics.
3. A golden time fixture now pins:
   - manual advance to 90,000 seconds;
   - exact hour splits;
   - midnight `day -> hour` order;
   - 5-second real stall drop policy;
   - live 3500 -> 3600 -> 4100 boundary split.
4. `GH_TRANSACTION_CORE` now contains an **opt-in Build 339 write-set proof system**:
   - `writeRoots`;
   - `auditWrites`;
   - `enforceWriteRoots`;
   - actual mutated-root reporting;
   - undeclared-root reporting;
   - byte-equivalent rollback when enforcement fails.
5. Write auditing is **disabled in normal gameplay by default**. Scoped transactions take an extra full audit baseline only when the architecture audit is explicitly enabled; normal runtime therefore pays no audit clone/compare cost.
6. `createSimulationSliceJob` supplies the existing ordinary-slice scope as a declared write set when audit mode is enabled. Hour/day boundaries still retain full rollback at this checkpoint.
7. An actual clean-source hourly Market execution established this current dynamic write map:
   `advanced, controlPlane, deliveryClosure, domainRuntime, lastMarketHour, maPortfolio, portfolio, portfolioBook, realism, simulationWorld`.
8. A late critical failure after the actual hourly owner restores the complete tested state byte-equivalent.
9. **Full Snapshot has NOT been removed yet.** Phase 1A exists specifically to prove ownership before that step.

### Phase 1A regression evidence

Passed locally:
- Build339 architecture bootstrap: 12/12
- Build339 time golden: PASS
- Build339 transaction write-set audit: 5/5
- Build339 simulation write-set contract: 2/2
- Build339 actual hour-boundary write map: 2/2
- Build334 simulation-time contract: PASS
- Build334 calendar owner cadence: PASS
- Build334 600-air one-day regression: PASS
- Build334 calendar safety: 7/7
- Build334 scheduler liveness: 14/14
- Build334 late-frame liveness: 4/4
- Build336 Hour83 proof corruption/calendar rollback: PASS
- transaction promotion regressions: 5/5 + 5/5
- document-proof v3 security/rollback: PASS
- durable post-commit: 6/6
- source layout: 10/10
- source verifier: PASS

Local tests used Node 22 where applicable; **Node 24 / ESLint / full acceptance CI and Apple/device gates remain mandatory and pending**.

### Source-history notes

The local clean-source provenance history for this phase recorded:
- `8d5c6f2` — deterministic simulation-time planner extraction
- `d125e2e` — opt-in transaction write-set audit
- `cc4b023` — Phase 1A source/hash lock

The portable full-source archive above is authoritative for cross-conversation continuation; do not rely on a local worktree or those local commit ids alone.

### Rejected / not-yet-approved changes

- No direct switch from full hourly snapshot to scoped snapshot.
- No disabling/reducing integrity checks.
- No live-reference proof verification.
- No Save Schema bump.
- No new persistence format yet.
- No route/asset/render/tripArchive migration yet.
- No claim of 20,000-asset or 60 FPS capability yet.

### NEXT ACTION — Phase 1B

Continue only from the Phase 1A source identity above.

1. Produce a **day-boundary dynamic write map** with the same proof standard used for the hourly path.
2. Introduce a root-journal / snapshot-on-first-write mode **inside the existing GH_TRANSACTION_CORE**, not a second transaction system.
3. Unknown/unmigrated nested owners must safely fall back/promote to the existing full snapshot until their write ownership is proven.
4. Add owner-declared write roots for Domain Commands incrementally; Domain Command infrastructure must include its own persistent roots such as `domainRuntime`, event/control evidence, and approval/proof roots when applicable.
5. Keep byte-equivalent rollback tests enabled while migrating owners.
6. Only after Hour + Day paths demonstrate complete declared-write coverage may Build 339 stop using the full hourly/day snapshot.
7. Recompute hashes, archive a full source checkpoint, and update this MASTER after every accepted batch.



## 1. Project decision

Build 338 is now **FROZEN** as the last verified runtime/provenance fallback baseline.

All new functional and architectural development moves to **Build 339**.

Build 339 is not a patch stack over Build 338. It is an independent architecture generation that must bootstrap only from the exact verified Build 338 source identity recorded below, then establish its own immutable source hashes as soon as the first 339 candidate exists.

## 2. Frozen fallback baseline — Build 338

- Version: 3.0.0
- Build: 338
- Save Schema at fallback point: 2.0.0
- Verified runtime source tree SHA-256:
  `387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b`
- WebApp tree SHA-256:
  `aed5ebc6773603702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3`
- Full source archive:
  `GlobalHoldings_BUILD338_SAVE_LAG_ROOT_CANDIDATE_SOURCE.zip`
- Source ZIP SHA-256:
  `0a5be18327001bb0ceaf4feec99946f36b8eb0290d40523ddfa3265ab5285335`
- Library source path:
  `/GlobalHoldings-Releases/Build338/GlobalHoldings_BUILD338_SAVE_LAG_ROOT_CANDIDATE_SOURCE.zip`
- Runtime CI input commit:
  `6d62866bc83d551487961d13eeade8802a31eba3`

**Fallback rule:** if Build 339 develops a structural fault, unrecoverable migration failure, broken financial/proof invariants, non-deterministic time behavior, restore failure, or unacceptable regression that cannot be isolated safely, development must return to this exact Build 338 source identity. Never reconstruct the fallback from memory, an IPA, an unpacked app, or a moving branch head.

## 3. Build 339 architectural mandate

Build 339 is authorized to redesign internal architecture where required, including:

- time engine and scheduler;
- simulation stepping and backlog processing;
- transaction/rollback architecture;
- state ownership and data-oriented layout;
- asset runtime representation and catalog/flyweight separation;
- route assignment, corridor identity, occupancy and departure scheduling;
- persistence, serialization and native save/export/import pathways;
- integrity/proof performance while preserving semantics;
- map/render architecture and simulation/render separation;
- archival/compaction after full reference audits.

The goal is not to preserve inefficient internal implementation details. The goal is to preserve correct game behavior, accounting semantics, proof semantics, deterministic progression, atomicity, restore/replay correctness and user-facing behavior unless a deliberate product change is separately approved.

## 4. Non-negotiable safety invariants

Even though Build 339 may replace old architecture, it must preserve or deliberately migrate:

- single authoritative simulation time;
- deterministic boundary ordering;
- all-or-nothing state-changing operations;
- rollback correctness;
- double-entry accounting integrity;
- company-account separation;
- no asset delivery after failed payment/approval;
- proof/document integrity and canonical digest compatibility where retained;
- event/revision/idempotency sequencing;
- Native ACK ordering and A/B vault correctness;
- save -> terminate -> restore correctness;
- route lifecycle correctness;
- financial day-close correctness;
- no hidden post-commit state mutation without an owner and transaction boundary.

## 5. Save Schema policy

Build 338 fallback remains Save Schema **2.0.0**.

Build 339 starts with compatibility to 2.0.0 as an input/migration requirement. A schema bump is allowed only if architecture proves it necessary and the change includes:

1. an explicit schema decision;
2. atomic migration;
3. rollback/fallback behavior;
4. Build 338 save import compatibility or an explicit conversion path;
5. success/failure/replay/restore tests;
6. recorded hashes and migration evidence.

Never silently relabel incompatible persisted data as 2.0.0.

## 6. Source discipline

Build 339 must not use as development source:

- any IPA;
- unpacked IPA/Payload/.app;
- Build 337 or older;
- patch stacks over an unknown state;
- mixed source trees;
- reconstructed changes from memory.

Until the first Build 339 candidate source hash is locked, the only bootstrap source is the exact frozen Build 338 runtime source tree/archive listed in Section 2.

## 7. Architecture work order

1. Produce/verify the Build 338 dependency and hidden-invariant map from clean source.
2. Establish Build 339 clean source workspace and its own source identity.
3. Rebuild time/scheduler architecture with deterministic fixed-step/bounded work semantics.
4. Replace full-tree rollback dependence with a proven mutation journal / copy-on-write / write-set architecture where appropriate.
5. Separate static asset metadata from authoritative dynamic state through a compatibility layer.
6. Separate simulation state from visual/render state.
7. Rebuild persistence/export/import so user-facing backup round trips are native-backed and verified.
8. Rebuild route assignment/corridor/departure ownership to eliminate unjustified concentration.
9. Profile and replace dense DOM rendering only with measured evidence.
10. Audit and redesign archival growth (especially mobility.tripArchive) without breaking finance/proof references.
11. Run golden regressions and device stress tests after every major architectural boundary.

## 8. Golden rollback / regression gates

At minimum, Build 339 must continuously protect:

- Hour83 proof corruption failure and rollback;
- day-close accounting balance;
- payable cheque/transfer;
- procurement/payment/asset-delivery atomicity;
- idempotency and replay;
- save/cold restore;
- user export -> reset/change -> import -> identity/state recovery;
- route lifecycle and batch departure;
- multiple hour/day boundaries under high speed;
- proofForensics with no dangling references;
- Native ACK ordering and vault restore.

## 9. Build 338 freeze / Build 339 fallback decision

From 2026-09-24 onward:

- **No new functional development is to be extended on Build 338.**
- Build 338 remains readable and reproducible solely as the stable fallback/provenance baseline.
- Build 339 is the active architecture-development line.
- If Build 339 cannot preserve required invariants, the rollback point is the exact Build 338 identity in Section 2.
- A documentation-only freeze marker may exist on the Build 338 branch; it must never be interpreted as changing the verified Build 338 runtime source identity.

## 10. NEXT ACTION

Continue Build 339 from the clean verified Build 338 source archive/tree, but create a distinct Build 339 source workspace and source hash before functional code changes.

First implementation phase:

1. verify dependency/ownership map from clean source, not IPA;
2. lock Build 339 candidate source identity;
3. instrument time/transaction/integrity/render owners;
4. implement architecture changes in isolated, regression-gated batches;
5. keep Build 338 untouched as fallback runtime.


## 11. Phase 0 locked checkpoint — 2026-09-24

Phase 0 is complete as the first independent Build 339 full-source checkpoint.

### Authoritative Build 339 source

- Version: **3.0.0**
- Build: **339**
- Save Schema: **2.0.0**
- Runtime source tree SHA-256:
  `8564b451e24df4935cec1e3e9bab95b135f05b73e3b99afb077b3b86bffb577a`
- WebApp tree SHA-256:
  `06234729bd9a6395f23fc46c958b4ee8f7d5c9e99c66c93f5e1b1aea78ce1652`
- Full source archive:
  `GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BOOTSTRAP_SOURCE.zip`
- Source ZIP SHA-256:
  `0528355bb0ad1daca83ea09c09285a61a8d589c3981a113f9ae5000c263b1de9`
- Source ZIP bytes: **132,212,366**
- Library source path:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BOOTSTRAP_SOURCE.zip`
- Library file id:
  `libfile_8a29d23930cc8191877904f40fd325cc`
- Runtime files covered by source manifest: **480**
- old_ipa_used: **false**
- production_approved: **false**
- physical_device_tested: **false**

From this checkpoint onward, **Build 339 Phase 0 is the active development Source of Truth**. Build 338 must no longer be used for new work; it remains fallback only.

### Phase 0 implementation

Phase 0 intentionally changes identity/instrumentation only and does not intentionally change game semantics.

Implemented:
- aligned `BUILD`, native project build, package build and `RUNTIME_BUILD` to 339;
- retained Save Schema 2.0.0;
- transaction per-task post-commit timings including key/owner/priority/duration/success;
- control-plane baseline vs final integrity timing with schema/integrity/comparison split;
- Save Schema timing split for authorization, authorization proof verification, document collection, record proof verification, document verification, company-platform validation and remainder;
- render timing split for simulation frame sample, marker target collection, visible marker interpolation and structural map rebuild;
- diagnostics export includes the new transient telemetry;
- telemetry is runtime-only and must never become authoritative persistent state;
- added Build 339 bootstrap regression contract;
- reduced timing perturbation by timing proof loops in aggregate rather than calling the clock around every individual proof.

### Phase 0 regression evidence

Passed locally:
- source verifier: PASS;
- source-layout: 10/10;
- Build339 architecture bootstrap: 12/12;
- simulation time contract: PASS;
- 600-air calendar regression: PASS;
- asset/route/HR contract: PASS;
- finance settlement: PASS;
- finance company security: 8/8;
- durable authorization: 5/5;
- document-proof v3 security including rollback: PASS;
- durable post-commit: 6/6;
- Hour83 proof corruption/calendar rollback: PASS;
- core regressions: PASS;
- fleet regressions: PASS;
- persistence regressions: PASS;
- Build338 idempotency/save/lag regression contract: PASS.

Local runtime was Node **v22.16.0**. This evidence does **not** replace the mandatory Node 24 / ESLint / CI gate.

### External engineering references approved for Build 339 research

The user explicitly authorized consulting external high-quality engineering/game references.

Current reference set:
- WebKit — Optimizing WebKit & Safari for Speedometer 3.0:
  https://webkit.org/blog/15249/optimizing-webkit-safari-for-speedometer-3-0/
- WebKit — Memory Debugging with Web Inspector:
  https://webkit.org/blog/6425/memory-debugging-with-web-inspector/
- WebKit — JavaScriptCore documentation:
  https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html
- Game Programming Patterns — Data Locality:
  https://gameprogrammingpatterns.com/data-locality.html
- Game Programming Patterns — Dirty Flag:
  https://gameprogrammingpatterns.com/dirty-flag.html
- Game Programming Patterns — Object Pool:
  https://gameprogrammingpatterns.com/object-pool.html
- Three.js — InstancedMesh:
  https://threejs.org/docs/pages/InstancedMesh.html
- Unity Entities documentation is an architecture comparison reference only; Build 339 does not adopt Unity/DOTS as a dependency.

Rule: external patterns are evidence/ideas only. Nothing enters Build 339 merely because another engine uses it. Every change must be proven against Global Holdings ownership, determinism, rollback, save/restore and device measurements.

### Advisory developer map status

A developer-supplied Build 338 architecture/risk map was received. It states that it was derived partly from an unpacked Build 338 IPA plus the live diagnostic. Therefore it is **advisory only**, not authoritative source evidence. Useful claims must be independently verified against the clean frozen Build 338 source / Build 339 bootstrap source before implementation.

## 12. Phase 1 NEXT ACTION — Time + Transaction architecture

Do not start again from Build 338. Start only from the locked Build 339 Phase 0 source identity above.

Immediate sequence:

1. Build a clean-source writer/reader/boundary map for `simulation-core.js`, `app.js::createSimulationSliceJob`, `transaction-core.js`, and all Hour/Day boundary owners.
2. Define the Build 339 time contract before code replacement:
   - `state.simSeconds` remains the single authoritative simulation time unless a separately recorded migration replaces it;
   - rendering clock must not own economic time;
   - fixed-step / bounded-work execution must preserve exact boundary ordering;
   - no skipped or duplicated Hour/Day effects under backlog or manual advance.
3. Define a mutation-journal / copy-on-write rollback contract that can replace full-tree snapshots without weakening rollback.
4. Add byte-for-byte rollback tests across representative hourly/day failure cases before disabling any existing full snapshot.
5. Use Phase 0 telemetry to measure schema/integrity/render sub-owners on device before optimizing them.
6. Keep user-facing export/import, route engine, asset data layout, rendering migration and tripArchive redesign queued behind the time/transaction foundation unless a dependency requires an earlier interface contract.
7. Update this MASTER after every meaningful batch with exact files, hashes, test evidence, rejected approaches and the next continuation point.



## 11. Phase 0 locked checkpoint — 2026-09-24

The first portable Build 339 development source is now locked.

- Source tree SHA-256: `8564b451e24df4935cec1e3e9bab95b135f05b73e3b99afb077b3b86bffb577a`
- WebApp tree SHA-256: `06234729bd9a6395f23fc46c958b4ee8f7d5c9e99c66c93f5e1b1aea78ce1652`
- Source archive: `GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip`
- Source ZIP SHA-256: `b454b554fd67f0699b800c5d073d4e03b4f27c188b474dbe4eb3c87f470c0123`
- Library path: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip`
- Verification: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0.verification.json`
- Detailed checkpoint: `BUILD339_PHASE0_CHECKPOINT.md`

Phase 0 is identity + telemetry only and intentionally makes no domain-semantic replacement.

Do not continue from a local unverified working directory if the conversation changes. Materialize the full Phase 0 archive above, verify its ZIP SHA-256 and runtime source SHA-256, then continue from NEXT ACTION.

## 12. Current NEXT ACTION — Phase 1 deterministic time/scheduler architecture

The next accepted work is **Phase 1**, not more Build 338 stabilization and not another Build 339 bootstrap.

Start by building a golden compatibility harness for current time/boundary semantics, then replace the scheduler architecture in small, independently regression-gated batches. Preserve simSeconds as the sole authoritative simulation-time source until a formally recorded migration says otherwise.


## Phase 1A archive lock — 2026-09-24

The authoritative portable continuation archive is:
`/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`

ZIP SHA-256:
`ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`

Any older Phase 0 archive with a different filename/hash is superseded for active development. It remains historical provenance only.


## 13. LATEST AUTHORITATIVE CONTINUATION — PHASE 1A LOCKED

This section supersedes earlier Phase 0 / Phase 1 NEXT ACTION wording.

- Active source tree: `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`
- Active WebApp tree: `7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901`
- Canonical archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- ZIP SHA-256: `ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`
- Verification: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.verification.json`
- Detailed checkpoint: `BUILD339_PHASE1A_CHECKPOINT.md`

Phase 0 archives are historical provenance only and MUST NOT be used for new active development.

**NEXT ACTION: Phase 1B**
1. complete day-boundary write map;
2. separate pacing/backlog/render cadence from authoritative `simSeconds` while retaining the golden contract;
3. retain full rollback snapshots throughout Phase 1B;
4. move root-journal/COW rollback implementation to Phase 1C after mutation coverage is proven.

If the conversation changes, continue from this section and `BUILD339_PHASE1A_CHECKPOINT.md`; do not repeat Phase 1A.


## 14. LATEST AUTHORITATIVE CONTINUATION — PHASE 1B-A LOCKED

This section supersedes Phase0 and Phase1A for active development.

- Runtime source tree: `835709c802e82d968a259224563dda0a3c7e242f21ac322bc09703e1226f6cb8`
- WebApp tree: `3bdd4ae860baee183dc54715a9bb0d4298cd9073371f9d2eee60508c6cb33338`
- Canonical archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- ZIP SHA-256: `c3c747a187ecee6def4fe94125205f5ea0ff61015ec2be5b05e7cfd63909f1ee`
- Verification: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.verification.json`
- Detailed checkpoint: `BUILD339_PHASE1B_A_CHECKPOINT.md`

Accepted:
- representative real Day-boundary root write maps;
- exact JSON-serialization rollback restoration;
- original root ordering preserved through scoped→full promotion;
- all prior Phase1A time/write proofs remain passing.

Unaccepted:
- any local root-journal/COW experiment not present in the canonical archive.

**NEXT ACTION: Phase 1B-B — pacing/backlog/render cadence separation.**
Full rollback snapshots remain enabled. Phase1C owns root-journal/COW migration.


## 14. BUILD 339 PHASE 1B-A LOCKED CHECKPOINT — 2026-09-24

This section is the latest authoritative Build 339 continuation point and supersedes earlier Phase 1A NEXT ACTION wording.

### Active source identity

- Build: **339**
- Version: **3.0.0**
- Save Schema: **2.0.0**
- Runtime source tree SHA-256:
  `835709c802e82d968a259224563dda0a3c7e242f21ac322bc09703e1226f6cb8`
- WebApp tree SHA-256:
  `3bdd4ae860baee183dc54715a9bb0d4298cd9073371f9d2eee60508c6cb33338`
- Canonical full source archive:
  `GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- Source ZIP SHA-256:
  `c3c747a187ecee6def4fe94125205f5ea0ff61015ec2be5b05e7cfd63909f1ee`
- Library path:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.zip`
- Library file ID:
  `libfile_45d494d042188191a4809466fa56cb19`
- Verification:
  `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_A_DAY_ROLLBACK_SOURCE.verification.json`
- Verification Library file ID:
  `libfile_68ba3bb085a08191965fc527a81c63fb`
- Checksum Library file ID:
  `libfile_2762bc9df30c8191af370e08e6c9c28f`

Build 338 remains frozen fallback/provenance only.

### Accepted Phase 1B-A work

1. Completed the real Day-boundary write map over sequential day execution, including:
   - ordinary day;
   - payroll day 27;
   - month-end behavior.
2. Strengthened rollback so a failed transaction restores:
   - values;
   - object key order;
   - root key order;
   - JSON serialization equivalence.
3. Fixed scoped-to-full snapshot promotion so promoted full snapshots preserve original root order.
4. Added a Day-boundary regression contract including deliberate critical failure and exact JSON rollback.
5. Preserved existing Hour83 proof-failure rollback behavior.
6. Preserved full hour/day snapshots; no COW/root journal is active yet.

### Proven regression evidence

PASS after the Phase 1B-A runtime change:
- Hour83 proof corruption/calendar rollback
- durable post-commit/publication
- finance settlement/day-close related contracts
- document-proof v3 security
- durable authorization
- scheduler liveness
- late-frame liveness
- 600-air calendar regression
- Build338 compatibility/root contracts
- source-layout 10/10
- official source verifier PASS after source relock

### Local provenance commits

- `93cbb47` — exact rollback ordering + Day write-map contract
- `ba6875a` — lock Phase 1B-A source identity and hashes

### Explicitly NOT part of the accepted source

Any earlier local experiments involving root-journal/COW that were not committed and not present in the canonical Phase 1B-A archive are rejected/non-authoritative and must not be replayed from memory.

### Architectural facts confirmed for the next phase

- `state.simSeconds` remains the sole committed simulation-time source.
- Simulation slices are **not fixed at 600 seconds only**:
  - 30x ≈ 30 simulation seconds
  - 120x ≈ 120
  - 300x ≈ 300
  - 600x ≈ 600
  - manual calendar advance may use batches up to 3600 seconds
  - every slice is clamped at exact hour/day boundaries.
- Midnight ordering remains **Day → Hour**.
- Full snapshot rollback remains active for hour/day boundaries.
- Authoritative persisted state remains a JSON-compatible tree; current Maps/Sets are runtime/local structures only.
- Asset `specs` are currently copied from catalog and are effectively static during gameplay except legacy save normalization/migration.
- Asset `load` is currently derived presentation text, not authoritative cargo inventory.

### External architecture reviewer

A performance/architecture reviewer without repository access is assisting on:
- scheduler/pacing;
- transaction journal/COW;
- 20k asset data model;
- persistence;
- rendering;
- routing;
- stress harness.

Reviewer recommendations are advisory only. They must be checked against the clean Build 339 source and measured on JavaScriptCore/WebKit/iPhone before adoption.

Important correction already sent to the reviewer:
- the engine uses variable deterministic slices, not fixed 600s-only stepping;
- the target runtime is JavaScriptCore/WebKit, not V8.

### CURRENT NEXT ACTION — PHASE 1B-B

Start only from the canonical Phase 1B-A archive/hash above.

1. Separate:
   - wall-clock pacing;
   - backlog accumulation;
   - execution budget;
   - render cadence;
   from authoritative simulation time.
2. Preserve the existing variable deterministic slice semantics and exact boundary clamping.
3. Preserve all Golden Time Contract outcomes, especially midnight Day → Hour ordering.
4. Keep `state.simSeconds` as the sole committed economic time source.
5. Keep existing full rollback snapshots during Phase 1B-B.
6. Measure and test 30x/120x/300x/600x/manual advance/late frame/background catch-up.
7. Re-run Hour83, Day-close, scheduler, late-frame, 600-air, write-set and save regressions after each accepted sub-batch.
8. Only after Phase 1B-B is proven may Phase 1C implement root-journal/COW rollback with automatic full-snapshot fallback for unproven writers.

### New-chat mandatory startup

A new conversation must:
1. read `GLOBAL_HOLDINGS_MASTER_HANDOFF.md` from branch `globalholdings-project-control`;
2. read `GLOBAL_HOLDINGS_BUILD339_MASTER.md` from branch `build339-architecture-control-20260924`;
3. use this Phase 1B-A section as the latest continuation point;
4. materialize the canonical Phase 1B-A full source archive from Library;
5. verify ZIP SHA-256 `c3c747a1...f1ee`;
6. run the official source verifier and require runtime source hash `835709c8...6cb8`;
7. continue Phase 1B-B without redoing Build338, Phase0, Phase1A, or Phase1B-A.


## 15. LATEST AUTHORITATIVE CONTINUATION — PHASE 1B-B LOCKED

This section supersedes every earlier active-source and NEXT ACTION section for continuation.

### Active source identity

- Build: **339**
- Version: **3.0.0**
- Save Schema: **2.0.0**
- Production approval: **CLOSED**
- Runtime source tree SHA-256: `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`
- WebApp tree SHA-256: `ada2977ddadc0f6df1558acd0b4543de77163da5ae0bfa6b63eb087522a9489e`
- Canonical archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_B_PACING_SEPARATION_SOURCE.zip`
- ZIP SHA-256: `acd6cc9f324d6eb2975f74f076421f253e3cff5229104dc319f50a819b2fde77`
- Archive Library ID: `libfile_94bc2253cccc8191b627fbd78626238e`
- Verification Library ID: `libfile_9ee958e840708191bb47cb2d182d9bc6`
- Checksum Library ID: `libfile_2bb11d653bac8191a0074a1fe806ea53`
- Detailed checkpoint: `BUILD339_PHASE1B_B_CHECKPOINT.md`

### Accepted Phase 1B-B architecture

- wall-clock pacing, backlog accumulation, execution budget, render cadence and persist cadence are runtime-only;
- `state.simSeconds` remains the sole authoritative committed economic time source;
- variable deterministic 30/120/300/600 slices are preserved;
- exact Hour/Day boundary clamping is preserved;
- midnight ordering remains **Day → Hour**;
- manual advance remains target-driven and cannot leak its wall duration into later live catch-up;
- hidden/background wall time is not replayed as economic catch-up;
- render cadence no longer persists `simulationEngine.snapshot()` into `state.simulationKernel`;
- save normalization removes legacy scheduler/pacing snapshot residue while preserving semantic simulation audit fields;
- full snapshot rollback remains enabled; root-journal/COW is still inactive.

### Regression evidence

Local PASS: Build339 architecture bootstrap 12/12; Golden Time; Phase1B-B pacing contract; transaction write-set 5/5; simulation write-set 2/2; Hour map 2/2; Day map 2/2; exact 30/120/300/600 rate contract; scheduler liveness 14/14; late-frame 4/4; R3 calendar work 13/13; Hour83; finance settlement/day-close related contracts; document-proof v3; durable authorization; 600-air; deferred save; persistence snapshot consistency; persistence root coalescing; Build338 root compatibility; source-layout 10/10; official source verifier.

Local lint did not start because the current local source environment lacks the `eslint` package. Node24/full CI, controlled ESLint, Apple/WKWebView/native and physical iPhone gates remain pending. No release gate was opened.

### CURRENT NEXT ACTION — PHASE 1C

Implement Capture-On-First-Write / sparse undo journal with root/entity hybrid rollback and **automatic full-snapshot fallback for every unproven writer**. Do not remove full snapshots until writer coverage and byte-equivalent rollback are proven. Re-run Hour83, Day-close, scheduler, late-frame, 600-air, write-set, save/restore and integrity regressions after every accepted sub-batch.

### New-chat mandatory startup

Read this MASTER and `GLOBAL_HOLDINGS_MASTER_HANDOFF.md`, then materialize the canonical Phase 1B-B archive above, verify ZIP SHA-256 `acd6cc9f324d6eb2975f74f076421f253e3cff5229104dc319f50a819b2fde77`, run `tools/verify_current_source.py`, require runtime source hash `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`, and continue Phase 1C. Do not redo Build338, Phase0, Phase1A, Phase1B-A or Phase1B-B.


## 16. REJECTED PHASE 1C EXPERIMENT — CLEAN RESET

Date: **2026-09-24**.

All local Phase 1C work performed after the locked Phase 1B-B source was reviewed and **rejected in full**. It is non-authoritative and must not be replayed, copied, cherry-picked, or reconstructed from memory.

Clean reset completed:
- deleted the local Phase 1C working source and scratch copies;
- restored the active worktree only from the canonical Phase 1B-B archive;
- re-ran `tools/verify_current_source.py` successfully;
- restored runtime source identity to `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`;
- verified no Phase 1C checkpoint/provenance file exists inside the active source;
- Build 338 remains fallback only.

Reason for rejection: the attempted journal design exposed unproven rollback coverage for writes that can occur through joined domain owners and critical post-commit hooks. No part of that experiment is accepted architecture.

**Authoritative source remains Build 339 Phase 1B-B. Phase 1C must restart from first principles from the clean Phase 1B-B archive, with writer/critical-hook coverage proven before any snapshot removal.**


## 17. EXTERNAL REVIEW PROTOCOL — GEMINI ULTRA

Gemini Ultra may be used as an **external adversarial architecture/review assistant only**. It is not a source owner and has no authority to modify or define the canonical Global Holdings source.

Rules:
- ChatGPT remains the implementation/source-control owner for Build 339 work in this workflow.
- Gemini Ultra receives only the minimal review packet needed for the current question: architecture facts, relevant code excerpts/diffs, invariants, tests, and measured evidence.
- Gemini must not be given authority to invent a replacement source tree, replay rejected experiments, or merge code directly.
- Any Gemini recommendation is advisory and must be independently checked against the clean canonical source, transaction ownership, determinism, rollback, Save Schema 2.0.0, and regression tests.
- Conflicts are resolved by repository evidence and executable tests, not model confidence.
- For Phase 1C specifically, Gemini review should focus on writer coverage, joined writers, validation/postCommitCritical mutation risk, byte-equivalent rollback, fallback-before-write guarantees, and JavaScriptCore/WKWebView performance risk.
- No recommendation may remove Full Snapshot protection until writer coverage is proven.

Operational workflow:
1. ChatGPT performs clean-source tracing and prepares a narrow review packet.
2. User may submit that packet to Gemini Ultra.
3. Gemini returns critique / counterexamples / alternative design.
4. ChatGPT validates every claim against the repository and tests.
5. Only validated changes are implemented and recorded in MASTER.

There is currently no direct Gemini connector available in this ChatGPT environment, so exchange with Gemini is user-mediated unless a supported connector becomes available later.


## 18. GEMINI ULTRA PHASE 1C REVIEW — VALIDATED VERDICT

External adversarial review was received and checked against the clean locked Phase 1B-B source. **No runtime/source code was changed by this review batch.**

Accepted:
- arbitrary uninstrumented JavaScript cannot guarantee fallback-before-write after execution has already entered an unknown writer; admission must be pre-execution;
- ensure/normalization/lazy initialization, nested writers, array structural mutation, error paths, critical hooks and reconciliation are real write-contract risks;
- rollback capture must remain valid through every state-mutating critical phase;
- Hour/Day boundaries stay Full Snapshot initially;
- unknown/unproven writers must use Full Snapshot before execution;
- deterministic/no-rollback equivalence and byte-equivalent rollback are mandatory;
- JavaScriptCore/iPhone measurement is required before performance claims.

Corrected/rejected:
- `join()` is not permanently classified as unsafe; current Phase1B-B promotes scoped joins to Full Snapshot, while Phase1C may later admit a joined writer only through an explicit proven contract.
- Field-level undo is not categorically forbidden. It may be admitted only for fixed, pre-existing own data properties with stable field contracts; object-valued fields require safe value capture, and property/array structural mutations force entity/root/full fallback.
- The proposed root-reordering delete/read/reinsert sample is not adopted. Restoration must not invoke accessors/getters and must preserve exact JSON order by a proven descriptor/data-tree-safe method.
- Claimed finance/root sizes and JavaScriptCore slowdown factors are not accepted without measurement.
- Fixed targets such as `captureMs<=1.5`, `finishMs<=12`, `saveSyncMs<=30`, `jsHeap<=180MB` are hypotheses only until physical-iPhone baselines exist.
- `fullSnapshotFallbackRate=0%` is not a correctness target during rollout; fallback is a safety mechanism.
- Reducing persisted state from ~27MB to <3.5MB is **not a Phase1C acceptance criterion**. Journal/COW changes rollback storage, not authoritative persisted-state size. State-size/persistence redesign remains a later phase.

Source-specific finding:
- current transaction rollback snapshot remains available across critical-task failure, but `activeContext` is cleared before critical tasks;
- a future sparse journal tied to active context would therefore miss critical-phase mutations unless lifecycle ownership changes or Full Snapshot is forced before such hooks;
- current critical save path can mutate authoritative state during save preparation / persistence (including save revision), so persistence publication must be separated from ordinary state-critical hooks in the Phase1C lifecycle.

Phase1C implementation gate remains CLOSED until the new tests prove writer contracts, critical-hook coverage, fallback-before-write and byte-equivalent rollback from the clean Phase1B-B source.



## 19. LATEST AUTHORITATIVE CONTINUATION — PHASE 1C-A LOCKED

This section supersedes every earlier active-source / NEXT ACTION section.

- Active build: **339**
- Active phase: **Phase 1C-A transaction foundation locked; Phase 1C-B next**
- Version: **3.0.0**
- Save Schema: **2.0.0**
- Production approval: **CLOSED**
- Runtime source tree SHA-256: `1e158524e74d6360b334568af89f088e7fe65b22574a8de2ece49ab0de0c4779`
- WebApp tree SHA-256: `fe2d7fc5e10b4695c9dec3feb9f0d0fe4be27cfa8cf08e8bb094d9a6206e5026`
- Canonical archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1C_A_TRANSACTION_FOUNDATION_SOURCE.zip`
- ZIP SHA-256: `574dbe1d213ba0b10d011c5e703a565107332c11f10ec82959848538fc47b7ea`
- Archive Library ID: `libfile_c39fc7197a2c81919e26d6f2198966a3`
- Verification Library ID: `libfile_7e3fa202a9ec81918e5726d57d498839`
- Checksum Library ID: `libfile_eade2b2309ec81918413e329aea92de7`
- Detailed checkpoint: `BUILD339_PHASE1C_A_CHECKPOINT.md`

Accepted:
- tests-first Phase1C adversarial contract **8/8 PASS**;
- 600-asset Full Snapshot vs Journal success/rollback equivalence PASS;
- no whole-array asset copy in the journal equivalence fixture;
- opt-in transaction journal foundation with automatic Full Snapshot fallback;
- conservative promotion before joined writers and mutating/unproven critical hooks;
- terminal irreversible critical ordering guard;
- descriptor-safe primitive asset-field rollback;
- historical transaction promotion regression restored to 5/5 without reusing rejected Phase1C code.

Important: **the simulation runtime does not request journal mode yet**. Steady slices, Hour and Day behavior remain operationally unchanged from Phase1B-B unless a test explicitly requests journal mode. Full Snapshot protection remains enabled.

**NEXT ACTION — Phase 1C-B:** prove exact steady-slice joined-writer contracts and read-only integrity-final hooks, then wire journal only to no-boundary / no-delivery steady slices. Hour/Day boundaries stay Full Snapshot. iPhone/JavaScriptCore measurement is mandatory before performance claims.


## 20. LATEST AUTHORITATIVE CONTINUATION — PHASE 1C-B LOCKED

This section supersedes every earlier active-source / NEXT ACTION section.

- Active build: **339**
- Active phase: **Phase 1C-B writer proof locked; Phase 1C-C next**
- Version: **3.0.0**
- Save Schema: **2.0.0**
- Production approval: **CLOSED**
- Runtime source tree SHA-256: `8570d5d7c6b9add34196b564d7f4498648c719a397eb598a65b21b00c9ac9325`
- WebApp tree SHA-256: `6f12bf6b4f76859229936d1f382d7865275c390e6eb6e7eb7aee9bc2591e91af`
- Canonical archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1C_B_WRITER_PROOF_SOURCE.zip`
- ZIP SHA-256: `27c1b52295f1adee6629ab2c7b69653b075262d500e07e4ca256f6a642734a5a`
- Archive Library ID: `libfile_93e80f11561c81919691340e3f3916f8`
- Verification Library ID: `libfile_05961190666c8191ae8eeef71f2d9c81`
- Checksum Library ID: `libfile_152aafb479e08191bfd3e2a003195878`
- Detailed checkpoint: `BUILD339_PHASE1C_B_CHECKPOINT.md`

Accepted:
- Phase1C-B readiness **7/7 PASS**;
- Phase1C-A adversarial **8/8 PASS**;
- Phase1C-B writer proof **6/6 PASS**;
- 600-asset Full Snapshot vs Journal equivalence PASS;
- composite/late-join barrier hardening;
- JSON-safe primitive field contract;
- write-set barrier before irreversible persistence;
- `integrity-final` read-only proof after fixing `dependency-core.detectCycles()`.

Critical limitation:
**Live simulation journal is still OFF.** Phase1C-B is a writer-proof / transaction-barrier checkpoint, not 20k-ready activation. The current journal can still allocate too many records at large fleets.

**NEXT ACTION — Phase 1C-C:** build allocation-bounded Capture-On-First-Write / flat-buffer journal architecture suitable for JavaScriptCore, prove active mobility/helper and async/stale-reference paths, keep Hour/Day/delivery/structural paths on Full Snapshot, then benchmark 600 / 2k / 5k / 10k / 20k / 25k assets on iPhone before live activation.
