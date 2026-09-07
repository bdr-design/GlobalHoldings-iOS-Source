# Global Holdings 2.9.0 — Build249 Final Clean Baseline

## الهدف
إغلاق آخر ملكيات دورة حياة اللعبة والحفظ خارج app.js بدون تغيير Save Schema 2.0.0، والحفاظ على Build248 domain ownership مع فصل التأسيس/reset/migration إلى نوى مستقلة.

## التغييرات
- إضافة `WebApp/game-lifecycle-core.js` ليكون المالك الوحيد لإنشاء snapshot نظيف وتهيئة المجموعة الجديدة.
- إضافة `WebApp/migration-core.js` ليكون المالك الأول لقراءة الحفظ المحلي، مفاتيح الحفظ القديمة، reset epoch، والتطبيع البنيوي الأساسي.
- `app.js` أصبح يفوض load/reset/founding بدل إنشاء Business State لهذه العمليات مباشرة.
- رفع Runtime/App إلى 2.9.0 وBuild إلى 249 مع إبقاء Save Schema 2.0.0.
- تحديث update builder إلى Full Web Clean Snapshot باسم Build249، دون تضمين أي مفتاح خاص.
- إضافة Guard دائم `final-clean-baseline-build249-test.js` واختبار وظيفي `game-lifecycle-migration-build249-test.js`.

## اختبارات الإقفال
- Non-browser guards: 89/89 PASS (بعد إضافة Final Clean Baseline guard).
- JavaScript syntax: 41/41 PASS.
- Swift parse: 4/4 PASS.
- Native contract: PASS.
- Simulation stress: PASS حتى 2000 أصل.
- Save Schema: 2.0.0.
- Browser QA: غير مثبت محليًا لأن Playwright/Chromium dependency لم تكن متاحة في بيئة العمل؛ GitHub CI يبقى بوابة المتصفح/Xcode النهائية.

## قواعد الحماية
- لا Overlay/Delta داخل المصدر النهائي.
- لا private Ed25519 signing key داخل المصدر.
- Full Source واحد ونظيف.
- كل تحديث داخلي يجب أن يبقى full-web + clean-snapshot + canonical operationsJSON + hashes + Ed25519.
- فشل أي invariant في update/save/domain transaction يعني رفض/rollback بدل partial commit.
