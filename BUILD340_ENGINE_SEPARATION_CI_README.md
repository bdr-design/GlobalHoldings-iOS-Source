# Build 340 engine separation — direct-source verification

Branch: build340-engine-separation-20260926
Tested commit: bd6bbc25fe18529fe26c2723eeafe39f5e5b9463
Direct-source CI run: 36232174407 — SUCCESS

- Version: 3.0.0; Build: 340; Save Schema: 2.0.0.
- The workflow checks out the complete source tree from Git and verifies it in place. It does not reconstruct archives or apply overlays.
- Runtime tree SHA-256: 8db8634d642ed777808160222ab5bac2efad07c75116fa4f49adb6a0c9ed3974.
- Verified candidate ZIP that supplied the one-time source materialization: cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9.
- Newly exported direct-source package SHA-256: 13fc29fb9d99f099441a60ff801c4286279f1eb57805d177b335323aeaf2acac (13697715 bytes; 742 files).
- CI passed 109/109 declared source gates, ESLint, Chromium/WebKit, native save-vault, native WKWebView, and a fresh unsigned arm64 iPhoneOS Release app build.
- No IPA was built, and no physical iPhone pressure test was performed. The production gate remains closed.

The 4,300/20,000 asset Node tests are synthetic and do not prove iPhone responsiveness. Device performance, touch latency, thermal behavior, purchase/sale/finance/routes, and save/restore still require physical iPhone validation.
