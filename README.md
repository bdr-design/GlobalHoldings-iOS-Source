# Global Holdings — Build 340 engine separation candidate

Version 3.0.0 · Build 340 · Save Schema 2.0.0. This is an experimental clean-source candidate. Production approval remains closed.

The complete Build 340 source is tracked directly at the repository root. CI checks out and verifies this tree; normal builds do not reconstruct a prior archive or apply a source overlay. The content descends from the verified candidate ZIP cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9; the runtime source tree SHA-256 remains 8db8634d642ed777808160222ab5bac2efad07c75116fa4f49adb6a0c9ed3974.

Build 340 separates map asset queries and presentation, finance read aggregation, road route planning, and bounded media decoding. The simulation, finance writes, fleet and route commits, persistence, authorization, and transaction owners remain on the serialized authoritative state boundary. This source does not activate the experimental field journal or modify Save Schema 2.0.0.

Direct-source CI run 36232174407 tested commit bd6bbc25fe18529fe26c2723eeafe39f5e5b9463 and passed the 109 declared source gates, lint, browser checks, native storage and WKWebView checks, and a fresh unsigned arm64 iPhoneOS Release app build. This did not create an IPA or test a physical iPhone. Node tests with synthetic 4,300/20,000 inputs do not establish iPhone performance.

The release gate remains closed until purchase, delivery, sale, routes, finance, save/restore, and long-session interaction pass on physical iPhones at 4,300 and 20,000 assets, including the agreed frame-time, touch-latency, memory, and thermal measurements.
