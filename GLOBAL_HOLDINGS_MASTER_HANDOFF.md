# GLOBAL HOLDINGS — MASTER HANDOFF / CONTINUATION PROTOCOL

**MASTER FORMAT VERSION:** 3.2  
**LAST AUDITED:** 2026-09-24  
**CANONICAL CONTROL BRANCH:** `globalholdings-project-control`

> This file is the permanent project-control document. The control branch is **documentation/control only** and MUST NEVER be treated as a game-source baseline.
>
> A previous copy was committed to `build337-instrumentation-ci-20260923` at commit `24e33178ab492c7ccd97f067aa7f43705271b65e`. That copy is now **superseded**. Do not update the validated Build 337 provenance branch merely to maintain handoff documentation.

Purpose: Permanent source-control handoff for continuing Global Holdings across conversations/developers without re-explaining the project or changing the engineering method.

MANDATORY: A new conversation must read this file first, establish the current Source of Truth and latest diagnostic/evidence, and continue from NEXT ACTION. Do not ask the user to repeat information already recorded here.

## 1. Current authoritative checkpoint

- Product: **Global Holdings**
- Version: **3.0.0**
- Current development line: **Build 339 Architecture Generation**\n- Frozen fallback Source of Truth: **Build 338 verified runtime tree**
- Current physical-device-tested build: **338**\n- Build 339 status: **architecture control opened; first 339 runtime source hash not yet locked**
- Production approval: **CLOSED / NOT APPROVED**
- Save Schema: **2.0.0**
- Repository: **bdr-design/GlobalHoldings-iOS-Source**
- Canonical control branch: **globalholdings-project-control**
- Build 338 frozen provenance/CI branch: **build338-save-lag-root-20260923**\n- Build 339 architecture control branch: **build339-architecture-control-20260924**\n- Build 339 master: **GLOBAL_HOLDINGS_BUILD339_MASTER.md**
- Build 339 runtime source tree SHA-256: **2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874**
- Build 339 WebApp tree SHA-256: **7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901**
- Build 339 full source archive: **GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip**
- Build 339 source ZIP SHA-256: **ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4**
- Build 339 Library source path: **/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip**
- Build 338 verified runtime source tree SHA-256: **387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b**
- Build 338 WebApp tree SHA-256: **aed5ebc6773603703702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3**
- Build 338 full source archive: **GlobalHoldings_BUILD338_SAVE_LAG_ROOT_CANDIDATE_SOURCE.zip**
- Build 338 source ZIP SHA-256: **0a5be18327001bb0ceaf4feec99946f36b8eb0290d40523ddfa3265ab5285335**
- Library source path: **/GlobalHoldings-Releases/Build338/GlobalHoldings_BUILD338_SAVE_LAG_ROOT_CANDIDATE_SOURCE.zip**
- Build 338 unsigned IPA SHA-256: **58b4a40b8e1e8a617d00bdf8c8ad8c1ff41f46c9f2d5b516505cc6b7a29e8b4a**
- Library IPA path: **/GlobalHoldings-Releases/Build338/GlobalHoldings_v3_0_0_build338_unsigned.ipa**
- Build 338 primary successful runtime CI run: **35916040802**
- Runtime CI input commit: **6d62866bc83d551487961d13eeade8802a31eba3**
- A later **packaging-only workflow correction** changes only strict JSON newline emission in the verification artifact; it does **not** change the reconstructed Build 338 runtime source tree or IPA payload intent. Packaging revalidation run: **35923863917**.

### Current development / fallback rule

All new functional/architectural development MUST start from the locked **Build 339 Phase 1A** source tree:

`2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`

or its exact full source archive:

`GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`

with ZIP SHA-256:

`ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`

Build 338 is now fallback/recovery only. It may be used only if Build 339 must be abandoned or rolled back due to an architectural failure.

**Forbidden as a development source from this point forward:**
- any IPA, unpacked IPA, `.app`, or Payload directory;
- Build 337 or any older build as the direct development source;
- replaying Build 338 changes from memory;
- stacking old update packages/patches over Build 338;
- mixing source trees from different builds;
- treating the moving head of a CI/provenance branch as a substitute for the recorded runtime source hash.

