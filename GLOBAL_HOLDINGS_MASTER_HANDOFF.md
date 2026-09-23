# GLOBAL HOLDINGS — MASTER HANDOFF / CONTINUATION PROTOCOL

Purpose: Permanent source-control handoff for continuing Global Holdings across conversations/developers without re-explaining the project or changing the engineering method.

MANDATORY: A new conversation must read this file first, establish the current Source of Truth and latest diagnostic/evidence, and continue from NEXT ACTION. Do not ask the user to repeat information already recorded here.

## 1. Current authoritative checkpoint

- Product: Global Holdings
- Version: 3.0.0
- Current validated build: 337
- Next development build: 338
- Save Schema: 2.0.0
- Repository: bdr-design/GlobalHoldings-iOS-Source
- Provenance branch: build337-instrumentation-ci-20260923
- Successful Build 337 commit: 3ae0392d700f5fd41900f4ead8293a825f4e750d
- Successful CI run: 35895055039
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

The Build 337 provenance branch reconstructs the validated tree. Preserve that exact validated tree as a standalone clean source archive when practical.

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

## 3. Latest device diagnostic

Latest device diagnostic after Build 337 testing:
GlobalHoldings_diagnostic_v3.0.0_1790187863706.ghdiagnostic

This supersedes the older Build 336 field diagnostic for Build 338 decision-making.

Key observed findings:
- Root persistent state approximately 36,192,808 bytes.
- domainRuntime approximately 14,968,632 bytes.
- domainRuntime.idempotency approximately 14,899,945 bytes.
- mobility approximately 9,077,865 bytes.
- mobility.tripArchive approximately 7,539,344 bytes.
- assets approximately 3,907,407 bytes.
- documentProofs approximately 3,026,690 bytes.
- Large idempotency entries include fleet batch command families such as route assignment/departure, with very large fingerprints/results.
- Chunk execution remained comparatively cheap while Finish remained expensive.
- Transaction snapshot cost is material and must be treated as measured evidence, not guessed.
- Persistence reached hard-size pressure/failure.

The raw diagnostic is evidence. Do not replace exact profiler data with this rounded summary for destructive decisions.

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

## 8. Build 338 priorities

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

## 9. Non-regression invariants

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

## 10. Performance methodology

Separate and measure chunk execution, transaction snapshot, validation, apply, post-commit critical/non-critical, serialization, bridge dispatch, native vault commit and UI/render work.

Use device diagnostics to identify the measured owner. Cheap chunks plus expensive Finish does not mean smaller chunks are the fix.

Time-engine changes are high risk. Do not modify speed/time semantics unless the measured owner requires it and dependent domains are audited.

## 11. Source-control / release discipline

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

## 12. Conversation continuation behavior

When a new conversation receives “كمل Global Holdings” or equivalent:
1. Read this MASTER HANDOFF.
2. Inspect repository/current branch and latest relevant diagnostic/evidence.
3. Verify Source of Truth before modifying code.
4. Resume from NEXT ACTION.
5. Do not ask the user to repeat architecture, repair method, deletion/addition rules, source rules, or recorded state.
6. Do not stop after every small step asking for permission.
7. Continue in careful batches and report meaningful checkpoints.
8. Ask only when a genuinely missing external artifact/decision cannot be established from repository, diagnostics, library or prior evidence.
9. Never infer a missing source hash/build provenance.
10. Communicate in Arabic unless requested otherwise.

## 13. NEXT ACTION — Build 338

1. Treat validated Build 337 tree as sole baseline.
2. Reconstruct/verify against b49061cfc68c89eb144c6c1107edf91e997a367325c8ffdd18dcc52ac33fc484.
3. Use latest Build 337 iPhone diagnostic GlobalHoldings_diagnostic_v3.0.0_1790187863706.ghdiagnostic.
4. Perform code-level ownership/reference/replay audit of domainRuntime.idempotency, beginning with largest measured command families.
5. In parallel map mobility.tripArchive readers/references; do not prune yet.
6. Design smallest root-level Build 338 change justified by audits.
7. Preserve Save Schema 2.0.0 and invariants.
8. Add targeted tests before acceptance.
9. Re-run stress/diagnostic gates and compare state size plus Finish/Persistence/Native timings.
10. Only after evidence passes package Build 338.

---
This file is a living handoff. Update it at every validated build boundary so the next conversation resumes without reconstructing project history from chat memory.
