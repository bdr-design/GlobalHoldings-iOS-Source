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

- Name: `B315-A-GREEN-NativeFirst`
- SHA: `4469767448a52fb041cd7b5031a63ccddcef84c7`
- Proven gates:
  - Source Integrity PASS
  - Release metadata PASS
  - JavaScript syntax PASS
  - Swift/Native contract PASS
  - 109/109 repository tests PASS
  - Chromium PASS
  - WebKit PASS
  - E2E PASS
  - Failure scenarios PASS
  - Swift syntax/native runtime PASS
  - XcodeGen/project verification PASS
  - iPhoneOS Release build PASS
  - WebApp payload validation PASS
  - unsigned IPA packaging PASS
  - final IPA content validation PASS

### Current working state

- Name: `B315-B-YELLOW-ManualSlots`
- Baseline at continuity adoption: `c749120d624748507b0f67297b99c7139eba69e0`
- Status: **YELLOW — Native Manual Save Slots verification in progress**
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

## 5) Unverified / Pending before Manual Slots can become GREEN

Do not promote `B315-B-YELLOW-ManualSlots` to GREEN until the same candidate SHA passes:

1. Source Integrity
2. Release metadata
3. JavaScript syntax
4. Swift/Native contract guards
5. All repository guards
6. Native Save Slots executable regression (>4 MB, load, clear, reset, bootstrap freshness)
7. Chromium browser suites
8. WebKit browser suites
9. E2E
10. Failure scenarios
11. Swift parse/native runtime tests
12. XcodeGen/project verification
13. iPhoneOS Release build
14. Built WebApp exact-copy validation
15. unsigned IPA packaging
16. final IPA integrity validation

If any gate fails: keep YELLOW or mark RED depending on severity, fix root cause, regenerate integrity, and rerun the full required chain.

## 6) Next stage after Manual Slots GREEN

### `B315-D-YELLOW-Stress1000`

Real E2E scenario:

`UI → facility expansion → purchase 1000 assets → finance → delivery → fixed crew → ~16 shared road routes → Native save → simulated Native relaunch → compare assets/balances/routes/crew`

Required properties:
- deterministic/reproducible fixture where possible
- no duplicate financial debit
- no lost/duplicated assets
- route ownership and shared-fleet invariants remain valid
- crew counts remain consistent
- Native save/relaunch restores the same logical state
- performance/memory observations recorded

Also add the planned idempotency regression for `domain-command-core.js`:
- retry with the same idempotency key + same payload must not duplicate debit/assets
- same key + different payload must be rejected

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
