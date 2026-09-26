# Build 334 deep simulation, finance, asset, route and HR audit

Date: 2026-09-20  
Scope: `/workspace/scratch/c128166b28f0/GlobalHoldings_BUILD334_Source` only.  
Production source changes by this audit: none.

## Existing Build 333 regression baseline

The first `npm test` attempt failed before application code ran because the isolated source directory did not contain `eslint`. Re-running with the shared dependency path passed. The first browser attempt likewise failed because Playwright could not locate Chromium; setting the shared browser path resolved it.

Commands that passed:

```bash
NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules npm test
NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/c128166b28f0/pw-browsers npm run test:browser
NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/c128166b28f0/pw-browsers npm run test:visual
NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/c128166b28f0/pw-browsers npm run test:interface
GH_PREVIOUS_WEBAPP=/workspace/scratch/c128166b28f0/GlobalHoldings_BUILD332_Source/WebApp NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/c128166b28f0/pw-browsers npm run test:review
NODE_PATH=/workspace/scratch/c128166b28f0/gh_test_deps/node_modules PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/c128166b28f0/pw-browsers npm run test:god
```

Observed passing coverage included the core, fleet, persistence, procurement idempotency, native-pressure, finance-depth, identity, tax-reload, conference, visual, interface, Build 332 upgrade, finance presentation, and God Mode suites. The conference test retained four vendor payments, an exact 8.6M cost, resume/archive/reload/replay behavior. Interface tests retained 32 panels, durable manager appointment and rollback on save failure. God Mode retained its four pages and five tested viewport configurations.

The Build 333 reference remained read-only. `sha256sum -c verification/333-source-manifest.sha256` was run inside `GlobalHoldings_BUILD333_Source` after the audit and returned status 0 for every manifest entry; no Build 333 file changed.

After unrelated concurrent Build 334 edits landed, one intermediate `npm test` stopped at lint before the suite ran: `map-layer-registry.js:84:28` referenced undefined `FILTER_STATE_VERSION`. It was reported immediately and the owner repaired it to read `FEATURE.FILTER_STATE_VERSION`; this audit did not modify production code.

The next full gate exposed a VM-fixture dependency in `tests/fleet-regressions.cjs`: its extracted `app.js` slice called `companyFinanceName` without providing that helper. The fixture owner repaired it. A subsequent full `npm test` passed completely, including lint, identity, company platform (12/12), adapters, dynamic consumers (12/12), dynamic finance (14/14), map, security, signature, formation, conference, all audit contracts, durable authorization, core, fleet, persistence, procurement, finance-depth, review and tax-reload regressions.

## New deterministic audit tests

These tests exit non-zero while a reproduced contract defect remains:

```bash
node tests/build334-simulation-time-contract.cjs
node tests/build334-finance-settlement-contract.cjs
node tests/build334-asset-route-hr-contract.cjs
node tests/build334-company-platform-orphan-contract.cjs
```

Status against the current Build 334 tree after concurrent repairs:

| Contract | Exit | Current result |
|---|---:|---|
| Simulation/time | 0 | Exact four public rates, boundaries, runtime allow-list and save-schema allow-list pass. |
| Finance/settlement | 0 | All ten initially reproduced defects are repaired and retained as regression checks. |
| Asset/route/HR | 0 | All six invariants pass, including four defects that were repaired after the initial reproduction. |
| Company-platform compatibility | 0 | Unknown explicit definitions fail closed and canonical-only migration does not synthesize legacy aliases. |

### Confirmed healthy invariants

| Invariant | Result | Source |
|---|---:|---|
| 30x, 120x, 300x and 600x each advance the exact simulated amount | Pass | `simulation-core.js:63-81`, `simulation-core.js:104-160` |
| At 600x, one simulated day contains exactly 24 hourly commits and one daily commit | Pass | `simulation-core.js:93-101`, `simulation-core.js:148-159` |
| Fleet batch route assignment validates the complete batch before mutating any asset | Pass | `fleet-core.js:80-124` |
| Route company/type isolation rejects a sea-owned air route | Pass | `route-core.js:39-61` |
| A missing runtime route explicitly isolates the asset and emits an alert | Pass | `app.js:1680-1681` |
| Mid-slice arrival anchors the next departure to the actual arrival instant | Pass | `app.js:1696-1703` |
| Missing executive-candidate metadata remains a visible staffing gap and blocks hiring | Pass | `hr-core.js:69-75`, `hr-core.js:91-99` |
| A reused salary reference with a different payload is rejected | Pass | `hr-core.js:108` |
| Existing Build 333 regression suites | Pass | Commands above |

