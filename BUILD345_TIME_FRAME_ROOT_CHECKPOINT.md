# Build 345 time/frame investigation checkpoint

Status: DIAGNOSTIC REVIEW ONLY. No gameplay repair, new IPA, new game test, or under-5-ms result is claimed.

## Source boundary

- Parent/source: Build 344 / 3.0.2 / Save Schema 2.0.0.
- Exact parent commit: b2f74fae5ceaa126c8b6ecbb6ddc24ade0e24654.
- Parent branch: fix/build344-frame-safety.
- Investigation branch: fix/build345-time-frame-root.
- Handoff runtime source SHA-256: e81ce91e355c7ad7838b4dd19f347873aea8d8a581ed86f4f1e69f5d8b5b2fa9.
- Handoff WebApp SHA-256: 6070d9297b4676346a29198c0ca2f25e28abf210f9e82b8caa9424f987f5d372.
- This checkpoint does not bump app/build metadata or approve production.
- Build 340 may be READ as a calendar comparison reference, per the user. Do not revert the entire project or develop from an extracted IPA.

## Field evidence (not a Build 344 measurement)

Input: GlobalHoldings_diagnostic_v3.0.1_1790585629674.ghdiagnostic.
SHA-256: f8c89856c15c197bb739ba853617e30cf1686239b18dadf415eac0b71594434e.
The input identifies its runtime as Build 343 / 3.0.1, with 900 assets, and a 187690-ms recording. Its measurements must not be attributed to Build 344 or to a new repair.

- Latest simulation export: 182 conflicts, 186 cancellations, 145 slices, 864 backlog clamps.
- Calendar failure: simulation-source-revision-conflict, commit stage, from 6330 to 7200 simulation seconds, stopped at 6330, retries 3.
- Simulation maxima: create 4 ms, chunk 7 ms, finish 22 ms.
- Whole-recording frame callback maximum 142 ms, callback p95 4.25 ms.
- Maximum visible frame interval 771 ms; effective measured FPS 58.67. Hardware refresh rate was not measured.
- 187 janky frames, 355 estimated missed frames; these are recorder estimates, not hardware counters.
- Structural render maximum 8 ms; marker animation maximum 1 ms; target-update maximum 3 ms.
- Last ordinary-save synchronous sample: schema 10 ms, stringify 48 ms, measurement 4 ms, total 62 ms, revision 33.
- Last Native ACK is for revision 32, not that revision-33 save. Its 2579-ms ACK latency / 2573.78-ms Native commit duration must not be called equivalent main-thread blocking.
- Retained transaction samples also show assign-routes-batch 110 ms and depart-batch 102 ms. They are samples, not complete-session maxima.

## Observability limitation

The export retains only the latest 240 detailed frame rows. Its retained FRAME_DROP events have a maximum interval of 121 ms, versus the whole-recording maximum of 771 ms. The exact cause of the worst historic gap cannot be reconstructed from the retained window alone. Preserve bounded worst-frame evidence as well as a recent ring; do not claim exact GPU, GC, or scheduler attribution without measurements.

## Source inspected, not patched

The following Build-344 source was read through the repository connector: app.js, kernel-core.js, transaction-core.js, simulation-core.js, and the existing Build-344 workflow.

app.js:createSimulationSliceJob captures the asset-array identity/count and transaction inputRevision; sourceStillCurrent rejects a changed input before commit. transaction-core.js excludes only diagnostics/saveRevision-only commits from inputRevision. Recorded operations:record-alert transactions modify domainRuntime/alerts/eventLog. This is a lead to reproduce, NOT proof that these writers caused all conflicts. Do not disable the source guard, blindly exempt domainRuntime, or only increase retry limits.

## Execution limitation

Local Git clone/source download did not succeed. Creating a source-review CI workflow was rejected by the tool; that workflow was not installed or run. Existing Build-344 verification artifacts were downloaded and inspected instead; they contain evidence, not a complete source checkout. No source-export workaround or gameplay edit was executed.

A local read-only diagnostic analyzer was written and checked with 6 unit tests (format rejection, missing metrics, strict less-than threshold, input-byte preservation, retention loss, and asynchronous Native latency separation). Those are ANALYZER tests, not game acceptance tests.

## Resume with the exact complete Build-344 source

1. Reproduce the calendar conflict on the current source. Capture bounded runtime-only input-revision writer/path evidence. Compare Build 340 only as needed, preserving all newer safety contracts.
2. Keep one simulation writer with validated inputs, atomic publication, exact rollback, and no time/revenue publication from cancelled drafts. Verify real conflicting gameplay writes still reject stale work.
3. Complete resident Worker ownership and bounded transfer buffers; avoid per-asset DTO/patch allocation and full-state stringify on the UI thread. Include command preparation, proof verification, hour/day closure, map queries and list rendering in the performance audit.
4. Complete Native begin/chunk/commit/abort handling without speculative timeout rollback; test disconnects, late ACKs, duplicates, conflicting packets and explicit NACK recovery.
5. Fix the full-app operational-route fixture before running actual workload tests. Preserve failure status rather than converting an empty workload into a performance pass.
6. Measure maxima AND percentiles, whole-frame callbacks and external synchronous work, at 900 / 1800 / 3380 / 10000 / 20000 assets. Cover calendar advancement, arrivals, revenues, day/month boundaries, bulk actions, saves/reloads, UI/map gestures and rollback injection.
7. Validate on the user's iPhone 17 Pro Max. Keep production approval closed. No strict under-5-ms result is established by this checkpoint.
