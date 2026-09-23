# GLOBAL HOLDINGS — MASTER HANDOFF / CONTINUATION PROTOCOL

**MASTER FORMAT VERSION:** 2.0  
**LAST AUDITED:** 2026-09-23  
**CANONICAL CONTROL BRANCH:** `globalholdings-project-control`

> This file is the permanent project-control document. The control branch is **documentation/control only** and MUST NEVER be treated as a game-source baseline.
>
> A previous copy was committed to `build337-instrumentation-ci-20260923` at commit `24e33178ab492c7ccd97f067aa7f43705271b65e`. That copy is now **superseded**. Do not update the validated Build 337 provenance branch merely to maintain handoff documentation.

Purpose: Permanent source-control handoff for continuing Global Holdings across conversations/developers without re-explaining the project or changing the engineering method.

MANDATORY: A new conversation must read this file first, establish the current Source of Truth and latest diagnostic/evidence, and continue from NEXT ACTION. Do not ask the user to repeat information already recorded here.

## 1. Current authoritative checkpoint

- Product: Global Holdings
- Version: 3.0.0
- Current device-validated baseline: **337**
- Current CI-validated candidate: **338**
- Active development/retest build: **338**
- Build 338 device validation: **PENDING**
- Save Schema: 2.0.0
- Repository: bdr-design/GlobalHoldings-iOS-Source
- Build 337 provenance branch locator: **build337-instrumentation-ci-20260923**
- **Exact successful CI input commit (immutable anchor): 3ae0392d700f5fd41900f4ead8293a825f4e750d**
- Post-success CI locator commit: **881414c9bfdd09a5fd059c39d3ccacdb1ed1fcc1** (changes only `ci/build337-result.json` relative to the successful CI input commit)
- Later documentation commit on the old provenance branch: **24e33178ab492c7ccd97f067aa7f43705271b65e**
- Successful CI run: **35895055039**
- CI locator confirms `workflow_commit=3ae0392d700f5fd41900f4ead8293a825f4e750d` and `status=success`.
- Build 337 source tree SHA-256: b49061cfc68c89eb144c6c1107edf91e997a367325c8ffdd18dcc52ac33fc484
- Build 337 WebApp tree SHA-256: 6da1b5d15effaa3a148d3925ac76a2e036d630ee4186b9bbf9f7c015d0144bb0
- Build 337 IPA SHA-256: fed887f97912cb08352ec732d1099185de73f6d5c58ea759289f46026bb9873d
- Build 337 is unsigned and not production-approved.
- old_ipa_used=false.

### Source-of-Truth rule

Build 338 MUST start only from the reconstructed Build 337 tree whose source_tree_sha256 equals the value above.

Forbidden as a development source:
- Any IPA, unpacked IPA, .app, or Payload directory.
- Build 336 or any older build as the direct Build 338 source.
- Recreating Build 337 changes from memory.
- Overlaying old R1/R2/R3/N1 packages or unrelated patches.
- Mixing source trees from different builds.

The Build 337 tree is reconstructed by the workflow at:
`.github/workflows/build337-instrumentation-to-unsigned-ipa.yml`
from the **exact successful CI input commit** above.

Pinned reconstruction evidence from that workflow:
- Build 336 transport payload SHA-256: `4f6c81d1c3d1dd3fc8fc9b02b17e8e2a7dc92c2b7777d09324a9ae7baa12d434`
- Build 337 compressed patch-base64 SHA-256: `e6abc640011c0312b2b44deb7f8a4f9efa830e1d4fc232c92e686d9b15e6a710`
- Build 337 decoded patch SHA-256: `4f8922a52ea0d76183a1f979bdc9c3301e98b70a09d1164764ae31e009403e99`

**Critical distinction:** the pinned Build 336 payload is only the internal provenance substrate used to reproduce the already-validated Build 337 tree. It is NOT permission to develop Build 338 from Build 336.

**Branch-head prohibition:** never use the moving head of `build337-instrumentation-ci-20260923` as the source identity. The immutable CI input commit plus the reconstructed candidate hash are the anchors.

**Mandatory physical baseline before the first functional Build 338 edit:**
create a standalone archive named:
`GlobalHoldings_BUILD337_INSTRUMENTATION_BASELINE_SOURCE.zip`
from the reconstructed tree that verifies to the Build 337 source-tree hash below. Record the archive SHA-256 here once produced. Until that archive/hash is recorded, functional Build 338 source edits are blocked.

Physical baseline archive SHA-256: **f1789309998c3b7831b6a2f30e40e25cb5faa605c91f630164a009b3f66f0d32**.

