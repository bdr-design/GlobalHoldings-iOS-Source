# Global Holdings 2.9.0 — Build250 CI/E2E Hardened Baseline

## الهدف
هذا البناء لا يضيف طبقة أعمال جديدة فوق Build249. الغرض هو إقفال طبقة البناء والإثبات قبل iPhone: توافق GitHub Actions مع macOS Bash 3.2، تحسين تشخيص Xcode، تثبيت Browser QA على هندسة Workspaces الحالية، وتنظيف المصدر من نواتج البناء المؤقتة.

## التغييرات
- Build number: 250، مع بقاء MARKETING_VERSION = 2.9.0.
- Save Schema ثابت 2.0.0.
- إزالة mapfile/readarray من workflow واستخدام ملفات قوائم + while IFS=read لضمان Bash 3.2.
- xcodebuild يحفظ سجله كاملًا ويحتفظ بكود خروجه الحقيقي ويعرض أسطر compiler error عند الفشل.
- Browser QA يختبر Operations → Assets وLeadership → Intelligence وفق Information Architecture الحالية.
- Required-source gate توسع ليشمل جميع Domain Cores الجديدة، Game Lifecycle وMigration.
- إزالة node_modules و__pycache__ وأي نواتج بناء محلية من Clean Source.
- Guard جديد ci-e2e-hardening-build250-test.js يمنع رجوع هذه الأخطاء.

## التحقق المحلي
- 90/90 non-browser repository guards: PASS.
- JavaScript syntax لكل WebApp JS: PASS.
- Swift parse: PASS.
- Native contract guard: PASS.
- Simulation stress حتى 2000 أصل: PASS ضمن مجموعة الاختبارات.
- Playwright package/browser لم يمكن تنزيلهما محليًا بسبب عدم توفر الشبكة الخارجية في بيئة العمل؛ لذلك Browser QA الكامل يبقى بوابة GitHub macOS.
- Xcode/iPhoneOS Release لا يمكن تشغيله على بيئة Linux المحلية؛ workflow مجهز ليكون بوابة الإثبات ويصدر diagnostics مفيدة عند الفشل.

## ما لا ندعيه
لا ندعي نجاح Xcode Release أو اختبار iPhone الحي قبل تنفيذ GitHub Actions وتشغيل IPA على الجهاز. هذه نتائج لا يمكن محاكاتها بصدق في البيئة المحلية.
