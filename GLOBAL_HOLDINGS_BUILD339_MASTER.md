# GLOBAL HOLDINGS — BUILD 339 ARCHITECTURE MASTER

**STATUS:** ACTIVE ARCHITECTURE MIGRATION CONTROL  
**CREATED:** 2026-09-24  
**CONTROL BRANCH:** `build339-architecture-control-20260924`  
**REPOSITORY:** `bdr-design/GlobalHoldings-iOS-Source`

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

