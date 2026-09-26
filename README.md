# Global Holdings — Build 341 HOTPATH_FIX candidate

Version 3.0.0 · Build 341 · Save Schema 2.0.0. This is an experimental test candidate; production approval remains closed.

Build 341 follows the CI-verified Build 340 hot-path diagnostics branch. The supplied Build 340 diagnostic measured repeated authorization/document proof verification at up to 299 ms inside the final integrity gate, a 24 MB full snapshot at up to 124 ms, and financial day close at up to 92 ms. Build 341 safely caches successful checks for immutable verified proof records, uses copy-on-write for authorized changes, and captures nested financial day-close phases.

The complete source is tracked directly in Git. No IPA is used as a development source and no patch overlay is applied. Save Schema 2.0.0 and Full Snapshot rollback remain unchanged; the live field journal remains disabled. Build 341 must pass direct-source CI, then be manually tested on iPhone at 4,300 and 20,000 assets. The attached diagnostic covers 2,160 assets and does not prove performance at the larger loads.
