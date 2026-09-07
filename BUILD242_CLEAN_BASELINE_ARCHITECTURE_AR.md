# Global Holdings 2.3.9 — Build 242 Atomic Clean Baseline

## حالة الاعتماد
هذا المستودع هو إعادة تأسيس Clean Baseline، وليس طبقة ترقيعات فوق Build241. بقي Save Schema عند `2.0.0` للحفاظ على توافق الحفظ، بينما رُفع Runtime إلى `2.3.9` وBuild إلى `242`.

لا توجد في المستودع حزمة تحديث موقعة قديمة، ولا مفتاح توقيع خاص. توليد `.saneiupdate` الموقّع يجب أن يتم من CI/بيئة الإصدار بالمفتاح الحقيقي فقط بعد نجاح البناء.

## العقود غير القابلة للكسر
1. Simulation Core هو المالك الوحيد لـ `simSeconds`.
2. كل Simulation Slice معاملة Atomic؛ إما Commit كامل أو Rollback كامل.
3. التحديثات `full-web + clean-snapshot-v1` فقط؛ Overlay/Delta وoperations-only مرفوضة.
4. كل ملف تحديث يجب أن يطابق SHA-256 والفهرس canonical والتوقيع Ed25519 v2.
5. لا downgrade عبر installer؛ الرجوع يتم من Native rollback فقط.
6. Runtime + Save Generation زوج واحد عند التحديث والاسترجاع.
7. Save Schema يبقى 2.0.0، مع `saveRevision` monotonic للحكم على حداثة الحفظ دون الاعتماد على زمن اللعبة.
8. العمليات المالية يجب أن تسجل Journal متوازن Debit = Credit.
9. AI يغيّر Business State على Simulation Time فقط؛ wall-clock للـdiagnostics/metadata فقط.
10. القرار الرأسمالي الكبير يحتاج تفويضًا أو خطة سنوية معتمدة؛ AI يعيد التحقق من التفويض عند التنفيذ، وليس عند الاقتراح فقط.

## Update / Save State Machine

### قبل أي تبديل ملفات
- يلتقط Native أحدث Save متاح.
- يثبته في Save Vault ويتحقق منه.
- يكتب Update Journal بمرحلة `PREPARED` قبل تغيير runtime.
- ينشئ Rollback Checkpoint مستقلًا مرتبطًا بالنسخة السابقة قبل staging/swap.

### تثبيت الملفات
- تحقق package type/install mode.
- تحقق signature payload v2.
- تحقق `filesIndexSha256`, `operationsSha256`, SHA لكل ملف، الحجم، وعدم duplicate/path traversal.
- staging نظيف وفحص read-back.
- `STAGED` ثم `SWAP_STARTED` يكتبان قبل العمليات الخطرة.
- تبديل Current/Previous ثم `RUNTIME_SWAPPED`.

### اعتماد النسخة الجديدة
- Boot وOperations مساران منفصلان.
- Operations تطبق Atomic وتُحفظ في Native Vault.
- Native يسجل `STATE_COMMITTED` مع generation الناتج.
- Bootstrap يرسل Boot confirmation.
- لا Final Commit إلا إذا اجتمعت `stateCommitted + bootConfirmed + verified save generation`.
- مرحلة `COMMITTED` نفسها commit marker؛ crash بعدها لا يعيد نسخة ناجحة بالخطأ.

### الفشل والاسترجاع
- أي خطأ قبل COMMITTED يعيد WebApp السابق مع Rollback Save Checkpoint المطابق له.
- لا يعتمد rollback على آخر جيلين A/B فقط، لأن autosave قد يدور بينهما أثناء تحديث طويل.
- الاسترجاع اليدوي يحفظ النسخة الحالية أولًا حتى يمكن التبديل ذهابًا وإيابًا كأزواج Runtime+Save سليمة.