Build 337 remains an immutable **comparison/provenance baseline only**.\n\n**Build 338 is now frozen as the recovery/fallback runtime baseline. No further functional development is to be extended on Build 338. Build 339 is the active architecture-development line. If Build 339 develops an unrecoverable architectural regression, return to the exact Build 338 runtime identity recorded above.**

## 2. Build 337 scope

Build 337 is an instrumentation baseline, not the state-size repair.

Added runtime-only instrumentation:
- Targeted Top-N byte profiler: domainRuntime, documentProofs, assets, realism.procurement.
- Transaction timings: snapshotMs, validateMs, applyMs, postCommitCriticalMs, postCommitNonCriticalMs, rollbackMs, totalMs.
- Persistence timings including stringifyMs and bridgeDispatchMs.
- Native timings including nativeAckLatencyMs and nativeVaultCommitMs.

Instrumentation MUST NOT become persistent game state.

Build 337 gates:
- Source acceptance: 89/89
- Native: 36/36
- WKWebView: 11/11
- Bundle staging: 5/5
- arm64 / iPhoneOS: PASS
- Fresh Xcode Release: PASS
- Save Schema remains 2.0.0.

Build 337 intentionally did not compress/delete domainRuntime, documentProofs, assets, delivery history, or implement Cold Receipts.

## 2B. Build 338 implemented scope and validation state

Build 338-A is **implemented, CI-validated, and physically tested on iPhone**. It is **not production-approved** because important performance/export/routing issues remain open.

Immutable runtime facts:
- Version: **3.0.0**
- Build: **338**
- Save Schema: **2.0.0**
- Source tree SHA-256: **387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b**
- WebApp tree SHA-256: **aed5ebc6773603703702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3**
- Source ZIP SHA-256: **0a5be18327001bb0ceaf4feec99946f36b8eb0290d40523ddfa3265ab5285335**
- IPA SHA-256: **58b4a40b8e1e8a617d00bdf8c8ad8c1ff41f46c9f2d5b516505cc6b7a29e8b4a**
- Native executable SHA-256: **829b480da08a67d4356d902a51c19cbd914bee6610927a0b4b6a0b7d790b2228**
- Architecture: **arm64 / iPhoneOS**
- unsigned: **true**
- old_ipa_used: **false**
- production_approved: **false**

CI gates from successful runtime run 35916040802:
- Source acceptance: **90/90**
- Build 338 root-contract test: **PASS**
- Native storage/security: **36/36**
- WKWebView/navigation: **11/11**
- Bundle staging: **5/5**
- ESLint: **PASS**
- Fresh Xcode 16.4 iPhoneOS Release: **PASS**
- IPA CRC: **PASS**
- Native 30 MiB limit test: **PASS**

**Artifact-state clarification:** the original CI verification JSON contains `device_tested=false` because it was generated **before** the physical iPhone retest. That field describes artifact-generation time and must not be confused with current project state. A physical Build 338 iPhone retest has since occurred and produced the diagnostic recorded in Section 3.

Build 338-A implemented:
- versioned SHA-256 idempotency fingerprint migration while preserving canonical payload semantics;
- durable compact receipts for the proven heavy fleet batch result families, with replay compatibility/guards;
- save-schema integration for one-time migration while keeping Save Schema 2.0.0;
- removal of the old durable-save hard-limit blocker that was rolling back payable finance operations;
- hourly integrity-scan de-duplication inside the active outer transaction while preserving rollback/integrity protection.

Not implemented in 338-A:
- tripArchive pruning/compaction;
- proof-content stripping;
- procurement archival;
- staffing/lastTrip compaction;
- a broad time-engine rewrite;
- route-overlap correction;
- user-facing save export/import repair;
- final map-render/FPS optimization.

## 3. Latest device diagnostic — Build 338 iPhone retest

Primary current device evidence:
`GlobalHoldings_diagnostic_v3.0.0_1790198108064.ghdiagnostic`

- Diagnostic SHA-256: **709e39982e589364e5a75fe79df397b49e028a3fd633101f0347b288c125a43e**
- Generated at: **2026-09-23T21:15:06.801Z**
- Build: **338**
- Save Schema: **2.0.0**
- simSeconds: **2,836,800**
- stateRevision: **788**
- saveRevision visible at export: **119**
- assets: **1,980**
- commands rolled back: **0**

### Persistent-state profile

