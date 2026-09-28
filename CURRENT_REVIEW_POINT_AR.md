# Build 345 / 3.0.3 — time-conflict fix

Base source: `b2f74fae5ceaa126c8b6ecbb6ddc24ade0e24654`. Branch: `fix/build345-time-frame-root`.

The reviewed original Mobility module no longer replaces unchanged arrays/KPIs from map reads. Actual changes still invalidate prepared work; finance rollback remains enabled. Save Schema stays 2.0.0.

Source is committed before macOS checkout/build. The CI artifact records the exact tested commit, source fingerprints, test results and IPA hash. Production approval remains closed. Under-5-ms maximum and physical iPhone frame stability are NOT proven.
