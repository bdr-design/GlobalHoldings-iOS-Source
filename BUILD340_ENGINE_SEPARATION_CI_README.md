# Build 340 engine separation — direct-source verification

Branch: build340-engine-separation-20260926
Tested commit: 73234985380abf3321fb181ba81ba2dcc4967635
Direct-source CI run: 36247000333 — SUCCESS

- Version: 3.0.0; Build: 340; Save Schema: 2.0.0.
- The workflow checks out the complete source tree from Git and verifies it in place. It does not reconstruct archives or apply overlays.
- Runtime tree SHA-256: 7f74cc211b192d9dc05db6d11d81ac852205e1f5039e49c0eabbbe6e839df20f.
- Verified candidate ZIP that supplied the one-time source materialization: cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9.
- Newly exported direct-source package SHA-256: 8118cb906415d1746a628f75a78c5dc3153a6194fcb14d874818dd984d141d48 (13753253 bytes; 760 files).
- CI passed 123/123 declared source gates, ESLint, Chromium/WebKit, native save-vault, native WKWebView, and a fresh unsigned arm64 iPhoneOS Release app build.
- Unsigned test IPA: GlobalHoldings_BUILD340_unsigned_TEST.ipa (13364410 bytes; SHA-256 2a401f3936105849a44faf0d9b3196e29a8a6e9eebe7cebe6a417db3eac6219a).
- CI assembled a fresh unsigned, source-bound Build 340 test IPA. No physical iPhone pressure test was performed; the production gate remains closed.

The 4,300/20,000 asset Node tests are synthetic and do not prove iPhone responsiveness. Device performance, touch latency, thermal behavior, purchase/sale/finance/routes, and save/restore still require physical iPhone validation.