Physical baseline archive created from the verified Build 337 tree on 2026-09-23. The archive is a transport artifact; the authoritative runtime identity remains `source_tree_sha256=b49061cfc68c89eb144c6c1107edf91e997a367325c8ffdd18dcc52ac33fc484`.

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

## 2B. Build 338 CI-validated candidate — save/lag root

Build 338-A has been implemented and passed the full CI/Xcode gate. It is **not yet device-approved**.

- Version: **3.0.0**
- Build: **338**
- Save Schema: **2.0.0**
- Development/CI branch: **build338-save-lag-root-20260923**
- CI workflow commit: **6d62866bc83d551487961d13eeade8802a31eba3**
- Successful CI run: **35916040802**
- CI conclusion: **success**
- Source tree SHA-256: **387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b**
- WebApp tree SHA-256: **aed5ebc6773603703702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3**
- Full source archive: **GlobalHoldings_BUILD338_SAVE_LAG_ROOT_CANDIDATE_SOURCE.zip**
- Full source archive SHA-256: **0a5be18327001bb0ceaf4feec99946f36b8eb0290d40523ddfa3265ab5285335**
- IPA: **GlobalHoldings_v3_0_0_build338_unsigned.ipa**
- IPA SHA-256: **58b4a40b8e1e8a617d00bdf8c8ad8c1ff41f46c9f2d5b516505cc6b7a29e8b4a**
- IPA bytes: **13,313,106**
- Native executable SHA-256: **829b480da08a67d4356d902a51c19cbd914bee6610927a0b4b6a0b7d790b2228**
- Architecture: **arm64 / iPhoneOS**
- unsigned: **true**
- old_ipa_used: **false**
- production_approved: **false**
- device_tested: **false**

CI gates:
- Source acceptance: **90/90**
- Build 338 root-contract test: **PASS**
- Native storage/security: **36/36**
- WKWebView/navigation: **11/11**
- Bundle staging: **5/5**
- ESLint gate: **PASS**
- Fresh Xcode 16.4 iPhoneOS Release: **PASS**
- IPA CRC: **PASS**
- Native 30 MiB limit test: **PASS**

Build 338-A implemented scope:
- Versioned SHA-256 idempotency fingerprint migration while preserving canonical payload semantics.
- Durable compact receipts for the proven heavy fleet batch result families, with replay compatibility/guards.
- Save-schema integration for one-time migration while keeping Save Schema 2.0.0.
- Root fix for payable cheque/transfer rollback caused by durable-save hard-limit pressure; finance logic itself was not bypassed.
- Hourly integrity-scan de-duplication inside the active outer transaction while preserving baseline/final integrity and rollback protection.
- No tripArchive pruning, documentProof stripping, procurement archival, asset staffing compaction, or broad time-engine rewrite in 338-A.

**Source rule after this point:** any further Build 338 change must start from the exact Build 338 source tree SHA above (or the verified full source archive above), not from Build 337, not from the IPA, and not by replaying the patch from memory.

## 3. Latest device diagnostic

Latest device diagnostic after Build 338 iPhone testing:
`GlobalHoldings_diagnostic_v3.0.0_1790198108064.ghdiagnostic`

- Diagnostic SHA-256: **709e39982e589364e5a75fe79df397b49e028a3fd633101f0347b288c125a43e**
- Generated at: **2026-09-23T21:15:06.801Z**
- Build: **338**
- Save Schema: **2.0.0**
- simSeconds: **2,836,800**
- stateRevision: **788**
- saveRevision: **119**

This supersedes the Build 337 diagnostic as the primary current device evidence, while Build 337 remains the comparison baseline.

Key measured results:
- Persistent save progressed beyond the old failure point and remained active through `saveRevision=119`.
- Build 337 `native-save-size-hard-limit` failure mode is no longer the dominant blocker in this run.
- `domainRuntime.idempotency` dropped dramatically versus Build 337, confirming the Build 338-A compaction/migration direction.
- The remaining lag is now dominated by the hourly finish/post-commit path rather than ordinary chunk execution.
- A representative heavy hourly sample shows low `applyMs` but very high `postCommitCriticalMs`, making post-commit integrity work the next primary performance owner.
- `maxFinishMs` is still high enough to cause visible stutter/frame drops under load.
- `mobility.tripArchive` remains a major persistent-state owner and is still pending audit/compaction.
- Internal/native saving works, but user-facing export/import for later restoration is reported as not working and must be traced end-to-end.
- User reports large route overlap: when launching/assigning about 900 assets, roughly 100 can stack on the same visible route/geometry. This must be fixed at routing/assignment ownership, not by cosmetic marker offsets alone.
- Screenshot evidence also shows severe visual concentration/stacking on the map during high-load operation.

