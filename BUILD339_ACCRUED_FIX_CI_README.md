# Build 339 accrued-obligation repair candidate

This isolated branch reconstructs the Library source archive from `candidate-parts/` and verifies its exact SHA-256 before extraction.

- Archive SHA-256: `41c79d819a3b013c540606dd7b86e7e5cfa7f3cc704365e1567b443b63e45003`
- Runtime source SHA-256: `f47eca7a668f2c9b2ea3d41d1463033c11573e4530cc751a39dbd4cba9ec38b5`
- Version/build/schema: `3.0.0 / 339 / 2.0.0`
- CI: 103 declared acceptance tests, Chromium and WebKit, native storage/WKWebView checks, then an unsigned iPhoneOS Release IPA.

The workflow does not use an old IPA, does not merge this branch, and requires the source's production approval to remain closed.