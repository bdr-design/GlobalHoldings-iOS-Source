# GlobalHoldings — Continuity & Checkpoint Record

> هذا الملف هو سجل الاستمرارية الرسمي للمشروع. لا يعتمد استئناف العمل على ذاكرة المحادثة وحدها.
> قبل أي تعديل في دردشة/جلسة جديدة: اقرأ هذا الملف، تحقق من HEAD، وقارن آخر GREEN مع HEAD الحالي.

## 1) قواعد الاستمرارية المعتمدة

1. **GitHub + هذا السجل + الأدلة** هي مصدر الحقيقة للاستمرار بين المحادثات.
2. لا يتم تعديل `main` ولا دمج PR إلا بطلب صريح.
3. آخر **GREEN Checkpoint** هو نقطة الرجوع الآمنة الوحيدة المعتمدة.
4. **YELLOW** يعني: تغييرات موجودة لكن التحقق الكامل لم يكتمل؛ لا تعامل كإصدار آمن.
5. **RED** يعني: Regression/فشل حرج معروف؛ يمنع البناء أو الاعتماد منه حتى تصحيح السبب.
6. كل تغيير كبير يعزل في مرحلة/Checkpoint مستقل قابل للمراجعة والرجوع.
7. كلمة **تم** لا تستخدم إلا وفق Definition of Done: اختبارات مناسبة للمخاطر + regression + failure paths + build/IPA عندما تكون ضمن النطاق.
8. عند اقتراب المحادثة من الطول غير العملي، يتم تحديث هذا الملف ثم تجهيز Chat Handoff مختصر.
9. في جلسة جديدة: لا تبدأ بالتعديل قبل مطابقة الفرع وHEAD ثم مراجعة Diff من آخر GREEN.
10. أي معلومات لا تزال غير مثبتة توضع صراحة تحت **Unverified / Pending**.

## 2) تسمية Checkpoints

الصيغة المفضلة:

`B<build>-<stage>-<COLOR>-<scope>`

أمثلة:
- `B315-A-GREEN-NativeFirst`
- `B315-B-YELLOW-ManualSlots`
- `B315-C-GREEN-ManualSlots`
- `B315-D-YELLOW-Stress1000`

## 3) الحالة الحالية

- Repository: `bdr-design/GlobalHoldings-iOS-Source`
- Working branch: `build315-root-integrity`
- Draft PR: `#12` — للتشغيل الآلي/المراجعة فقط، **ممنوع الدمج حاليًا**
- Build314 preserved reference: `build314-shared-fleet-routes-ipa`
- Build314 reference SHA: `e7894b22092f99f2a13b5301b13e26c455a11d38`

### Last GREEN

- Name: `B315-E-GREEN-OperationalRegressionAudit`
- SHA: `30bd7fc04be36da3ec9f28d39afbc028e11b1974`
- Checkpoint branch: `checkpoint-b315-e-green-operational`
- CI run: `35378935054` — **SUCCESS**
- Proven gates:
  - Source Integrity PASS — 345 files
  - Release metadata PASS — 3.0.0 / Build 314 / Save Schema 2.0.0
  - JavaScript syntax PASS
  - Swift/Native contract PASS
  - 110/110 active repository tests PASS
  - Procurement idempotency regression PASS
  - Chromium + WebKit browser suites PASS
  - Chromium + WebKit E2E PASS
  - Chromium + WebKit failure scenarios PASS
  - BUILD315 Stress1000 Chromium PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 418 ms; routing 1958 ms; save 4,037,723 bytes
  - BUILD315 Stress1000 WebKit PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 769 ms; routing 2584 ms; save 4,034,879 bytes
  - BUILD315 Operational Regression Chromium PASS — facility/purchase/sea-route rollback + button retry; 25 ships on 2 shared routes
  - BUILD315 Operational Regression WebKit PASS — facility/purchase/sea-route rollback + button retry; 25 ships on 2 shared routes
  - Stalled requestAnimationFrame regression PASS — large-purchase busy state no longer depends on a WebKit frame callback
  - Failed purchase request-ID rollback PASS — `MANUAL-ASSET` sequence remains inside the atomic transaction
  - Swift syntax PASS
  - BUILD312 native runtime inventory PASS
  - BUILD315 Native Save Vault manual slots PASS (>4MB, load promotion, clear, New Game clear, bootstrap freshness)
  - XcodeGen/project verification PASS
  - iPhoneOS Release build PASS
  - Native package contract PASS
  - Built WebApp exact-copy validation PASS — 84 files
  - unsigned IPA packaging PASS
  - final IPA integrity PASS
- Verified unsigned IPA: `GlobalHoldings_v3_0_0_build314_unsigned.ipa`
- IPA SHA-256: `7c8ccc607c2b1950a7bdb3da88b9137305f4aa23ba98339e4007def7901f2d8f`
- Previous GREEN retained: `B315-D-GREEN-Stress1000` → `21c2dcaecc895dcf1104ecb935d46d66a2e71305`
- Earlier rollback: `B315-C-GREEN-ManualSlots` → `96de035292db0d1794766da2fa83ef873426fd72`