## Save durability
- `saveRevision` يزيد عند كل persist ناجح في WebApp.
- Native Vault envelope يحمل revision/runtime version/hash/generation/reset epoch.
- عند WebContent termination، Native لا يحقن Save أقدم فوق localStorage أحدث: reset epoch أولًا، ثم saveRevision، ثم simSeconds كـtie-breaker legacy.
- Native يرسل `gh-native-save-ack` لكل commit request.
- عمليات update/reset الحرجة تستخدم Native commit صريحًا قبل الانتقال في lifecycle.

## Simulation
- Transaction Core يمنع nested transaction غير المنضبط.
- Context/asset conflict guards تمنع commit على state تغير أثناء draft.
- Hour/day boundaries تتم داخل نفس transaction.
- السرعات المعتمدة: Pause / x1 / x2 / x4.
- نتيجة الأعمال لا تتفرع بحسب user speed؛ الاختبارات تتحقق من cross-speed determinism.

## Finance Single Source of Truth

### Journal
كل حركة مالية حرجة تنتج Journal متوازنًا. شملت إعادة الهيكلة:
- إيراد/مصروف invoice مدفوع أو مستحق.
- تحصيل AR وسداد AP/الشيكات.
- VAT settlement كإطفاء التزام، وليس مصروفًا جديدًا.
- تسهيلات بنك المجموعة والقروض.
- Bonds / IPO / capital movements.
- Cash sweep بين الشركة وبنك المجموعة.
- التحويلات بين شركات المجموعة بقيود related-party مقابلة.
- عجز الإقفال اليومي ورواتب غير مدفوعة كاستحقاق Expense/AP بدل ذمة بلا قيد.

### Invoices وTreasury Ledger
- الفاتورة غير المسددة تسجل `accrual-document` ولا تتظاهر بحركة نقد.
- التحصيل/السداد اللاحق هو الذي يولد cash movement.
- رسوم ترتيب تسهيل بنك المجموعة تظهر كدخل مستحق للبنك ومصروف/التزام مقابل للمقترض.

### الرحلات
- لا فاتورة لكل رحلة ثم فاتورة يومية ثانية لنفس الإيراد.
- الرحلات تجمع Settlement يومي قابل للتوسع: revenue + fuel + maintenance، ثم توثيق واحد لكل شركة/يوم.
- `tripRevenueAccrued` و`tripProfit` مؤشرات تشغيلية، وليسا مصادر محاسبية مستقلة مضاعفة.

### VAT
- فصل `output`, `input`, `creditCarry`, وبدايات الفترة.
- الفترة الشهرية تحسب Delta لا liability تراكمي مكرر.
- Input VAT credit لا يختفي عند تجاوز Output VAT؛ يُرحّل.
- `taxPayable` مشتق من الفترات المستحقة المفتوحة.
- دفع الضريبة يقفل الفترات ولا ينشئ Expense جديدًا.

### Budgets
- spent + reserved لا يتجاوز limit أو line limit.
- Procurement/supplier payments تستهلك budget line.
- الشيكات تحجز الميزانية ثم تحول الحجز إلى spent عند الصرف.
- AP settlement يحترم الحجز أو budget availability.

## Procurement / Assets / Deliveries
- شراء 1–50 أصل Atomic داخل Transaction واحدة.
- Payment + Debt + Delivery records + Budget داخل نفس state transaction.
- لا خصم إذا deliveries core غير متاح.
- Capacity يحسب الأصول الحالية + pending deliveries.
- Pending deliveries لا تُحذف بسبب حد أرشفة.
- البيع لا يتم أثناء الرحلة؛ الأصل يعود إلى مركز مملوك قبل final sale عند الحاجة.
- أمر المغادرة الجماعي يحرك كل الأصول المؤهلة على المسار، لا أول أصل فقط.

