# Global Holdings — Build 340 engine separation candidate

Version 3.0.0 · Build 340 · Save Schema 2.0.0. This is an experimental clean-source candidate. Production approval remains closed.

Build 340 introduces a dedicated Web Worker boundary for map asset ownership filtering. The worker receives compact numeric ownership indexes, returns stable source-row indexes, and cannot mutate saved state. The current map renderer keeps a tested synchronous fallback if Worker creation, loading, messaging, or response validation fails.

The simulation, finance, fleet, route, persistence, authorization, and transaction owners remain authoritative on the main serialized state boundary in this phase. This source does not activate the experimental field journal, modify Save Schema 2.0.0, change finance/route writes, or claim 20,000-asset iPhone acceptance.

Verify source with `python3 tools/verify_current_source.py`. Run the focused engine regression with `npm run test:build340`; run the existing suite with `npm test` under Node 24 or later. Browser, real WKWebView, fresh Xcode Release, and physical iPhone pressure gates remain pending.

The release gate is intentionally closed until full acceptance, iPhone responsiveness, 4,300/20,000-asset purchase-route-save-restore tests, and the agreed frame-time targets are demonstrated.
