## إضافة 2.3.0 — Information Architecture

طبقة التنقل أصبحت سبعة مجالات مالكة فقط. هذه إعادة تنظيم واجهات وليست إنشاء محركات أعمال جديدة. راجع `NAVIGATION_ARCHITECTURE_2_3_AR.md`.

# معمارية Global Holdings 2.2.4

## ملكية الأنظمة
1. `save-schema.js`: تطبيع/تحقق الجذر وحماية Save Schema 2.0.0.
2. `determinism-core.js`: RNG وsequence IDs القابلة للإعادة.
3. `diagnostics-core.js`: سجل تقني دائري محدود.
4. `transaction-core.js`: Snapshot / Validate / Commit / rollback in-place / PostCommit.
5. `simulation-core.js`: الزمن، backlog، exact boundaries، governor، watchdog.
6. `app.js`: منطق الأعمال فقط.
7. Native `GlobalSaveVault.swift`: الحفظ الدائم والاسترداد.
8. Native `GlobalGameStorage.swift`: runtime WebApp والتحديثات الموقعة.

## Atomic Slice
Draft -> Validate all live guards -> Commit state/assets/boundaries -> PostCommit side effects.
أي conflict أو exception = rollback كامل دون تقدم `simSeconds`.

## Recovery
أي فرق بين `lastFinancialDay/lastMarketHour` والزمن الحالي يوضع في Recovery Queue. تتم معالجة حد واحد متسلسلًا في كل دورة، ولا يسمح بتقديم الزمن حتى اكتمال الاسترداد. الفشل يوقف السرعة.

## Native Save Vault
A/B envelopes، كل envelope يحمل generation/schema/simSeconds/SHA-256/payload. يتم اختيار أعلى generation صالح. الكتابة تستخدم Foundation atomic write.

## Update Trust
manifest يوقع Ed25519 على معرف الحزمة والإصدار وعدد/حجم الملفات وبصمة فهرس الملفات وبصمة operations. Native يتحقق بالمفتاح العام المثبت داخل IPA قبل staging/apply.

## الإصدار
- App/content: 2.2.4
- Native build: 224
- Save Schema: 2.0.0