## AI كعامل رئيسي
- مراجعة AI تتم كل ساعة Simulation، لا حسب مدة فتح الشاشة الحقيقية.
- AI يراجع: التمويل، السيولة، الأسطول، السعة، القواعد والمراكز، القوى العاملة، التبعيات، المخاطر، routes، procurement readiness.
- Asset Request Center هو نقطة الدخول الموحدة: حاجة → دراسة AI → تفويض → تمويل → شراء → تسليم → staffing/readiness → closure.
- AI يمكنه تنفيذ الأعمال التشغيلية وسد staffing gaps وتتبع التبعيات.
- الشراء/التوسع الرأسمالي لا ينفذ إلا بتفويض صالح أو Annual Plan معتمد، ويعاد التحقق من master authorization والميزانية وقت التنفيذ.
- عند فقد التفويض يعود الطلب إلى awaiting authorization بدل تجاوز المستخدم.

## Audit Archive
- السجلات المالية لم تعد تُحذف بصمت عند تجاوز array limits.
- Active records تبقى محدودة للأداء؛ القديم ينتقل إلى `finance.auditArchive.records`.
- عند تضخم الأرشيف جدًا يتحول الأقدم إلى digest رقابي يحمل count/total/time range/ids/checksum بدل الاختفاء.
- Tax periods لا تقص مباشرة قبل وصولها إلى archive compactor.
- Save Schema وIntegrity Core يتحققان من بنية audit archive/digests.

## Validation في هذه البيئة
نجح محليًا:
- 70/70 repository tests غير Browser QA.
- JavaScript syntax لجميع WebApp/tests.
- Swift frontend parse لجميع ملفات Swift الأربعة.
- Native/Swift source contract guard.
- Python compile لجميع scripts.
- GitHub Actions YAML parse.
- Version consistency: Runtime 2.3.9 / Build242 / Save Schema 2.0.0.
- Release hygiene: لا stale update packages، لا private signing keys، لا build/cache directories.
- SOURCE_INTEGRITY_SHA256 يغطي ملفات المصدر.

### ما لم يمكن تشغيله محليًا
البيئة الحالية ليست macOS/Xcode ولا تحتوي Chromium/Playwright مسبقًا. محاولة تثبيت Playwright محليًا انتهت بمهلة الشبكة، لذلك لم يتم الادعاء بأن Browser QA أو `xcodebuild` عُملا هنا.

لكن CI على `macos-15` أصبح يفرض بالترتيب:
1. كل JS/source guards/tests تلقائيًا.
2. Browser QA عبر Playwright Chromium.
3. XcodeGen.
4. `xcodebuild` Release iphoneos بدون توقيع.
5. فحص App bundle وInfo.plist version/build/device family.
6. توليد unsigned IPA فقط بعد النجاح.

## الأساس الهندسي الخارجي للدراسة
- Apple Foundation atomic writes: الكتابة الذرية تستخدم ملفًا مساعدًا ثم استبدال الهدف، وهو الأساس المستخدم في ملفات journal/checkpoint.
  https://developer.apple.com/documentation/foundation/data/writingoptions/atomic
- Apple WebKit: Web Content Process عملية منفصلة ويمكن إنهاؤها، لذلك لا يجوز اعتبار localStorage وNative Vault transaction واحدة تلقائيًا.
  https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:)
- SQLite Atomic Commit: journal-before-mutation وcommit marker/rollback recovery أساس مهم لتصميم crash consistency متعدد المراحل.
  https://www.sqlite.org/atomiccommit.html
- The Update Framework: rollback/mix-and-match/key-compromise نماذج تهديد معروفة لأن التوقيع وحده لا يكفي لنظام تحديث آمن.
  https://theupdateframework.github.io/specification/latest/

## قاعدة الإصدار المستقبلية
أي تحديث مستقبلي يفشل إذا غيّر أحد العقود السابقة. لا يُعتمد بناء جديد لمجرد أن UI يفتح؛ يجب أن يمر Source Guards + Fault Contracts + Browser QA + Xcode Build، ولا تُستخدم حزمة توقيع قديمة بعد تعديل المصدر.
