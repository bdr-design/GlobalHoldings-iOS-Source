# Global Holdings 2.8.0 — Build248 Clean Runtime Ownership

## الهدف
Build248 ليس طبقة إضافية فوق Build247. هو تنظيف لحدود الملكية المتبقية في وقت التشغيل، مع الحفاظ على Save Schema 2.0.0 وClean Full Source.

## ما نُقل فعليًا
- نقل حساب اقتصاد قطاعي الطاقة والبنك من `advanced-core.js` إلى `economics-core.js` كطبقة Analytics مستقلة للقراءة والحساب.
- نقل نتائج Journal الخاصة بشرائح المحاكاة إلى Finance Core عبر `apply-simulation-journal` بدل تعديل `todayProfit` وsector/trip accruals والسيولة من `app.js`.
- نقل زيادة قيمة المجموعة الناتجة من المحاكاة إلى Corporate Core.
- نقل تنبيهات نتيجة الشريحة إلى Operations Core.
- نقل تحديث التصنيف الائتماني والسمعة من Realism إلى Corporate Core.
- نقل نضج برامج الاستدامة وحساب ESG من Realism إلى Governance Core.
- نقل اكتمال عقد Commissioning من Realism إلى Procurement Core، بينما القدرة نفسها تبقى Facilities-owned.
- نقل ربط Business Case بنتيجة دراسة AI من Realism إلى AI Executive Core.
- نقل مزامنة مؤشرات الاقتصاد من Realism إلى Market Core.

## حدود مسموحة باقية عمدًا
- Bootstrap/Migration/Reset في `app.js` يظل مسارًا خاصًا لبناء/استعادة Snapshot كامل، وليس مسار تشغيل أعمال يومي.
- Simulation Kernel يظل المالك الوحيد للزمن وحركة الأصل داخل الشريحة الذرية.
- Realism Core يملك فقط بياناته التحليلية `state.realism` ويقرأ بقية النطاقات؛ أي أثر تشغيلي خارج `state.realism` يمر إلى Domain Owner.

## الحماية
أضيف `tests/clean-runtime-ownership-build248-test.js` ويفشل عند رجوع أي من:
- `sectorEconomics` إلى Advanced/UI.
- كتابة Realism مباشرة إلى `profile.creditRating` أو `profile.reputation` أو درجات ESG.
- مزامنة `advanced.economy` مباشرة من Realism.
- تعليم Construction Contract مكتملًا من Realism.
- تعديل دراسة AI Request مباشرة من Realism.
- إعادة الكتابة المالية/قيمة المجموعة مباشرة داخل Simulation commit.

## التحقق المحلي
- Non-browser guard tests: 87/87 PASS.
- JavaScript syntax: 39/39 PASS.
- Swift parse: 4/4 PASS.
- Native contract guard: PASS.
- Simulation stress: PASS حتى 2000 أصل في مجموعة الاختبارات.
- Save Schema: 2.0.0.
- Browser QA: غير منفذ محليًا لأن Playwright غير مثبت في بيئة العمل؛ GitHub CI هو بوابة المتصفح.
- Xcode Release الحقيقي: يجب إثباته في GitHub Actions/macOS قبل اعتماد IPA.

## قاعدة الإصدار
Build248 Full Source هو المصدر الوحيد المقترح للبناء. لا تضع Build247 وBuild248 معًا في جذر مستودع CI.
