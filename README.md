# Global Holdings — Build 340 engine separation candidate

Version 3.0.0 · Build 340 · Save Schema 2.0.0. This is an experimental clean-source candidate. Production approval remains closed.

The complete Build 340 source is tracked directly at the repository root. CI checks out and verifies this tree; normal builds do not reconstruct a prior archive or apply a source overlay. The content descends from the verified candidate ZIP cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9; the runtime source tree SHA-256 remains 7f74cc211b192d9dc05db6d11d81ac852205e1f5039e49c0eabbbe6e839df20f.

Build 340 uses immutable Worker plans for simulation and air/sea and road routing; indexed procurement, disposal, finance and payroll batches; map read models; and bounded media decoding. The simulation, finance writes, fleet and route commits, persistence, authorization, and transaction owners remain on the serialized authoritative state boundary. This source does not activate the experimental field journal or modify Save Schema 2.0.0.

Direct-source CI run 36247000333 tested commit 73234985380abf3321fb181ba81ba2dcc4967635 and passed the 123/123 declared source gates, lint, browser checks, native storage and WKWebView checks, and a fresh unsigned arm64 iPhoneOS Release app build. CI created source-bound unsigned Build 340 test IPA GlobalHoldings_BUILD340_unsigned_TEST.ipa, 13364410 bytes, SHA-256 2a401f3936105849a44faf0d9b3196e29a8a6e9eebe7cebe6a417db3eac6219a. No physical iPhone was tested. Node tests with synthetic 4,300/20,000 inputs do not establish iPhone performance.

The release gate remains closed until purchase, delivery, sale, routes, finance, save/restore, and long-session interaction pass on physical iPhones at 4,300 and 20,000 assets, including the agreed frame-time, touch-latency, memory, and thermal measurements.