- rootBytes: **27,082,359**
- mobility: **9,124,179**
  - tripArchive: **7,474,228**
  - streetRoutes: **792,441**
  - rideRequests: **512,066**
  - activeTrips: **172,080**
- assets: **4,947,134**
- documentProofs: **4,580,951**
- finance: **1,815,112**
  - invoices: **1,167,594**
  - transfers: **377,913**
  - cheques: **87,616**
  - payables: **57,289**
- domainRuntime: **1,689,610**
  - idempotency: **1,620,910**
  - commands: **68,605**
- realism: **1,617,974**
  - procurement: **1,591,870**
- authorization: **1,076,277**

Build 338 therefore dramatically reduced the old Build 337 idempotency explosion, but the state is still heavy and growth is now concentrated elsewhere.

### Simulation / frame-pressure evidence

- speed at export: **600**
- avgChunkMs: **0.3666666666744277**
- maxChunkMs: **5**
- maxFinishMs: **773**
- lastFinishMs: **565**
- maxCycleMs: **792**
- hardTasks: **778**
- longTasks: **4,654**
- governor: **RED**
- backlog: **1,051,200**
- backlogClamps: **0**

Latest heavy hourly finish:
- label: `simulation:2836200->2836800`
- `fullSnapshot=true`
- `scopeSize=null`
- `snapshotMs=119`
- `validateMs=6`
- `applyMs=7`
- `postCommitCriticalMs=433`
- `totalMs=565`

This proves the dominant heavy-hour cost has moved away from ordinary apply work and is now concentrated in **postCommitCritical**, while full-snapshot cost remains material.

Scoped non-hourly slices are still expensive enough to matter because the scoped snapshot copies large branches; typical observed scoped snapshots remain roughly in the **80–90 ms** range even when `applyMs` is only a few milliseconds.

### Persistence evidence

Latest ordinary save sample:
- saveRevision: **119**
- `schemaMs=393`
- `stringifyMs=71`
- `measurementMs≈25`
- `totalSyncMs=490`
- `utf8Bytes=27,041,503`
- cache reason: `browser-cache-size-bypass`
- serialization result: **ok=true**

At diagnostic export time, revision 119 had been serialized/dispatched, while the **latest completed native ACK** was:
- saveRevision: **118**
- generation: **117**
- `bridgeDispatchMs≈34`
- `nativeAckLatencyMs≈5,593`
- `nativeVaultCommitMs≈5,472.86`

So the old hard-limit blocker is no longer present in this run, but native persistence latency remains very high and must not be described as “fast” yet.

### Integrity evidence

- `proofForensics.ok=true`
- `danglingReferences=[]`
- `documentFailures=[]`
- `recordFailures=[]`
- commands rolled back: **0**

### User-reported issues not yet root-confirmed

1. **User-facing save export for later restore does not work.** Internal/native saving works; export/import must be traced independently.
2. **Large-fleet route overlap:** after launching/assigning about 900 assets, the user observes around 100 assets visually/operationally concentrated on the same route/geometry. The supplied screenshot supports severe visual stacking, but the root owner is **not yet proven**: it may involve route assignment, duplicate geometry/corridor signatures, departure slotting, renderer projection, or a combination.
3. **Lag/frame drops remain severe** under high-load operation despite fast ordinary chunk execution.
4. **Payable cheque/transfer:** the old hard-limit rollback mechanism is removed, but the user-visible cheque/transfer workflow should still be explicitly re-verified on device as a regression gate; do not infer full UI success only from healthy finance diagnostics.

Build 337 remains the comparison baseline for before/after metrics, but Build 338 is now the active device-tested development baseline.

## 4. Engineering method — mandatory

### Root-cause tracing

Never repair only the visible symptom. Trace:
Symptom/UI event → Trigger → Caller → Dispatcher/Command/Gateway → Domain Owner → Transaction → State Mutation → dependent readers/references → Persistence → Native ACK → A/B Vault → Restore/Replay.

Trace backwards when needed. Repair belongs in the true owner module. Do not create a parallel path merely to hide a broken owner.

### Single ownership / single source of truth

Every domain concept must have one authoritative owner.

Forbidden:
- Duplicate state as workaround.
- Shadow copies that become another source of truth.
- Extra listeners repeating the same mutation.
- Wrappers/overrides used to bypass the broken owner.
- Post-transaction state mutations that belong inside the transaction.
- Patch-over-patch architecture.

