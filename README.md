# Global Holdings — Build 340 engine separation candidate

Version 3.0.0 · Build 340 · Save Schema 2.0.0. This is an experimental clean-source candidate. Production approval remains closed.

The complete Build 340 source is tracked directly at the repository root. CI checks out and verifies this tree; normal builds do not reconstruct a prior archive or apply a source overlay. The content descends from the verified candidate ZIP cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9; the runtime source tree SHA-256 remains 0738fc96c4037c3d34a0b74a872d9ec5acf9ef07d509d667ee6d64024a5cc731.

Build 340 uses immutable Worker plans for simulation and air/sea and road routing; indexed procurement, disposal, finance and payroll batches; map read models; and bounded media decoding. The simulation, finance writes, fleet and route commits, persistence, authorization, and transaction owners remain on the serialized authoritative state boundary. This source does not activate the experimental field journal or modify Save Schema 2.0.0.

Direct-source CI run 36268965706 tested commit 976c9aef615b5dd30c0967d8a81b63d96c374fc2 and passed the 124/124 declared source gates, lint, browser checks, native storage and WKWebView checks, and a fresh unsigned arm64 iPhoneOS Release app build. CI created source-bound unsigned Build 340 test IPA GlobalHoldings_BUILD340_unsigned_TEST.ipa, 13366460 bytes, SHA-256 70d07e00279b12b8d9e487590b1d76ccd75386b07cc88052ecb5326914000b8f. No physical iPhone was tested. Node tests with synthetic 4,300/20,000 inputs do not establish iPhone performance.

The release gate remains closed until purchase, delivery, sale, routes, finance, save/restore, and long-session interaction pass on physical iPhones at 4,300 and 20,000 assets, including the agreed frame-time, touch-latency, memory, and thermal measurements.
