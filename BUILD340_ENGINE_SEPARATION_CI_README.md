# Build 340 engine separation candidate

Branch: `build340-engine-separation-20260926`

- Runtime: Version `3.0.0`, Build `340`, Save Schema `2.0.0`.
- The workflow reconstructs the hash-pinned Build 339-derived source archive, reconstructs and checks the base64-split Build 340 engine-separation overlay, applies it, then verifies the exact runtime and full source-package digests.
- Base archive SHA-256: `fb7a6885a254198bdad177c4ad696a925144a37941be691fe2bd9f2d82229629`.
- Overlay SHA-256: `805644e2487d6402599a1896660e51aa0717cf7a19140f9347cdb93b4a36eb0e`.
- Runtime source SHA-256 after overlay: `8db8634d642ed777808160222ab5bac2efad07c75116fa4f49adb6a0c9ed3974`.
- CI runs the 109 declared source gates, ESLint, Chromium/WebKit checks, native save-vault and WKWebView checks, and a fresh unsigned arm64 iPhoneOS Release build.

The update separates map query/presentation, finance read aggregation, road route planning and bounded image decoding. Simulation progression, financial and procurement writes, route commits, Leaflet DOM construction and native persistence remain under their existing state owners. CI run `36228574166` passed 109/109 gates, ESLint, Chromium/WebKit, native save-vault/WKWebView checks and the unsigned arm64 iPhoneOS Release build. The release gate remains closed until physical iPhone testing at 4,300/20,000 assets demonstrates the agreed frame-time and touch targets.