### Atomicity

State-changing operations are all-or-nothing.

For money, assets, documents, routes, HR, procurement, time transitions and other stateful operations:
1. Validate preconditions.
2. Enter the correct transaction boundary.
3. Apply all related mutations.
4. Run critical integrity checks.
5. Commit only if all required effects succeed.
6. Roll back the entire operation on failure.
7. Never perform hidden state-changing cleanup after commit.

### Save Schema

Save Schema 2.0.0 is the current contract. Do not bump or silently reinterpret it to make a repair easier. Any future schema change requires explicit architecture, migration, atomic rollback, compatibility tests and user approval.

## 5. Mandatory repair procedure

For every bug:
1. Reproduce/establish evidence.
2. Identify true owner.
3. Enumerate writers/readers.
4. Trace transaction boundaries.
5. Trace state/reference flow.
6. Identify root cause.
7. Determine adjacent regression risk.
8. Repair the owner rather than layering a patch.
9. Remove obsolete duplicate/broken logic when superseded.
10. Test success.
11. Test failure.
12. Test rollback.
13. Test replay/idempotency when relevant.
14. Test save → terminate/reload → restore.
15. Test adjacent domains.
16. Inspect diff for accidental ownership duplication.
17. Run stress/performance gates where relevant.
18. Recompute/record source hashes before release.

A passing UI demonstration alone is not proof.

## 6. Mandatory feature-addition procedure

Before adding a feature:
1. Define domain owner.
2. Define command/gateway/API contract.
3. Identify the only authoritative state mutator.
4. Define transaction/rollback boundaries.
5. Audit interactions with finance, proofs/documents, assets, HR, mobility/routes, time/simulation, persistence/native storage and UI.
6. Reuse a valid extension point if one exists.
7. Otherwise create the missing architectural component in the correct layer.
8. Never create a second source of truth.
9. Test success/failure/replay/save-restore and neighboring behavior.
10. Verify performance under realistic load.

Do not place a feature in a convenient large file merely because it works there.

## 7. Mandatory deletion/compression procedure

Deletion, compaction, pruning and archival require a Reference Audit first:

Writers → Readers → Indexes → Foreign References → Reverse References → Documents/Proofs → Finance/Audit → UI → Replay/Idempotency → Save/Restore → Migration.

Classify data as:
- authoritative state;
- derived/rebuildable state;
- runtime-only telemetry/cache;
- audit/history required for semantics;
- safely representable semantic receipt/archive.

Never delete data solely because it is large.

If deletion/compaction is proven safe:
- update/remove producer and consumers coherently;
- preserve referential integrity;
- preserve canonical digest/proof contracts;
- preserve replay semantics;
- preserve accounting/audit requirements;
- provide atomic migration/rollback when persisted representation changes;
- run save/restore and regression tests.

## 8. Build 338 stabilization decision status

Build 338-A is complete. The next phase is **high-priority stabilization**, with the user's goal of resolving the large majority of the currently known severe issues in one carefully gated release.

Do not interpret “90%” as permission for broad unverified rewrites. It is a target against the known problem inventory, with each root fix independently measured and regression-tested.

Approved next sequence:
1. **Lag/frame pipeline root fix**
2. **Save export/import restore root fix**
3. **Large-fleet route diversity / anti-overlap root fix**
4. **Map-render/FPS optimization if profiling proves renderer cost**
5. **Persistent-state growth reduction, starting with mobility.tripArchive if still justified after reader/reference audit**
6. **Finance/payable regression verification after every persistence/transaction change**

Still forbidden:
- disabling rollback or integrity to gain speed;
- arbitrary data deletion/retention counts without reference audits;
- cosmetic route offsets as the sole answer to a routing ownership bug;
- replacing authoritative source with an IPA;
- changing Save Schema 2.0.0 without an explicit migration decision.

## 9. Current root priorities and evidence

### A. Hourly lag / frame-drop path — FIRST PRIORITY
Measured owner:
- `postCommitCriticalMs=433` on the latest heavy hour;
- `snapshotMs=119`;
- `applyMs=7`;
- `totalMs=565`;
- `maxFinishMs=773`;
- governor `RED`.

