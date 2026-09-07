# Global Holdings — Protective Integrity Firewall Build 241

الإصدار التسويقي: 2.3.8  
Build: 241  
Save Schema: 2.0.0 (بدون تغيير)

## الإصلاحات الحرجة
- Save Vault commit إلزامي ومتحقق منه قبل استبدال WebApp عند التحديث عبر الجسر.
- نجاح عمليات التحديث لم يعد يرسل من `finally`; الفشل ينتقل إلى Native ويطلب rollback.
- `pendingNativeUpdate` يبقى معلقًا حتى نجاح العمليات + حفظ الحالة الناتجة في Save Vault + Boot confirmation.
- Boot confirmation لا يعتمد التحديث قبل `updateStateCommittedVersion`.
- حزم التحديث الموقعة يجب أن تحمل `operationsJSON` canonical المطابق لـ `operationsSha256`; مسار `operations` غير الموقّع مرفوض.
- قناة Stable تقبل Signature Payload v2 فقط.
- Anti-downgrade: الإصدار الهدف يجب أن يكون أحدث من الإصدار الجاري؛ الاسترجاع يتم فقط من Native rollback.
- Update operations داخل Transaction مع whitelist وrollback عند فشل الحفظ.
- SHA-256 إلزامي لكل ملف و`filesIndexSha256` متحقق منه في WebApp validation.
- شراء الأصول أصبح Atomic حول الدفع/الدين/طلبات التسليم مع rollback عند الفشل.
- إزالة التوثيق المكرر لمسير رواتب يوم 27.
- Pending Deliveries لم تعد تُقص بسبب حد آخر 250 سجل؛ القص يطبق على السجلات المكتملة فقط.
- إعادة توجيه التسليم تراعي سعة القاعدة البديلة.
- Hard Reset يستخدم snapshot واسترجاع عند فشل التخزين/التهيئة.
- الحفظ الصريح يدعم fail-closed (`throwOnError`) مع فحص Save Schema وIntegrity critical.
- خيارات السرعة محصورة في 4 قيم: Pause, ×1, ×2, ×4.
- CFBundleVersion وCURRENT_PROJECT_VERSION موحدان على 241.

## حماية المستودع
- أزيلت حزم V238 الموقعة القديمة من `updates/` لأنها أصبحت stale بعد تعديل WebApp. يجب إعادة توليد حزمة الإصدار من CI بمفتاح Ed25519 الخاص؛ المفتاح غير موجود في المستودع ولا ينبغي إضافته.
- أضيف اختبار `protective-update-firewall-build241-test.js` لمنع رجوع الثغرات الحرجة.
- أضيف `package.json` يثبت Playwright لـ Browser QA عند تثبيت dev dependencies.

## التحقق
- `node --check` لجميع ملفات WebApp JavaScript: PASS.
- `swiftc -frontend -parse` لملفات Native المعدلة: PASS.
- اختبارات المستودع غير المعتمدة على Playwright: 59/59 PASS.
- Browser QA لم يُنفذ في بيئة العمل الحالية لعدم وجود Playwright مثبتًا محليًا؛ الاعتماد أصبح معلنًا في package.json.
