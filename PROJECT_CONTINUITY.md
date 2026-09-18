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

- Name: `B315-F-GREEN-FinalDeviceReadiness`
- SHA: `55de368a262c88ac76eefe60612e070fdb2eae3d`
- Checkpoint branch: `checkpoint-b315-f-green-device-readiness`
- CI run: `35382957560` — **SUCCESS**
- Proven gates:
  - Source Integrity PASS — 346 files
  - Release metadata PASS — 3.0.0 / Build 314 / Save Schema 2.0.0
  - JavaScript syntax PASS
  - Swift/Native contract PASS
  - 110/110 active repository tests PASS
  - Procurement idempotency regression PASS
  - Chromium + WebKit browser suites PASS
  - Chromium + WebKit E2E PASS
  - Chromium + WebKit failure scenarios PASS
  - BUILD315 Stress1000 Chromium PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 713 ms; routing 2546 ms; save 4,038,749 bytes
  - BUILD315 Stress1000 WebKit PASS — 1000 assets / 16 shared routes / 3000 fixed crew / Native save+relaunch exact; purchase 2290 ms; routing 4326 ms; save 4,034,879 bytes
  - BUILD315 Operational Regression Chromium PASS — facility/purchase/sea-route rollback + button retry; 25 ships on 2 shared routes
  - BUILD315 Operational Regression WebKit PASS — facility/purchase/sea-route rollback + button retry; 25 ships on 2 shared routes
  - BUILD315 Device Lifecycle Chromium PASS — background waits for Native durable/reset lifecycles; no competing revision; reset reload safe
  - BUILD315 Device Lifecycle WebKit PASS — background waits for Native durable/reset lifecycles; no competing revision; reset reload safe
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
- IPA SHA-256: `4bcb69cd9f835be66c9791742704cca1f0862ffe5d48546654fa9bb5eb6041c3`
- Previous GREEN retained: `B315-E-GREEN-OperationalRegressionAudit` → `30bd7fc04be36da3ec9f28d39afbc028e11b1974`
- Earlier rollback: `B315-D-GREEN-Stress1000` → `21c2dcaecc895dcf1104ecb935d46d66a2e71305`

### Current working state

- Name: `B315-G-YELLOW-ReleaseIdentity315`
- Baseline / rollback checkpoint: `B315-F-GREEN-FinalDeviceReadiness` → `55de368a262c88ac76eefe60612e070fdb2eae3d`
- Status: **YELLOW — release identity promoted from Build 314 to Build 315; full exact-SHA verification pending**
- Intended release identity:
  - App version: `3.0.0`
  - Native/Web runtime build: `315`
  - Save Schema: `2.0.0` unchanged
- Modified identity surfaces: root `BUILD`, `package.json`, `package-lock.json`, `project.yml`, `WebApp/app.js`, and the release identity regression.
- Build314 preserved reference remains immutable.
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
- Final Device Readiness added a failing-first background durability race regression. It proved that background persistence previously returned `background-save-rejected` if iOS backgrounded the app while a Native durable command was awaiting ACK.
- Production fix serializes `persistForBackground()` behind the in-flight durable command and coalesces the background request when that command already advanced the durable revision, avoiding a competing Native write.
- The lifecycle regression was extended through Native reset/New Game and exposed the same class of race across the reset lifecycle; background persistence now waits for Native reset settlement as well.
- Exact candidate `55de368a262c88ac76eefe60612e070fdb2eae3d` passed the full Chromium/WebKit/native/Xcode/iPhoneOS/IPA chain in CI run `35382957560`.

## 5) Current GREEN evidence

`B315-F-GREEN-FinalDeviceReadiness` is the current rollback-safe checkpoint.

The exact tested candidate SHA is `55de368a262c88ac76eefe60612e070fdb2eae3d`. Do not move the GREEN label to a later SHA unless that later candidate itself completes the required verification chain.

The stage proves:
- Stress1000 complete path remains green: `UI → facility expansion → purchase 1000 road assets → finance debit → delivery → 3000 fixed crew → 16 shared road routes → Native durable save → fresh browser context → Native bootstrap restore → exact logical-state comparison`
- Maritime shared routing and atomic rollback remain green on Chromium and WebKit.
- Large-purchase busy-state and failed-purchase request-ID fixes remain green.
- Backgrounding while a Native durable command is awaiting ACK no longer rejects or emits a competing save; it waits for settlement and coalesces when durability is already established.
- Backgrounding during Native reset/New Game is serialized behind the reset lifecycle and resumes from the committed reset state without an unsafe competing revision.
- Final iPhoneOS Release build, exact WebApp payload validation, unsigned IPA packaging and final IPA integrity all passed from the same tested SHA.

## 6) Next stage

### `B315-G-YELLOW-ReleaseIdentity315`

Release freeze work:
- promote the canonical build identity from `314` to `315` without changing app version `3.0.0` or Save Schema `2.0.0`
- require all release metadata surfaces and runtime badge to agree on Build315
- regenerate Source Integrity after the metadata change
- rerun the complete repository/browser/Swift/Xcode/iPhoneOS/IPA chain from one exact candidate SHA
- only after that exact candidate succeeds may Build315 release identity be promoted to GREEN
- signing and physical-device validation remain separate evidence gates and must not be claimed before they are actually performed

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
