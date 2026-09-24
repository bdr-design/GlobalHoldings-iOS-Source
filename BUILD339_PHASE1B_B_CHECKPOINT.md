# BUILD 339 PHASE 1B-B — AUTHORITATIVE CHECKPOINT

Date: 2026-09-24
Build: 339
Version: 3.0.0
Save Schema: 2.0.0
Production approval: CLOSED

## Parent verification

Phase 1B-B started only from the byte-verified Phase 1B-A source.

- Parent runtime SHA-256: `835709c802e82d968a259224563dda0a3c7e242f21ac322bc09703e1226f6cb8`
- Parent WebApp SHA-256: `3bdd4ae860baee183dc54715a9bb0d4298cd9073371f9d2eee60508c6cb33338`
- Correct parent ZIP SHA-256: `c3c747a187ecee6def4fe94125205f5ea0ff61015ec2be5b05e7cfd63909f1ee`
- The alternate hash beginning `c3c747a1fce8...` was a documentation typo.

## Locked Phase 1B-B source

- Runtime source tree SHA-256: `6c90897d15f1b2736a48233bf29a629ea5976987f4cd9cd5efdea5fcefbe8f54`
- WebApp tree SHA-256: `ada2977ddadc0f6df1558acd0b4543de77163da5ae0bfa6b63eb087522a9489e`
- Canonical Library archive: `/GlobalHoldings-Releases/Build339/GlobalHoldings_BUILD339_PHASE1B_B_PACING_SEPARATION_SOURCE.zip`
- ZIP SHA-256: `acd6cc9f324d6eb2975f74f076421f253e3cff5229104dc319f50a819b2fde77`
- Archive Library ID: `libfile_94bc2253cccc8191b627fbd78626238e`
- Verification Library ID: `libfile_9ee958e840708191bb47cb2d182d9bc6`
- Checksum Library ID: `libfile_2bb11d653bac8191a0074a1fe806ea53`

## Accepted architecture

- Wall-clock pacing, backlog, execution budget, render cadence and persist cadence are runtime-only.
- `state.simSeconds` remains the sole authoritative committed economic time.
- Variable deterministic 30/120/300/600 slices remain unchanged.
- Exact Hour/Day boundary clamping remains unchanged.
- Midnight ordering remains Day -> Hour.
- Manual advance remains target-driven and its wall duration cannot leak into live catch-up.
- Hidden/background wall time is not replayed as economic catch-up.
- Render cadence no longer persists `simulationEngine.snapshot()` into `state.simulationKernel`.
- Save normalization removes legacy scheduler/pacing snapshot residue while preserving semantic simulation audit fields.
- Full snapshot rollback remains enabled. Root Journal/COW is not active.

## Regression state

Local PASS: Build339 architecture bootstrap, Golden Time, Phase1B-B pacing contract, Hour/Day write maps, Hour83, finance settlement/day-close related contracts, scheduler liveness, late-frame liveness, 600-air, persistence/save regressions, source-layout 10/10, official source verifier.

Pending: Node24/full source acceptance CI, controlled ESLint, Apple/WKWebView/native gates, physical iPhone diagnostic. Local lint could not start because the local source environment lacks the eslint package. Production approval remains CLOSED.

## NEXT ACTION

Phase 1C: Capture-On-First-Write / sparse undo journal with root/entity hybrid rollback and automatic full-snapshot fallback for every unproven writer. Do not remove full snapshots until writer coverage and byte-equivalent rollback are proven.
