# Global Holdings 2.6.0 — Build246 — تقرير إقفال Clean Workspace Architecture

## الهدف
إعادة هيكلة هندسة الأقسام والخيارات بحيث تصبح واجهة اللعبة مطابقة لملكية مجالات الأعمال، مع تقليل ازدحام الهاتف ومنع عودة HR كوظيفة فرعية داخل Operations.

## هندسة المساحات المعتمدة
- العالم
- القيادة
- المجموعة
- العمليات
- الأفراد / HR
- المالية
- الحوكمة
- النظام

على iPhone، الشريط السفلي محصور في خمس وجهات فقط: العالم، القيادة، العمليات، المالية، المزيد. مساحة «المزيد» هي بوابة للمجموعة والأفراد والحوكمة والنظام.

## قواعد الملكية الوقائية
- HR Workspace مستقل ولا يملكه Operations.
- Operations يسمح فقط بوصلة سياقية إلى HR.
- كل Workspace مسجل في Panel Ownership.
- لا توجد حزمة .saneiupdate موقعة داخل Clean Source.
- لا يوجد Private Ed25519 key داخل المصدر؛ أداة التوقيع تقرأه من البيئة/ملف خارجي فقط.
- Save Schema ثابت 2.0.0.
- الإصدار 2.6.0 والبناء 246.

## التحقق المحلي النهائي
- Repository non-browser guard suite: PASS.
- JavaScript syntax: PASS — 24 ملف WebApp JavaScript.
- Swift parse: PASS — 4 ملفات Swift.
- Workspace Information Architecture guard: PASS.
- Navigation Architecture guard: PASS.
- Panel Ownership guard: PASS — 34 panel.
- HR Core / No Legacy HR Stack guards: PASS.
- Asset Acquisition / Delivery Destination / Request Single Path guards: PASS.
- Simulation atomicity/determinism/stress guards: PASS.
- Finance transaction/audit guards: PASS.
- Protective update firewall / canonical builder guards: PASS.
- Source integrity manifest: يعاد توليده بعد هذا التقرير ثم يتحقق Hash-by-Hash.

## ملاحظة Browser/Xcode
Playwright غير مثبت في بيئة العمل المحلية الحالية، لذلك Browser QA وXcode Release build يبقيان بوابة GitHub CI النهائية. لا يُدّعى نجاحهما محليًا.

## قاعدة الإصدار
هذه الحزمة Clean Source وليست Overlay. لا يجب وضع Full Source آخر بجانبها في المستودع عند البناء.
