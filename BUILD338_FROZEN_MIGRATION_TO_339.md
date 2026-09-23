# BUILD 338 — FROZEN / MIGRATED TO BUILD 339

**DECISION DATE:** 2026-09-24  
**STATUS:** FROZEN FALLBACK / PROVENANCE BASELINE  
**NEXT DEVELOPMENT LINE:** Build 339

Functional development on Build 338 is stopped.

Build 338 remains the last verified fallback baseline and must be preserved for recovery if Build 339 introduces an architectural fault or regression that cannot be safely isolated.

Verified Build 338 runtime identity:

- Source tree SHA-256: `387fc40ef556af85803766604f554acfaf644e12258ec2e68e1fbfed53fb399b`
- WebApp tree SHA-256: `aed5ebc6773603703702de1cddacd2ed6197f9a2e68465ba39bf9ead0cc9aab3`
- Source ZIP SHA-256: `0a5be18327001bb0ceaf4feec99946f36b8eb0290d40523ddfa3265ab5285335`
- Runtime CI input commit: `6d62866bc83d551487961d13eeade8802a31eba3`
- Save Schema at fallback point: `2.0.0`

This file is documentation only. It does **not** redefine or mutate the verified Build 338 runtime payload.

All new architecture work moves to:

- Control branch: `build339-architecture-control-20260924`
- Master document: `GLOBAL_HOLDINGS_BUILD339_MASTER.md`

## Fallback rule

If Build 339 suffers a structural failure, broken time determinism, accounting/proof corruption, save/restore migration failure, or other unacceptable regression, return to the exact Build 338 runtime source identity above.

Do not recover from an IPA, unpacked app, old build, or reconstructed patch stack.
