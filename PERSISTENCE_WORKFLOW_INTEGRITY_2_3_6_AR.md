# Global Holdings 2.3.6 — Persistence & Workflow Integrity

- App/Content: `2.3.6`
- Native Build: `236`
- Save Schema: `2.0.0`
- Update mode: `clean-snapshot-v1`

## ما الجديد
- `persistence-core.js` أصبح المالك الوحيد لخانات الحفظ والتصدير داخل WebApp.
- كل خانة تُفحص ضد Save Schema 2.0.0 قبل الحفظ/التحميل.
- تحميل خانة ناجحة يزامن Native Save Vault قبل إعادة تشغيل WebView.
- الخانات القديمة الخام تبقى قابلة للقراءة بعد التحقق، ثم تُعرض ببيانات محاكاة موحدة.
- إزالة الاعتماد على ساعة الجهاز من معرفات المسارات العامة والمرافق التي تدخل state.
- Route Cache الجديد يستخدم `cachedAtSim` بدل تاريخ الجهاز، مع توافق قراءة الكاش القديم.
- السجلات التجارية الجديدة تستخدم سنة المحاكاة بدل سنة جهاز iPhone.
- CI يشغّل اختبارات Persistence وDeterministic State الجديدة.

## قواعد ثابتة
- Simulation Core هو المالك الوحيد للوقت.
- السرعة لا تغيّر منطق الأعمال.
- Save Schema يبقى 2.0.0.
- تحديثات WebApp كاملة ونظيفة فقط؛ Overlay/Delta غير مسموح.

---

