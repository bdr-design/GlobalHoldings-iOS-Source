# Build 339 accrued-obligation repair candidate

This isolated branch reconstructs the Library archive from candidate-parts/ and verifies its exact SHA-256 before extraction.

- Archive SHA-256: 41c79d819a3b013c540606dd7b86e7e5cfa7f3cc704365e1567b443b63e45003
- Runtime source SHA-256: f47eca7a668f2c9b2ea3d41d1463033c11573e4530cc751a39dbd4cba9ec38b5
- Version/build/schema: 3.0.0 / 339 / 2.0.0
- CI: all 103 declared source acceptance tests, Chromium and WebKit, native storage/WKWebView checks, then an unsigned iPhoneOS Release IPA.

The package ESLint config recognizes module but omits the matching Node require global used in simulation-core.js's CommonJS fallback. CI adds require as a read-only lint global temporarily in a disposable test copy; it does not turn off a rule or skip a test. The archive integrity manifest is checked against the clean source before and after acceptance. The IPA is built from the untouched extraction.

The workflow does not use an old IPA, does not merge this branch, and requires production approval to remain closed.
