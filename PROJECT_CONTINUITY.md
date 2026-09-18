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

- Name: `B315-D-GREEN-Stress1000`
- SHA: `21c2dcaecc895dcf1104ecb935d46d66a2e71305`
- CI run: `35374508129` — **SUCCESS**
- Proven gates:
  - Source Integrity PASS — 344 files
  - Release metadata PASS — 3.0.0 / Build 314 / Save Schema 2.0.0
  - JavaScript syntax PASS
  - Swift/Native contract PASS
  - 110/110 active repository tests PASS
  - Procurement idempotency regression PASS
  - Chromium browser suites PASS
  - WebKit browser suites PASS
  - Chromium + WebKit E2E PASS
  - Chromium + WebKit failure scenarios PASS
  - BUILD315 Stress1000 Chromium PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 517 ms; routing 2231 ms; save 4,037,723 bytes
  - BUILD315 Stress1000 WebKit PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 1161 ms; routing 3105 ms; save 4,034,879 bytes
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
- IPA SHA-256: `c15b3f7b0a6683a39724d6b93020a8f746217b2ed964a35f486fc247d53e05ab`
- Previous GREEN retained: `B315-C-GREEN-ManualSlots` → `96de035292db0d1794766da2fa83ef873426fd72`
- Earlier rollback: `B315-A-GREEN-NativeFirst` → `4469767448a52fb041cd7b5031a63ccddcef84c7`

### Current working state

- Name: `B315-E-YELLOW-OperationalRegressionAudit`
- Baseline: `21c2dcaecc895dcf1104ecb935d46d66a2e71305`
- Status: **YELLOW — targeted audit of remaining runtime reliability paths before any new production modification**
- Scope:
  - non-air route assignment and shared-route commit paths
  - large-quantity purchasing and button-operation lock release paths
  - facility/base creation action completion and rollback paths
  - no production change until a reproducible failing path or invariant violation is proven
- The current branch must be re-read before resuming because HEAD may advance after this record is updated.

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

- CI run `35372324972` on candidate `c338e01f4c355869cbb02851fe46f857fd3fe43c` passed Source Integrity, release metadata, JavaScript syntax, repository guards, Chromium/WebKit browser suites, E2E and failure scenarios.
- It stopped at the Native Save Slots executable harness because the **test harness itself** used a throwing `revision(...)` call inside a non-throwing Swift autoclosure. Production Swift parsing had already passed and BUILD312 native runtime regression passed.
- The harness compile defect was corrected in commit `d568dcc632811c470332e154917ca10510e856ea` by evaluating the throwing revision parse before the assertion. This remains **YELLOW** until a fresh full CI/Xcode/IPA run passes from one candidate SHA.

## 5) Current GREEN evidence

`B315-D-GREEN-Stress1000` is the current rollback-safe checkpoint.

The exact tested candidate SHA is `21c2dcaecc895dcf1104ecb935d46d66a2e71305`. Do not move the GREEN label to a later SHA unless that later candidate itself completes the required verification chain.

Stress1000 proved the complete path:

`UI → facility expansion → purchase 1000 road assets → finance debit → delivery → 3000 fixed crew → 16 shared road routes → Native durable save → fresh browser context → Native bootstrap restore → exact logical-state comparison`

The procurement idempotency gate also proved:
- same idempotency key + same payload returns the committed result without another debit or duplicate assets/deliveries
- same idempotency key + different payload is rejected fail-closed

## 6) Next stage

### `B315-E-YELLOW-OperationalRegressionAudit`

Audit before modifying:
- reproduce any remaining non-air routing failure from the actual UI path
- reproduce any purchase/button lock after repeated or large operations
- verify every busy-button release occurs on success, validation failure, thrown error, provider failure, save failure, and cancellation
- trace base/facility creation through transaction commit → persistence → UI unlock
- add a failing regression first whenever a defect is reproducible
- keep production code unchanged when no invariant failure can be demonstrated

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
