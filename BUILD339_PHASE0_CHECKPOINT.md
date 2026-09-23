# GLOBAL HOLDINGS — BUILD 339 PHASE 0 CHECKPOINT

**DATE:** 2026-09-24  
**STATUS:** LOCKED LOCAL SOURCE CHECKPOINT / NOT PRODUCTION APPROVED  
**ACTIVE BUILD:** 339  
**SAVE SCHEMA:** 2.0.0  
**BUILD 338 STATUS:** frozen fallback only

## Immutable Build 339 Phase 0 identity

- Runtime source tree SHA-256: `8564b451e24df4935cec1e3e9bab95b135f05b73e3b99afb077b3b86bffb577a`
- WebApp tree SHA-256: `06234729bd9a6395f23fc46c958b4ee8f7d5c9e99c66c93f5e1b1aea78ce1652`
- Full source archive: `GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip`
- Source ZIP SHA-256: `b454b554fd67f0699b800c5d073d4e03b4f27c188b474dbe4eb3c87f470c0123`
- Source ZIP bytes: 132180722
- Library path: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip`
- Verification file: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0.verification.json`
- ZIP checksum file: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE0_ARCHITECTURE_BASE_SOURCE.zip.sha256`
- old_ipa_used: false
- production_approved: false

## Frozen fallback identity — Build 338

- Runtime source tree SHA-256: `387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b`
- WebApp tree SHA-256: `aed5ebc6773603702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3`

Build 338 is not an active development line. It is only the recovery baseline if Build 339 develops an unacceptable architectural regression.

## Phase 0 local provenance

Phase 0 was created from an exact verified Build 338 runtime-source baseline and contains no IPA-derived development source.

Local commits:

1. `a8caeb974928a7b9dc272dc15ac109c815319ff2` — baseline: exact verified Build338 runtime source
2. `dd9b10954c0a204f73ac73280c4965105c2a2c1f` — clean Build339 identity and transient architecture telemetry
3. `819d1fff3c422080996e6c6785d4ab65951e7b6d` — close initial source-hash lock gate
4. `38195170a018d9f32f2ae616f0a37885513b3293` — reduce telemetry measurement perturbation
5. `ee50c5166bbeb854697b6c3a7c5b3c828860335b` — relock runtime and WebApp identities

The local git SHA is provenance only. The authoritative portable development source for continuation is the full source archive + runtime source hash above.

## Phase 0 scope

Phase 0 intentionally changes no game-domain semantics. It establishes:

- Build identity 339 consistently in BUILD/native project/WebApp/package metadata.
- Save Schema remains 2.0.0.
- Transaction telemetry now records per post-commit task duration, key, owner, priority and success.
- Control-plane telemetry separates final schema validation time from business-integrity time.
- Save-schema telemetry separates authorization/document-proof/company-platform phases and proof verification sub-phases.
- App/map telemetry measures simulation frame contribution, marker target updates, marker interpolation and structural map renders separately.
- Diagnostic export now carries these runtime telemetry channels.
- Bootstrap regression prevents Build/runtime identity drift and verifies rollback on a critical post-commit failure.

Phase 0 does NOT yet replace:
- the time engine;
- hourly fullSnapshot;
- transaction rollback architecture;
- persistence format;
- route assignment;
- map renderer;
- tripArchive representation.

## Regression evidence completed locally

PASS:
- Build339 architecture bootstrap: 12/12
- Source layout verifier: 10/10
- Build338 root contract
- Build337 instrumentation baseline
- document-proof-v3 security
- durable authorization: 5/5
- Hour83 calendar/proof rollback regression
- durable post-commit: 6/6
- simulation time contract
- map pressure contract: 6/6
- scheduler liveness: 14/14
- simulation fault isolation: 3/3

Not claimed:
- ESLint did not run locally because the environment does not contain the eslint package.
- Local Node version was v22.16.0, not the required Node 24 CI environment.
- No Apple/Xcode/WKWebView/native-storage/device gate has been claimed for Build 339 yet.

## Release gate

Phase 0 source identity is locked, but Build 339 remains NOT production approved.

Mandatory remaining candidate gates include:
- Node 24 + ESLint + full source acceptance CI;
- fresh iPhoneOS Release build;
- WKWebView/navigation gates;
- native storage/A-B vault gates;
- physical iPhone diagnostics;
- architecture stress tests after functional migration phases.

## NEXT ACTION — Phase 1

Do not repeat Phase 0.

Start only from the exact Build 339 Phase 0 source identity above.

Phase 1 goal:
**replace the architectural boundary around time/scheduler behavior without breaking current deterministic semantics.**

Required order:
1. build a golden compatibility harness that records current 338/Phase0 boundary ordering and externally visible results;
2. enumerate all writers/readers for simSeconds, backlog, hour/day/month boundaries and manualAdvance;
3. define the new deterministic scheduler contract before changing the owner;
4. preserve one authoritative simulation clock;
5. separate render cadence from simulation time;
6. make bounded work/yielding explicit without skipping or reordering economic events;
7. do not remove fullSnapshot yet unless the new transaction architecture has its own independently proven rollback contract;
8. run Hour83, day-close, time-rate, scheduler-liveness and save/restore regressions after each sub-step;
9. update this checkpoint/master immediately after every accepted Phase 1 batch.

