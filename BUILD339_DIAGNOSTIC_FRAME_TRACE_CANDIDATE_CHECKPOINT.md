# Global Holdings — Build 339 Diagnostic Frame Trace Candidate

**Date:** 2026-09-25  
**Version:** 3.0.0  
**Build:** 339  
**Save Schema:** 2.0.0  
**Status:** diagnostic source candidate; Production approval CLOSED

## Parent and source identity

This candidate starts from the locked clean Build 339 Phase 1C-B Writer Proof source. It does not use an IPA, an overlay, Build 338, or the separate experimental Phase 1C-C candidate.

- Parent runtime SHA-256: `8570d5d7c6b9add34196b564d7f4498648c719a397eb598a65b21b00c9ac9325`
- Parent WebApp SHA-256: `6f12bf6b4f76859229936d1f382d7865275c390e6eb6e7eb7aee9bc2591e91af`
- Parent source ZIP SHA-256: `27c1b52295f1adee6629ab2c7b69653b075262d500e07e4ca256f6a642734a5a`
- Candidate runtime SHA-256: `c40150e8ded4fbf4bbf995c7bff339576b1830e1353decb3781fccf563d6645f`
- Candidate WebApp SHA-256: `99dbb2251447eb211a8390bec571e00204a766e9b45ff48b5abb4e6d1cb04435`
- Runtime files: **482**

## Changes

- The fault recorder measures visible `requestAnimationFrame` intervals, callback delay and duration, simulation and presentation stages, missed-frame estimates, and P50/P95 timings. It stores a 240-frame ring and bounded histograms only in runtime-only recorder memory.
- Frame samples are taken on every callback only while fault recording is active. Conference, lifecycle-lock, and recovery callbacks are included so guarded paths do not disappear from the trace.
- `PerformanceLongTaskTiming` records long-task duration and available attribution. It reports capability status when the browser does not support that observer.
- Transaction evidence includes rollback/snapshot timings. The cause is labelled transaction-correlated only when the transaction timestamp falls inside the delayed-frame window; this remains a time correlation, not a call stack.
- The report and diagnostics panel expose full recorder totals and export the bounded full history rather than silently truncating it to 30 entries.
- Added `simulation-pacing-core.js` to the clean runtime-required manifest because `index.html` loads it before `simulation-core.js`.
- Updated two legacy Build 334 guards to compare the embedded runtime build with the repository `BUILD` value.

`simulation-core.js` and `transaction-core.js` are unchanged. Save Schema 2.0.0, transaction semantics, rollback behavior, and game-state persistence are unchanged. Tests verify that frame capture does not mutate saved simulation state.

## Verification

- Node.js: `v24.19.0`
- `verify_current_source.py`: **PASS**, 482 runtime files, candidate SHA above
- `test:build339`: **PASS**, including the new frame-trace suite (**28/28**)
- Build 336, 337, and 338 regression suites: **PASS**
- Full acceptance: **95/102 passed**; runtime source remained unchanged during testing
- Seven unavailable environment gates: ESLint is not installed; six browser tests could not launch because the Playwright Chromium executable is absent. Five timed out waiting for it; one failed immediately at browser launch.
- Fresh Apple build, physical iPhone/WKWebView frame-overhead measurement, and iPhone JavaScriptCore journal benchmarks: **not run**

The full acceptance result is not a clean pass. The candidate is not an IPA and is not production-approved.

## Runtime and release state

- Live simulation Journal: **OFF**
- Hour Journal: **OFF**
- Day Journal: **OFF**
- Full Snapshot fallback: **ON**
- Production approval: **CLOSED**
- IPA built from this candidate: **NO**
- Old IPA used: **NO**

## Remaining evidence

Run the browser and ESLint gates in the configured CI environment, then measure recorder overhead and dropped-frame attribution on a physical iPhone/WKWebView under the established fleet and simulation load. Keep Journal disabled and Full Snapshot fallback enabled until the separate Phase 1C-C equivalence, rollback, allocation, writer-coverage, and iPhone JavaScriptCore gates are satisfied.