Required audit:
- identify every critical post-commit hook and its exact milliseconds;
- determine why full integrity work is scanning large unchanged state;
- introduce revision/dirty-scope awareness only where correctness can be proven;
- preserve a full integrity boundary where required;
- audit fullSnapshot ownership separately from post-commit work;
- measure UI/map render cost independently rather than assuming all visible stutter is simulation.

### B. User save export/import restore — SECOND PRIORITY
Trace:
`UI export action → serialization/package → WKWebView/native bridge → file creation/share/save → user-selected import → file read → hash/schema verification → atomic restore → reload`.

Internal Native A/B save success is **not** proof that user export/import works.

Acceptance requires an actual round trip:
export → alter/reset test state → import exported file → verified restore of the same save identity/state.

### C. Large-fleet route overlap — THIRD PRIORITY
Trace:
`batch route assignment → route candidate pool → duplicate route/geometry/corridor identity → route capacity/occupancy → departure slotting → movement geometry → renderer`.

Do not assume the screenshot proves a single cause. First establish whether:
- many assets truly share the same logical route;
- different route IDs share the same geometry;
- departure times are synchronized;
- renderer projects nearby assets onto indistinguishable coordinates.

Correct assignment ownership first if duplication is operational; renderer offsets are only secondary presentation treatment.

### D. Map rendering / FPS
Profile with approximately 2,000 assets:
- DOM marker count;
- visible moving marker count;
- route polyline count;
- update cadence;
- per-frame marker mutation cost;
- map pan/zoom cost;
- selected asset vs background asset requirements.

Only migrate dense background motion to Canvas/culling/batching if profiling confirms it materially reduces main-thread cost.

### E. Persistent state growth
Current largest owners:
1. mobility **9.12 MB**, tripArchive **7.47 MB**
2. assets **4.95 MB**
3. documentProofs **4.58 MB**
4. finance **1.82 MB**
5. domainRuntime **1.69 MB** — no longer the dominant owner

Do not continue treating idempotency as the primary size problem; Build 338-A already reduced it substantially.

### F. Finance regression
Keep cheque/transfer/payables as a mandatory regression gate. The old save hard-limit rollback cause is fixed, but the visible workflow must be explicitly verified after the next stabilization build.

## 10. Non-regression invariants

Preserve where applicable:
- proofForensics.ok = true
- danglingReferences = []
- no double execution
- double-entry accounting integrity
- company-account separation
- Native ACK correctness
- A/B Vault correctness
- save/restore compatibility
- migration atomicity and rollbackability
- simulation time single source of truth
- asset/revenue progression
- existing working company/domain behavior
- no asset delivery when financial/approval transaction failed

Performance fixes may not bypass these invariants.

## 11. Performance methodology

Separate and measure chunk execution, transaction snapshot, validation, apply, post-commit critical/non-critical, serialization, bridge dispatch, native vault commit and UI/render work.

Use device diagnostics to identify the measured owner. Cheap chunks plus expensive Finish does not mean smaller chunks are the fix.

Time-engine changes are high risk. Do not modify speed/time semantics unless the measured owner requires it and dependent domains are audited.

## 12. Source-control / release discipline

Before changing a build:
- verify input source identity;
- create a dedicated development branch/checkpoint;
- keep provenance explicit.

Before IPA:
- lock candidate source;
- source acceptance;
- lint/static gates;
- native tests;
- WKWebView/navigation tests;
- bundle staging;
- arm64/iPhoneOS verification;
- fresh Xcode Release;
- bundled WebApp equality;
- unsigned verification when requested;
- source tree, WebApp tree and IPA SHA-256;
- verification evidence.

Never claim device-tested unless actually tested on device.

## 13. Conversation continuation behavior

