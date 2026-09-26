# Build 340 map asset query worker candidate

Branch: `build340-engine-separation-20260926`

- Clean source: Version `3.0.0`, Build `340`, Save Schema `2.0.0`.
- Candidate archive SHA-256: `cd3a8fcf6967d3560954f2780746b39a178208c6d9ec03b14388e2a3177d536e`.
- Runtime source SHA-256: `d794261ef39c376af9bd96a4fac2c5dc49bf49af06e7e3b99b420f557441547f`.
- CI reconstructs the exact archive, checks the source and package hashes, installs Chromium/WebKit, runs the declared acceptance suite, executes native save-vault and WebKit smoke checks, and builds an unsigned arm64 iPhoneOS Release app.
- The release gate stays closed. This worker handles map asset ownership filtering only; the workflow does not claim 20,000-asset iPhone performance or produce a production IPA.

The physical iPhone test still needs to cover the full 4,300/20,000 asset purchase, routes, finance, invoices, save/restore, and long-session interaction, with the agreed frame-time and touch-latency limits.
