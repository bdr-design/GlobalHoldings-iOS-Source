# Global Holdings 2.4.0 / Build 243 — Central Control & Integrity Plane

## الهدف
هذا الإصدار يبني طبقة تحكم وسلامة مركزية فوق **Build242 Atomic Clean Baseline** من دون استبدال محركات المجال الموثوقة أو كسر Save Schema `2.0.0`. الفكرة الأساسية هي **Central authority, distributed expertise**: كل مجال يظل مالك قواعده، بينما المرور بين المجالات، التدقيق، الـcorrelation، الحوادث، الصحة والتصدير تتم عبر Control Plane واحد.

## المبادئ المعمارية
- **Command / Query Separation:** الأوامر التي تغيّر حقيقة اللعبة تعامل كأوامر ذات معنى، بينما القراءة والعرض تبقى عبر projections/queries خفيفة.
- **Domain ownership:** Simulation يملك الزمن، Finance يملك القيود والحركات المالية، Procurement يملك دورة الطلب، Native Update Coordinator يملك تبديل Runtime، Save Vault يملك الحفظ الدائم، وAI يملك التحليل/الاقتراح ضمن التفويض.
- **Atomicity first:** Control Plane لا ينفذ rollback شكليًا. الأوامر الذرية تستند إلى `GH_TRANSACTION_CORE`، وفحص السلامة الحرج يسجل كـcritical post-commit داخل نفس transaction بحيث أي invariant مكسور يعيد snapshot فعليًا.
- **Event journal + snapshots:** الحالة الحالية تظل canonical state، ويضاف سجل مركزي محدود ومحمي بسلسلة SHA-256 بدل تحويل اللعبة إلى Event Sourcing كامل عالي المخاطر.
- **Transactional outbox semantics:** حدث نجاح الأمر يدخل Outbox ويُسلّم idempotently، وتُستأنف العناصر غير المسلمة بعد boot.
- **Runtime verification:** الأخطاء القطعية تثبتها invariants، بينما AI يستخدم للتفسير والتشخيص وليس لإعلان الحقيقة من دون دليل.
- **No self-modifying production code:** AI لا يكتب patches داخل runtime ولا يعدل state مباشرة. أي إصلاح مستقبلي يجب أن يمر عبر Repair Plan مع preconditions/validation/rollback.

## المحركات المركزية
`WebApp/control-plane-core.js` يوفر:
- Command IDs: `CMD-*`
- Central events: `CPE-*`
- Incidents: `INC-*`
- Outbox: `OUT-*`
- `correlationId` و`causationId`
- Engine Registry
- Dependency Contracts
- Health Model
- Black Box ring buffer
- Tamper-evident SHA-256 journal chain
- Central exports
- DOM interaction observation
- Bridge/update/save evidence ingestion

## مسار الأمر
1. Admission + Command ID.
2. optimistic revision check عند طلبه.
3. authorization/validation.
4. Domain handler داخل Transaction Core عندما يكون synchronous/atomic.
5. Save Schema + Business Integrity كـcritical post-commit.
6. rollback حقيقي إذا فشل invariant.
7. commit central revision.
8. append `COMMAND_COMMITTED`.
9. enqueue + dispatch Outbox idempotently.
10. حفظ الحالة بالطريقة التي يملكها الـdomain/Save flow.

الأوامر async مثل Native/update/save bridges لا تمسك transaction JavaScript مفتوحة أثناء انتظار Native؛ تستخدم prepare/commit/failure evidence وتبقى آلية rollback الدائمة في Native Update Coordinator / Save Vault.

## ربط Business Event Ledger
`event-ledger-core.js` يرسل كل Business Event إلى Control Plane كـ`DOMAIN_*` evidence. أحداث Control Plane تحمل `controlEventId` حتى لا تعود إلى نفسها ولا يحدث recursion. بهذا تحتفظ المحركات القديمة بملكيتها، بينما يحصل المركز على خط زمني موحد.

## AI
AI عنصر رئيسي لكنه supervised:
- دورة AI الساعية تدخل Control Plane باسم `AI_HOURLY_EXECUTIVE_CYCLE`.
- AI يستطيع الدراسة، الاقتراح، بناء desired business state، ومتابعة الطلبات.
- الإنفاق/الشراء/التمويل الجوهري يظل تحت authorization أو خطة معتمدة.
- AI لا يغير Cash/Assets/Tax/Save مباشرة.
- Guardian/Diagnostic AI يفسر evidence؛ invariants هي التي تثبت العطل.

