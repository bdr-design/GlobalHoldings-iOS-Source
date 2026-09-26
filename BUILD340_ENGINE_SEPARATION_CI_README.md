# Build 340 engine separation candidate

Branch: `build340-engine-separation-20260926`

- Runtime: Version `3.0.0`, Build `340`, Save Schema `2.0.0`.
- The workflow reconstructs the hash-pinned Build 339-derived source archive, reconstructs and checks the base64-split Build 340 engine-separation overlay, applies it, then verifies the exact runtime and full source-package digests.
- Base archive SHA-256: `fb7a6885a254198bdad177c4ad696a925144a37941be691fe2bd9f2d82229629`.
- Overlay SHA-256: `9b6ed63c1ac5c56471a92a074a215296290ee9a2667feff240504261c87122ca`.
- Runtime source SHA-256 after overlay: `8db8634d642ed777808160222ab5bac2efad07c75116fa4f49adb6a0c9ed3974`.
- CI runs the 109 declared source gates, ESLint, Chromium/WebKit checks, native save-vault and WKWebView checks, and a fresh unsigned arm64 iPhoneOS Release build.

The update separates map query/presentation, finance read aggregation, road route planning and bounded image decoding. Simulation progression, financial and procurement writes, route commits, Leaflet DOM construction and native persistence remain under their existing state owners. The release gate remains closed until CI and physical iPhone testing at 4,300/20,000 assets demonstrates the agreed frame-time and touch targets.