When a new conversation receives “كمل Global Holdings” or equivalent:
1. Locate repository **bdr-design/GlobalHoldings-iOS-Source** using the connected GitHub source.
2. Fetch **`GLOBAL_HOLDINGS_MASTER_HANDOFF.md` specifically from branch `globalholdings-project-control`**. Do not use the copy on a build-provenance branch and do not assume the default `main` branch contains the current handoff.
3. Read the MASTER completely before asking the user any project-state question.
4. Inspect the exact immutable source/provenance commit and the latest diagnostic/evidence identities recorded here.
5. Verify the Source of Truth before modifying code.
6. Resume from NEXT ACTION.
7. Do not ask the user to repeat architecture, repair method, deletion/addition rules, source rules, diagnostic identity, or recorded project state.
8. Do not stop after every small step asking for permission; continue in careful batches and report meaningful checkpoints.
9. Ask only when a genuinely missing external artifact/decision cannot be established from repository, diagnostics, library, or prior evidence.
10. Never infer or silently substitute a missing source hash, build provenance, diagnostic identity, or schema.
11. Communicate in Arabic unless requested otherwise.
12. Update this MASTER only on the canonical control branch; never mutate a validated build-provenance branch merely to maintain documentation.
13. Before closing a validated build, update: build number, immutable source anchor, source/WebApp hashes, CI evidence, latest diagnostic hash, approved decisions, unresolved issues, and NEXT ACTION.
14. Treat anything not explicitly recorded as an approved decision as **unapproved/pending**, even if it appeared earlier in discussion.

## 14. NEXT ACTION — Build 339 Phase 1B: Root-journal transaction migration

Phase 1A is locked and is now the active Source of Truth.

Immediate work:
1. Verify clean-source boundary/writer/readers for time and transactions.
2. Define and test the deterministic fixed-step/bounded-work time contract.
3. Define mutation-journal / copy-on-write rollback architecture.
4. Add byte-for-byte rollback tests before removing any full snapshot safety.
5. Use Phase 0 sub-owner telemetry to measure integrity/render owners on physical device.
6. Continue later with persistence/export/import, route ownership, asset data layout, render migration, and tripArchive redesign in dependency order.
7. Update the Build339 MASTER after every meaningful batch.

### New-chat continuation

The user should only need to write:

**كمل Global Holdings**

The new conversation MUST:
- open repository `bdr-design/GlobalHoldings-iOS-Source`;
- read `GLOBAL_HOLDINGS_MASTER_HANDOFF.md` from branch `globalholdings-project-control`;
- use Build 339 Phase 1A source tree `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874` as the active Source of Truth;
- continue the work order above without asking the user to repeat the architecture, rules, or current state.

---
This MASTER is a living control document. Update it **only** on `globalholdings-project-control`.


## 15. Build 338 freeze / Build 339 transition — 2026-09-24

User-approved control decision:

- stop extending Build 338;
- preserve Build 338 as the exact verified fallback/recovery baseline;
- open Build 339 as the independent architecture-generation line;
- if Build 339 introduces an unacceptable architectural regression, return to the exact Build 338 source identity, not an IPA or reconstructed patch stack;
- Build 339 control reference: branch `build339-architecture-control-20260924`, file `GLOBAL_HOLDINGS_BUILD339_MASTER.md`.



## 16. Build 339 Phase 0 locked checkpoint — 2026-09-24