Current user-visible priorities:
1. Major lag/frame-drop reduction.
2. Reliable save export + later import/restore.
3. Route diversity / anti-overlap for large fleets.
4. Preserve the already-recovered payable cheque/transfer and durable save behavior.

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

## 8. Build 338 decision status

**Build 338-A is implemented, CI-validated, and now device-tested.**

Confirmed from the iPhone retest:
- durable/native saving progresses beyond the Build 337 hard-limit failure point;
- idempotency size reduction is effective;
- cheque/transfer rollback caused by the old hard-limit is no longer the primary blocker;
- the dominant performance problem remains in the hourly finish/post-commit path.

Newly elevated issues:
- user-facing save export/import restore path does not work;
- severe route/geometry overlap for large fleet batch assignment;
- visible map/frame-rate pressure with ~2,000 assets and many simultaneous moving entities.

Approved next investigation/implementation sequence:
1. **338-E1:** root lag/frame pipeline — postCommitCritical / integrity / snapshot / rendering attribution.
2. **338-E2:** native-backed save export/import restore path.
3. **338-E3:** route diversity and anti-overlap at routing ownership.
4. **338-E4:** map renderer density/culling/Canvas strategy if profiling confirms DOM/Leaflet marker cost.
5. **338-E5:** mobility.tripArchive compaction only after its readers/references are audited.

Still forbidden without reference/contract audit:
- destructive proof stripping;
- arbitrary procurement retention windows;
- arbitrary route-history deletion;
- disabling rollback/integrity to gain speed;
- cosmetic-only route offsets as a substitute for routing correctness.

## 9. Build 338 priorities

### A. domainRuntime.idempotency
Measured dominant owner. Investigate per command family: fingerprint, command result, proof references, replay contract, indexes/domain state.

If permanent idempotency results are proven to be growth source, design VERSIONED FAMILY-SPECIFIC SEMANTIC RECEIPTS, not one generic receipt.

Requirements: semantic replay result preserved; no double execution; proof/reference behavior preserved; compatibility or atomic migration; rollback on migration failure.

### B. mobility.tripArchive
Measured major owner. Before pruning, audit UI/history/reporting, finance/revenue, asset provenance, route/trip state, analytics, proofs/audit and replay/recovery. No arbitrary time window/high-water mark.

### C. Transaction snapshot
Snapshot cost is material. Do not weaken atomicity. Audit transaction scope derivation, broad owners, actually touched mutable objects, rollback requirements and post-commit work. Narrowing must be ownership-derived and rollback-complete.

### D. documentProofs
Do not remove body/signature/path/digest before auditing verifyDocument, canonical digest, reverse references, forensic/export behavior and finance/audit dependencies.

### E. assets
Use moving/idle samples to identify field-level owners. No arbitrary bytes-per-asset target.

### F. realism.procurement
Audit closed deliveries and references from provenance, UI, finance, audit and proofs before archival/compaction.

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

## 14. NEXT ACTION — Build 338

Continue from the Build 338 verified source tree / source archive already recorded in this MASTER.

### Immediate work order
1. Trace the lag end-to-end using the Build 338 iPhone diagnostic:
   - `snapshotMs`
   - `applyMs`
   - `postCommitCriticalMs`
   - `schemaMs`
   - Native ACK / vault commit
   - map/render update cost
2. Repair the true owner of the hourly post-commit spike without removing atomic rollback or full integrity at required safety boundaries.
3. Trace user-facing save export/import:
   `export action → serialization → native bridge/file write/share → import picker/read → schema/hash validation → atomic restore`.
4. Trace large-fleet route assignment:
   `batch assignment → route candidate generation → duplicate/geometry signature → occupancy/capacity → departure → renderer`.
5. Prevent large-scale same-route/geometry stacking at assignment ownership; cosmetic map offset is secondary only.
6. Profile map rendering under ~2,000 assets; if DOM/Leaflet marker churn is material, move dense moving assets toward Canvas/culling while keeping selected/interactive markers precise.
7. Re-run finance/payable regression to ensure cheque/transfer remains intact.
8. Run stress tests and export a new diagnostic after each root fix batch.
9. Do not approve the next candidate until lag, export/import, and route-overlap regressions are all explicitly tested.

### New-chat continuation
A new conversation should begin with only:
**"كمل Global Holdings"**

It must read this MASTER from `globalholdings-project-control` and continue from the work order above without asking the user to repeat the project method or current state.

---
This file is a living handoff. Update it **only on `globalholdings-project-control`** at every validated build boundary.
