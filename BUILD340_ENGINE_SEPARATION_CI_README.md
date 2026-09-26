# Build 340 engine separation — direct-source verification

Branch: build340-hotpath-diagnostics-20260926
Tested commit: 976c9aef615b5dd30c0967d8a81b63d96c374fc2
Direct-source CI run: 36268965706 — SUCCESS

- Version: 3.0.0; Build: 340; Save Schema: 2.0.0.
- The workflow checks out the complete source tree from Git and verifies it in place. It does not reconstruct archives or apply overlays.
- Runtime tree SHA-256: 0738fc96c4037c3d34a0b74a872d9ec5acf9ef07d509d667ee6d64024a5cc731.
- Verified candidate ZIP that supplied the one-time source materialization: cfe2982624211a292ea5f520141848ca43f52b222ede6e07eab1bd82fb25c5c9.
- Newly exported direct-source package SHA-256: efb0a2e151edb45dd33422414ef12b58759388be4e6ea9d72d21814a51ba0456 (13760257 bytes; 762 files).
- CI passed 124/124 declared source gates, ESLint, Chromium/WebKit, native save-vault, native WKWebView, and a fresh unsigned arm64 iPhoneOS Release app build.
- Unsigned test IPA: GlobalHoldings_BUILD340_unsigned_TEST.ipa (13366460 bytes; SHA-256 70d07e00279b12b8d9e487590b1d76ccd75386b07cc88052ecb5326914000b8f).
- CI assembled a fresh unsigned, source-bound Build 340 test IPA. No physical iPhone pressure test was performed; the production gate remains closed.

The 4,300/20,000 asset Node tests are synthetic and do not prove iPhone responsiveness. Device performance, touch latency, thermal behavior, purchase/sale/finance/routes, and save/restore still require physical iPhone validation.
