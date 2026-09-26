# Global Holdings Build 334 — Verification Report

- Exact base Build 333 SHA-256: `29f0095fcc149c1af99f89871884bbe5c76106b91838e81749cdf8cdfa54359c`
- Build 334 IPA SHA-256: `4e5ce265e54770ac32d1f65ee215936bae33f7b4ec7e35ed8b7351c735c8546d`
- Bundle: `3.0.0 (334)`
- Save Schema: `2.0.0`
- IPA is a byte-exact canonical deterministic repack: yes
- Native contents and ZIP metadata preserved: yes
- WebApp exact source match: 468 / 468 files
- Build 333 source files missing: 0

## Passed gates

- Exact base identity, canonical ZIP structure, no prefix/trailer/comment, duplicate, normalized collision, symlink or special member.
- Native contents and ZIP metadata preserved; WebApp content and deterministic metadata match the reviewed source.
- Evidence hashes, screenshot dimensions, exact command argv/exit codes, non-empty result schemas and Build 333 upgrade input digest are bound to the final source.
- Save Schema 2.0.0, business state, custom identity, atomic finance, authorization, simulation time and browser regressions passed.

## External verification still required

The IPA remains unsigned and was not installed on a physical iPhone/WKWebView. Sign it with the user's certificate and perform the final device smoke test.
