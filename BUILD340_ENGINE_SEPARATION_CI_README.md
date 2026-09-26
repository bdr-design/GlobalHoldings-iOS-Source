# Build 340 map asset query worker candidate

Branch: `build340-engine-separation-20260926`

- Clean source: Version `3.0.0`, Build `340`, Save Schema `2.0.0`.
- Candidate archive SHA-256: `b81585d50900c6caf8efa3901ed3c25a17236ea12b772967ea1a1e1f45417866`.
- Runtime source SHA-256: `c71617a61ca3a22e07560b04dd9488096f127a76a6a7e022ffc3e48b2f06eded`.
- CI reconstructs the exact archive, checks the source and package hashes, installs Chromium/WebKit, runs the declared acceptance suite, executes native save-vault and WebKit smoke checks, and builds an unsigned arm64 iPhoneOS Release app.
- The release gate stays closed. This worker handles map asset ownership filtering only; the workflow does not claim 20,000-asset iPhone performance or produce a production IPA.

The physical iPhone test still needs to cover the full 4,300/20,000 asset purchase, routes, finance, invoices, save/restore, and long-session interaction, with the agreed frame-time and touch-latency limits.
