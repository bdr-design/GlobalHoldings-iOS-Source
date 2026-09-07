# Global Holdings 2.3.9 Build 242 — Atomic Clean Baseline

This document is a release invariant contract. Future changes must preserve these rules or fail CI.

## Persistence and update invariants

1. Save Schema remains `2.0.0` unless an explicit schema migration project is approved.
2. `saveRevision` is the monotonic persistence clock. `simSeconds` must never be used alone to decide which save is newest.
3. Reset ordering is `resetEpoch -> saveRevision -> simSeconds`.
4. Native Save Vault writes are serialized, verified after write, and use independent rollback checkpoints for pending updates.
5. A runtime update and its save generation are one recovery pair. Rollback must restore both.
6. Update Journal is persisted before any runtime-directory mutation.
7. Stable updates accept only `packageType=full-web` and `installMode=clean-snapshot-v1`.
8. `operationsJSON` is mandatory and the exact executed bytes must match the signed SHA-256.
9. Signature payload v2 is mandatory. Raw unsigned operation arrays are forbidden.
10. Target version must be strictly newer than the installed runtime. Rollback uses Native recovery, never downgrade installation.
11. Final update commit requires state committed + boot confirmed + verified Native save generation.
12. Native is the single update lifecycle owner. Web update events are presentation-only.

## Simulation invariants

1. Simulation Core is the only owner of game time.
2. Supported user speeds are exactly Pause, x1, x2 and x4.
3. A simulation slice is all-or-nothing. Partial eligible-asset commits are forbidden.
4. Day/hour boundaries execute inside the same atomic slice transaction.
5. Business outcomes must not branch on user speed or frame cadence.
6. Wall-clock timers may be used for UI/performance diagnostics only, never executive AI business decisions.
7. Critical post-commit persistence failure rolls state back to the transaction snapshot.

## Financial invariants

1. Every cash/debt/payable/receivable movement has a source document or explicit internal-transfer source and a balanced journal entry.
2. Every journal entry must satisfy total debit == total credit within one cent.
3. Revenue and expense are recorded gross; net profit must never be posted as revenue.
4. Trip revenue/fuel/maintenance use one daily settlement source; no per-trip + daily duplicate revenue documents.
5. VAT keeps output, input and carry-forward credit separately; tax periods record period deltas, not cumulative liabilities.
6. Company budget checks and consumption/reservation use the same budget line and period.
7. Unfunded payroll and operating expenses use the unified accrued-expense path: document + payable + journal.
8. Intercompany and treasury transfers create balanced counterpart entries for both entities.
9. Archived finance data retains source identifiers and compact source traces; open AP/AR consolidation retains `sourceDocumentIds`.

## AI governance invariants

1. GH AI is a primary operating agent across staffing, fleet, routes, facilities, procurement, finance/risk reviews and dependency closure.
2. AI review cadence is simulation-time deterministic.
3. Major standalone decisions require explicit user authorization.
4. An approved annual plan is scoped delegation, not unlimited authority. Execution must remain within plan company/type/budget/quantity constraints.
5. AI must not bypass funding, capacity, workforce, procurement, finance, lifecycle or integrity gates.
6. Every AI request/delegated action has a stable request/plan reference and lifecycle state.

## Release gate

A release must not be called a clean baseline unless:
- all non-browser repository tests pass;
- every WebApp JavaScript file passes syntax checking;
- Swift sources pass parser checks and the Swift/native contract guard;
- Python build scripts compile;
- no stale signed update package remains after source edits;
- browser QA passes in CI with pinned Playwright;
- the iOS target builds in Xcode/macOS and is smoke-tested on a real WKWebView device/simulator;
- update fault-injection scenarios verify old-or-new recovery, never mixed runtime/save state.
