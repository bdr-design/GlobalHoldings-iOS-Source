# Build 244 — Guardian Signal Refinement

هذا البناء لا يغير Save Schema 2.0.0 ولا منطق المالية/الأصول/المسارات/المحاكاة. هدفه خفض ضجيج مركز الرقابة دون إخفاء الإنذارات الحقيقية.

التغييرات:
1. Interaction validator لا يعتبر الزر المعطل مؤقتًا بسبب `aria-busy=true` أو `is-busy` عطلًا، مع استمرار كشف أي disabled غير مبرر.
2. Control Plane يدمج نفس invariant القادم من Diagnostics وIntegrity تحت fingerprint واحد، ويحفظ مصادر الأدلة بدل عدّه مرتين.
3. Department Core يمنح كل قسم أول cadence كامل من لحظة تفعيل النظام قبل اعتباره overdue؛ بعد المهلة تعود قواعد التأخر العادية.
4. Workflow post-check يقارن قبل/بعد ويسجل Warning فقط إذا ظهر تحذير جديد. الحالات الحرجة تبقى blocking حتى لو كانت سابقة، كإجراء وقائي.

العقود الثابتة:
- App version: 2.4.0
- Native build: 244
- Save Schema: 2.0.0
- لا إسكات لتحذير POWER_RESERVE_MARGIN_LOW؛ يتم فقط إزالة التكرار بين المحركات.