### Current working state

- Name: `B315-E-GREEN-OperationalRegressionAudit`
- Baseline / tested SHA: `30bd7fc04be36da3ec9f28d39afbc028e11b1974`
- Status: **GREEN — no unverified production modification remains in this stage**
- The working branch may move after this record is committed; use the checkpoint branch above for the immutable tested rollback point.
- No merge to `main` and no merge of draft PR #12 has been performed.

## 4) Build315 work completed since Last GREEN — code present, not all yet promoted to GREEN

- Native Manual Save Slots: 3 independent native files with SHA256 and metadata.
- Native save/load/clear slot bridge + ACK pipeline.
- Native-first iOS behavior; browser retains legacy/local behavior outside Native bridge.
- Manual slot payload is not duplicated in localStorage on iOS.
- Save Slot UI now awaits the Native ACK before reporting success.
- New Game sends `clearManualSlots:true`.
- Manual-slot reset staging hardened to copy → verify all backups → delete originals.
- Successful reset finalizes staged backup deletion; failed/pending reset restores safely.
- Native bootstrap is refreshed after relevant vault mutations so future reloads do not use stale save/slot metadata.
- Tests added for native manual slots including a payload larger than 4 MB.
- Executable Swift/macOS Native Save Vault regression added and wired into CI.

## 4.1) Verification history

- Manual Save Slots were promoted to GREEN before Stress1000 and remain covered by the full current CI chain.
- Stress1000 was promoted in `B315-D-GREEN-Stress1000` and remains green in the current candidate.
- Operational audit first reproduced a real large-purchase UI deadlock: if `requestAnimationFrame` never returned, the purchase button remained disabled because the awaited frame was outside the protected lifecycle.
- The regression was made intentionally failing first in CI run `35378106891`.
- Production fix: large purchases use a bounded interactive-paint yield with timeout fallback inside the protected `try/finally` lifecycle, so WebKit frame suspension cannot leak the busy token.
- A second audit exposed that `MANUAL-ASSET` request IDs were allocated before the purchase transaction. The ID allocation was moved inside the atomic transaction so persistence failure rolls it back with the purchase.
- Full candidate `30bd7fc04be36da3ec9f28d39afbc028e11b1974` then passed the complete browser/native/Xcode/IPA verification chain in CI run `35378935054`.

## 5) Current GREEN evidence

`B315-E-GREEN-OperationalRegressionAudit` is the current rollback-safe checkpoint.

The exact tested candidate SHA is `30bd7fc04be36da3ec9f28d39afbc028e11b1974`. Do not move the GREEN label to a later SHA unless that later candidate itself completes the required verification chain.

The stage proves:
- Stress1000 complete path: `UI → facility expansion → purchase 1000 road assets → finance debit → delivery → 3000 fixed crew → 16 shared road routes → Native durable save → fresh browser context → Native bootstrap restore → exact logical-state comparison`
- Maritime shared routing: 25 ships commit to exactly 2 shared routes under route capacity 24, with valid route slots and scheduled departure staggering.
- Facility creation, maritime purchase and shared-route commits roll back cleanly when durable persistence fails, and the same UI buttons become retryable.
- Large-purchase UI no longer hangs when `requestAnimationFrame` stalls.
- Failed purchases do not consume the business request ID sequence.
- Procurement idempotency remains fail-closed for same-key/different-payload and exactly-once for same-key/same-payload.

## 6) Next stage

No unverified Build315 production change is open in this record. Before starting another feature or defect fix:
- re-read actual branch HEAD and compare it with `checkpoint-b315-e-green-operational`
- preserve Build314 and do not merge PR #12
- reproduce the next reported defect first, then add its regression before production changes
- keep the current GREEN checkpoint immutable

## 7) Chat Handoff template

When moving to a new conversation, provide:

- Repository + branch
- Last GREEN name + SHA
- Current HEAD + checkpoint color/name
- Commits/files changed since Last GREEN
- What is proven
- What is only implemented but unverified
- CI/Xcode/IPA status
- Open defects/risks
- Exact next action
- Explicit constraints: no main changes, no PR merge, preserve Build314

## 8) Resume Protocol

At the start of every new work session:

1. Read `PROJECT_CONTINUITY.md`.
2. Query the repository branch and obtain actual HEAD.
3. Compare Last GREEN SHA to actual HEAD.
4. Review unexpected files/commits before editing.
5. Read relevant code/tests directly; do not trust a stale chat summary over repository state.
6. Continue from the first unverified step.
7. Update this record at the next meaningful checkpoint or before chat handoff.

---
Adopted: 2026-09-18
Method: Continuity + GREEN/YELLOW/RED Checkpoints + evidence-based Definition of Done.