- Active runtime source tree SHA-256: `8564b451e24df4935cec1e3e9bab95b135f05b73e3b99afb077b3b86bffb577a`
- WebApp tree SHA-256: `06234729bd9a6395f23fc46c958b4ee8f7d5c9e99c66c93f5e1b1aea78ce1652`
- Full source archive: `GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BOOTSTRAP_SOURCE.zip`
- Source ZIP SHA-256: `0528355bb0ad1daca83ea09c09285a61a8d589c3981a113f9ae5000c263b1de9`
- Library path: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BOOTSTRAP_SOURCE.zip`
- Save Schema: 2.0.0
- Production approval: CLOSED
- Physical device validation: pending
- Phase 0 intent: identity + transient instrumentation only, no intentional game semantic change
- Local regressions: source verifier/source-layout/Build339 bootstrap/time/600-air/finance/security/proofs/Hour83/core/fleet/persistence/Build338 contract all PASS
- Mandatory pending gate: Node 24 + ESLint + full CI + fresh Apple/WKWebView/native + physical iPhone
- NEXT ACTION: Build 339 Phase 1 time and transaction architecture, as detailed in the Build339 MASTER.



## 16. Build 339 Phase 0 locked portable checkpoint — 2026-09-24

Build 339 now has a portable full-source checkpoint and no longer depends on a local conversation workspace.

- Active architecture line: **Build 339**
- Phase: **Phase 0 locked; Phase 1 next**
- Runtime source tree SHA-256: `8564b451e24df4935cec1e3e9bab95b135f05b73e3b99afb077b3b86bffb577a`
- WebApp tree SHA-256: `06234729bd9a6395f23fc46c958b4ee8f7d5c9e99c66c93f5e1b1aea78ce1652`
- Full source archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip`
- Source ZIP SHA-256: `b454b554fd67f0699b800c5d073d4e03b4f27c188b474dbe4eb3c87f470c0123`
- Verification: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0.verification.json`
- Build 339 control branch: `build339-architecture-control-20260924`
- Detailed Phase 0 checkpoint: `BUILD339_PHASE0_CHECKPOINT.md`

If a conversation changes, the new conversation MUST read `GLOBAL_HOLDINGS_BUILD339_MASTER.md` and `BUILD339_PHASE0_CHECKPOINT.md` first, then materialize the full source archive and verify both the ZIP hash and runtime source hash before coding.

**NEXT ACTION:** Build 339 Phase 1 deterministic time/scheduler architecture. Do not resume functional work on Build 338.


## 17. Build 339 Phase 1A locked checkpoint — 2026-09-24

**This checkpoint supersedes every older Phase 0 archive reference for active continuation.**

- Runtime source tree SHA-256: `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`
- WebApp tree SHA-256: `7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901`
- Full source archive: `GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- ZIP SHA-256: `ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`
- Library path: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- Library file id: `libfile_a073f623e3a08191b19729b246946975`
- Save Schema: 2.0.0
- Build338 remains frozen fallback only.
- Phase 1A accepted: deterministic time boundary owner extraction + golden time contract + opt-in transaction write-set auditing + actual hourly root write-map + byte-equivalent rollback proof.
- Full hour/day snapshots remain enabled. They must not be removed until Phase 1B coverage proves all writes.
- NEXT ACTION: day-boundary write-map, then safe root-journal/snapshot-on-first-write migration inside the existing transaction owner, with automatic full-snapshot fallback for unproven writers.



## 18. CURRENT AUTHORITATIVE CONTINUATION — BUILD 339 PHASE 1A

This section supersedes older Phase 0 archive/NEXT ACTION instructions for active development.

- Active build: **339**
- Active phase: **Phase 1A locked; Phase 1B next**
- Runtime source tree SHA-256: `2d9773fcf2c042401fb7d3599b9eb720078215b6141c881a256450cf83fe9874`
- WebApp tree SHA-256: `7cdb92260070495f8d3e842f4d35407eb4c21f5d5d3cd7414d1676051d8a6901`
- Canonical source archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.zip`
- ZIP SHA-256: `ea9e58c26f9f8bfc1a3fc00416a70abef04bb40e1e4fcd336d782d7a505f30a4`
- Canonical verification: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1A_TIME_TRANSACTION_PROOF_SOURCE.verification.json`
- Build339 control branch: `build339-architecture-control-20260924`
- Detailed checkpoint: `BUILD339_PHASE1A_CHECKPOINT.md`
- Save Schema: **2.0.0**
- Production approval: **CLOSED**
- Build338: **frozen fallback only**

Accepted Phase1A:
- pure deterministic time-boundary planner;
- golden time behavior contract;
- opt-in transaction write-set proof tooling;
- clean-source hourly root write-map;
- byte-equivalent rollback proof for undeclared/late critical failure.

Full hour/day snapshots remain active. They are not to be removed in Phase1B.

**NEXT ACTION — Phase 1B**
1. complete day-boundary root write map;
2. separate pacing/backlog/render cadence from authoritative simulation time without changing golden behavior;
3. preserve `state.simSeconds` as sole committed economic time;
4. keep full rollback snapshots;
5. re-run Hour83/day-close/scheduler/late-frame/600-air/write-set regressions after every sub-batch;
6. only then proceed to Phase1C root-journal/COW rollback.

### New-chat mandatory startup

The new conversation must read:
1. `GLOBAL_HOLDINGS_MASTER_HANDOFF.md` from `globalholdings-project-control`;
2. `GLOBAL_HOLDINGS_BUILD339_MASTER.md`;
3. `BUILD339_PHASE1A_CHECKPOINT.md`;

then materialize the canonical Phase1A archive, verify its ZIP SHA and runtime source tree hash, and continue Phase1B. Do not use Phase0 or Build338 for active development.