### Defects reproduced and repaired during this audit window

| Initial severity | Reproducer ID | Initial evidence | Repair evidence |
|---|---|---|---|
| Critical | `VAT_OPEN_ACCRUAL_OVERWRITES_FORMAL_DUE` | After closing 300 VAT, a new 150 accrual changed the book to 150 while formal due remained 300. | Formal due and open accrual are separated by `refreshBookTaxPayable` at `finance-core.js:138`; the contract now passes. |
| Critical | `VAT_SECOND_CLOSE_DROPS_PRIOR_DUE_FROM_BOOK` | Two open periods totaled 450 while the book held 150 and failed the integrity checker. | All open formal periods are derived at `finance-core.js:138`; the contract and integrity check now pass. |
| Critical | `DEBT_REPAYMENT_REFERENCE_DOUBLE_POSTS` | Replaying the same 100 repayment reference deducted twice. | Reference/fingerprint admission precedes mutation at `finance-core.js:289-292`. |
| High | `VAT_CLOSE_NOT_IDEMPOTENT` | Closing the same period twice created duplicate period IDs and changed the book. | Calendar-period ID plus close evidence guard at `finance-core.js:431-434`. |
| High | `INTERCOMPANY_INTEREST_REFERENCE_CONFLICT_SILENT` | Reusing an interest reference with a different amount was accepted. | Payload conflict guard at `finance-core.js:150-163`. |
| High | `PAYROLL_REFERENCE_CONFLICT_SILENT` | Reusing a group payroll reference for air returned the old document. | Payroll fingerprint/company guard at `finance-core.js:189-205`. |
| High | `INTERCOMPANY_LOAN_ID_CONFLICT_SILENT` | Reusing a loan ID with a different borrower/amount returned the first loan. | Loan payload conflict guard at `finance-core.js:175-188`. |
| High | `FOUNDER_WITHDRAWAL_PARTIAL_SUCCESS` | Requesting 450,001 from 450,000 silently withdrew 450,000. | Exact insufficient-funds rejection before mutation at `finance-core.js:285`. |
| Medium | `VAT_PERIOD_LABEL_NOT_GREGORIAN` | Gregorian day 364 (`2026-12`) was labeled simulation month 13. | `calendarMonthForDay` is used for VAT keys and labels at `finance-core.js:398`, `finance-core.js:431-434`. |
| Contract mismatch | persisted fifth speed | Validation accepted legacy speed level 5 despite four public speeds. | Save validation now accepts only `0..4` at `save-schema.js:190`; migration continues mapping old level 5 safely. |

### Defects repaired during this audit window

The asset/route/HR contract initially reproduced four additional defects. They are retained as regression assertions and now pass: missing routes are isolated, mid-slice departure time is exact, a missing candidate catalog cannot report false completion, and conflicting salary references fail. The company-platform contract also initially reproduced an unsafe fallback from an explicitly unavailable saved definition to the stale built-in company definition; that fail-closed case is now repaired. No production repair was made by this audit agent.

### Company-platform defects repaired during this audit window

`build334-company-platform-orphan-contract.cjs` first proved that an explicitly unavailable saved definition could fall back to a stale built-in definition. After that was repaired, it exposed canonical migration creating `route.type` and `facility.companyId`. Both cases now pass: the exact saved definition is authoritative, existing legacy aliases remain untouched, and canonical-only records do not grow aliases. The relevant implementation is at `company-platform-core.js:123-128`, `company-platform-core.js:214-219` and `company-platform-core.js:234-242`.

## Performance risk requiring an iPhone benchmark

Manual calendar advance does not skip business boundaries, which is correct, but it uses the same one-real-second quantum per slice. At 600x, advancing 365 days requires 52,560 atomic slices before asset count is considered. This follows from `simulation-core.js:78-82` and `simulation-core.js:192-230`. It is not a correctness failure in the deterministic test, but a full-year advance with a large fleet should be profiled on WKWebView before acceptance.

## Remaining acceptance work

1. Run the complete browser/visual/interface/upgrade/God Mode gate again after all concurrent Build 334 edits settle.
2. Profile a full-year 600x advance with a large fleet on real iPhone/WKWebView hardware.

## Files created by this audit

- `tests/build334-simulation-time-contract.cjs`
- `tests/build334-finance-settlement-contract.cjs`
- `tests/build334-asset-route-hr-contract.cjs`
- `tests/build334-company-platform-orphan-contract.cjs`
- `verification/build334-deep-simulation-finance-audit.md`

No file under `GlobalHoldings_BUILD333_Source` was created, changed, or used as an output target.