## التحديثات
Native يرسل lifecycle إلى Control Plane:
- `PRE_SAVE_COMMITTED`
- `RUNTIME_SWAPPED`
- `OPERATIONS_STARTED`
- `STATE_COMMITTED`
- `BOOT_CONFIRMED`
- `FINALIZED`
- `ROLLBACK_STARTED`
- `ROLLED_BACK`
- `FAILED` / `BOOT_CONFIRM_FAILED`

هذا لا يغير حماية Build242: Runtime + Save checkpoint ما زالا زوجًا واحدًا، والـfinalize لا يحدث إلا بعد state commit + boot confirmation.

## الحفظ
- WebApp يسجل `SAVE_REQUEST`.
- Native Save Vault يرسل `gh-native-save-ack`.
- النجاح يسجل evidence ويستطيع إغلاق حادثة Save سابقة فقط بعد ACK حقيقي.
- الفشل يفتح Incident مستقل ولا يتم إخفاؤه بواسطة health auto-resolution.
- `saveRevision` يبقى الحارس الرتيب لحداثة الحفظ، وليس `simSeconds`.

## Incident lifecycle
الحوادث نوعان:
- **autoManaged:** منشؤها deterministic health check؛ تغلق آليًا فقط عندما يختفي fingerprint من فحص لاحق.
- **manual/evidence incidents:** مثل Native save failure أو update failure؛ لا يغلقها check العام تلقائيًا.

## مركز التحكم والسلامة
قسم `controlPlane` داخل النظام يعرض:
- الحالة العامة.
- المحركات المسجلة.
- عقود الربط.
- revision/commands/outbox/events.
- الحوادث المفتوحة.
- آخر الأوامر والـBlack Box.
- تصدير الحوادث والتشخيص والصحة والتتبع والدعم.

## صيغ التصدير
Native exporter يحافظ على الامتدادات التالية ولا يضيف `.ghdiag` فوقها:
- `.ghincident`
- `.ghdiagnostic`
- `.ghtrace`
- `.ghhealth`
- `.ghsupport`
- `.ghdiag` للتوافق القديم

كل export يحمل نسخة التطبيق، نسخة Control Plane، Save Schema، state/control revision، `saveRevision`، `simSeconds`، journal head hash، health/evidence بحسب النوع.

## Save Schema 2.0.0
لم يتم رفع Save Schema. تم توسيع validation اختياريًا عند وجود `controlPlane` ليتحقق من:
- schema shape.
- sequences/revisions.
- arrays/registry.
- duplicate IDs.
- SHA-256 fields.
- undelivered outbox references.

الحفظ القديم الذي لا يحتوي Control Plane يبقى قابلاً للتحميل؛ `bootstrap()` ينشئ البنية الجديدة تلقائيًا.

## حدود متعمدة لحماية الاستقرار
- لا يوجد Proxy شامل لكل property في `state`؛ فرض ذلك دفعة واحدة على legacy runtime سيعرّض Build242 لانكسارات واسعة وغير قابلة للتنبؤ.
- بدل ذلك: الأوامر المتقدمة تمر Command Plane، كل UI intent يُراقب، Business Events تُبتلع مركزيًا، AI/Simulation maintenance/Native Save/Update تدخل السجل، والمحركات الذرية القديمة تبقى ملاك الحالة.
- أي نقل إضافي لمسارات legacy direct mutation إلى central commands يجب أن يتم domain-by-domain مع اختبار contract لكل مجموعة، لا mass-rewrite.

هذه الحدود ليست نقصًا مخفيًا؛ هي قرار سلامة لمنع خسارة العمل السابق مع الانتقال إلى سلطة مركزية تدريجية قابلة للاختبار.

## المرجع الفكري
التصميم يستفيد من مبادئ CQRS/Event Sourcing بصورة هجينة، Transactional Outbox وidempotent consumers، SRE health/observability، runtime verification، control-plane/controller patterns، crash-consistent journaling، وأنظمة تحديث موقعة ذات anti-rollback. لا يُطبق أي نمط بشكل حرفي إذا كان سيضيف تعقيدًا أكبر من فائدته داخل لعبة WKWebView محلية.

## العقود غير القابلة للكسر
1. Simulation Core وحده يقدّم `simSeconds`.
2. لا Nested state transactions.
3. لا نجاح حساس من دون validation مناسب.
4. AI لا يكتب state المالي/الرأسمالي مباشرة.
5. Runtime rollback يعيد Save checkpoint المطابق.
6. Save Schema يبقى `2.0.0` في Build243.
7. Signed updates تبقى `full-web + clean-snapshot-v1` فقط.
8. لا مفاتيح توقيع خاصة داخل المصدر.
9. Central health لا يصلح بيانات مالية/أصول تلقائيًا بلا repair contract حتمي.
10. كل توسعة مستقبلية للمحرك المركزي يجب أن تضيف اختبار regression قبل سحب المسار القديم.
