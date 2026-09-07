# Build243 — GitHub iOS CI Integration

هذه الطبقة لا تغيّر منطق اللعبة أو Save Schema أو Native runtime. هدفها جعل مستودع GitHub بوابة تحقق أخيرة قبل إنشاء IPA غير موقّع.

## عقد المصدر

- الإصدار التشغيلي يبقى 2.4.0.
- رقم البناء يبقى 243.
- Save Schema يبقى 2.0.0.
- المصدر الكامل هو وحدة البناء، ولا يسمح للـCI بإصلاحه أو تعديله أثناء البناء.
- أي اختلاف في بصمات `SOURCE_INTEGRITY_SHA256.txt` يوقف البناء.

## وضعي المستودع المدعومان

1. مصدر مفكوك في جذر المستودع (`project.yml` + `BUILD`).
2. ملف أو أكثر باسم `GlobalHoldings_Full_Source_*.zip` في الجذر. في هذا الوضع يفحص الـworkflow محتويات الحزم ويختار أعلى BUILD صالح، ويرفض وجود تعادل غامض لأعلى BUILD.

## بوابات البناء

Source ZIP integrity → Source SHA-256 manifest → Metadata/Save Schema contract → JavaScript syntax → Native source contract → جميع اختبارات المستودع غير المتصفحية → Browser QA بواسطة Playwright/Chromium → Swift parse بواسطة Xcode toolchain → XcodeGen → iPhoneOS Release build حقيقي → مقارنة WebApp داخل .app بالمصدر ملفًا وبصمة → إنشاء IPA → مقارنة WebApp داخل IPA بالمصدر → نشر artifact.

إذا فشلت أي بوابة، لا ينشر IPA. كما يحاول workflow نشر ملفات التشخيص الموجودة في `build/ci` كـartifact منفصل عند الفشل.

## سياسة عدم الإضرار

الـCI لا يغيّر `WebApp/` أو `iOS/` أو `project.yml` ولا يشغّل migration على Save. هو verifier/builder فقط. الملفات المتولدة (`node_modules`, `build`, `GlobalHoldings.xcodeproj`) مؤقتة داخل GitHub runner ولا تصبح جزءًا من المصدر.
