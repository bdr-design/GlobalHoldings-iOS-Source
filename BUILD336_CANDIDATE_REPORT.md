# Global Holdings — Build 336 Source Candidate Verification

**Version:** 3.0.0  
**Build:** 336  
**Save Schema:** 2.0.0  
**Production approved:** NO  
**IPA built:** NO

## Source binding

- Build 335 baseline source tree: `5c5750e07f92811e42d34edddec85551f69a1b81961da274a08ba398417103a5`
- Build 336 source tree: `ff958436f71c14c4d311621270095d99afe2383b3ba39b1807b8be28c484420a`
- Build 336 WebApp tree: `fe92da4835d1fa064e9e56098b40f5dc3aad120421674f191bf7cb15d9122fff`

## Root cause fixed

Build 335 could copy a fully protected legal document into company/treasury ledgers. The ledger copy could then differ from the canonical document after authorization or presentation changes while retaining the same `documentProofId/contentDigest`. At the first day-3 compaction boundary (the reproduced hour-83 path), the old ledger copy became part of the audited archive and was finally verified as a document, producing `document-proof-integrity` and blocking the next simulation finish.

Build 336 separates the two identities: the canonical finance document keeps the legal proof; ledgers receive `gh-ledger-projection-v1` projections containing provenance only. A strict legacy migration converts only provably equivalent Build 335 copies and refuses unrelated material changes. No proof bypass, auto-proof or catch-and-continue was added.

## Runtime scope

Changed runtime files only:

- `WebApp/app.js`
- `WebApp/diagnostics-core.js`
- `WebApp/document-proof-core.js`
- `WebApp/finance-core.js`
- `WebApp/save-schema.js`

`simulation-core.js`, `transaction-core.js` and `persistence-core.js` are unchanged.

## Passed local gates

- Build 335 save coalescing: 2/2
- Build 335 Compaction V2: 12/12
- Build 335 sea facility: 3/3
- Build 336 hour-83 calendar recovery: PASS
- Build 336 strict migration/idempotency/tamper rejection: PASS
- Build 336 1,220 real proof pressure: PASS
- Build 336 1,020 asset/delivery byte attribution: PASS
- Build 336 intercompany sender/receiver ledger projection: PASS
- Finance company security: 8/8
- Document Proof v3 security: 25 document types PASS
- Durable authorization: 5/5
- Archive integrity R2: 15/15
- Transaction promotion R2: 5/5
- Atomic simulation: 9/9
- 600-aircraft full-day regression: PASS / Governor GREEN / 0 conflicts / 0 cancels

## Explicit blockers before IPA / RC approval

- Node 24.21.0 acceptance gate has not been rerun in this container (local Node is 22.16.0)
- ESLint gate is not runnable locally because the pinned eslint package is unavailable in this container
- Playwright / real browser recovery gate is not runnable locally because the pinned Node playwright package is unavailable
- Fresh Apple iPhoneOS Release / WKWebView / Native CryptoKit gates have not yet been run for Build 336
- Physical iPhone long-session validation from the migrated Build 335 save remains required
- Production approval remains closed until all acceptance gates pass

No blocked gate is represented as a pass.
