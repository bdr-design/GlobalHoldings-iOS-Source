# Global Holdings 2.5.0 — Build245
## إعادة بناء HR واقتناء الأصول من الصفر داخل النطاق التشغيلي

### الهدف
استبدال مساري القوى العاملة وطلبات الأصول القديمين بمصدر قرار واحد لكل نطاق، دون تشغيل نظام قديم بالتوازي ودون تغيير Save Schema 2.0.0.

### HR Core 2.5
- أضيف `WebApp/hr-core.js` كمالك وحيد لحساب الاحتياج والتوظيف والعقود ومراجعة AI.
- حُذف من `app.js` منطق `AI_CREW_STANDARDS` و`FACILITY_STAFF_STANDARDS` القديم كمصادر قرار.
- تم إصلاح علة حسابية قديمة كانت تتعامل مع أرقام احتياج الطاقم ككائنات `.needed/.have` وقد تجعل العجز يظهر صفرًا.
- التنفيذ مفصول إلى scopes: crew / facility / executive / all لمنع التوظيف الجانبي غير المقصود.
- المنشآت غير المملوكة لا تدخل في احتياج HR.
- واجهة القوى العاملة القديمة استُبدلت بإدارة HR: لوحة HR، الوظائف والاحتياج، الاستقطاب، العقود، الرواتب، وAI للموارد البشرية.
- AI لا يوظف مباشرة قبل التفويض؛ يرفع requisition مبنيًا على snapshot، وبعد التنفيذ يتحقق من before/after coverage.

### Asset Acquisition Core 2.5
- `request-core.js` أعيد بناؤه كمسار اقتناء واحد: دراسة → اعتماد → شراء → تسليم → جاهزية → إغلاق.
- أي `p.requests` قديم يُهاجر مرة واحدة إلى `assetRequests` ثم يُفرغ، ولا يبقى مسار تنفيذ قديم موازٍ.
- وجهة التسليم (`baseId`) عقد ثابت؛ أزيل silent rebase إلى قاعدة بديلة.
- بعد `buyAsset` يجب أن يساوي عدد أوامر التسليم الكمية المطلوبة، وأن تتطابق `requestRef` والقاعدة لكل أمر، وإلا يعاد كامل snapshot ذريًا ويُفتح Incident حرج.
- الإغلاق لا يحدث إلا بعد إثبات أن نفس Asset IDs موجودة فعليًا في `state.assets` وبنفس القاعدة المعتمدة ثم اكتمال جاهزية HR.
- `blocked_capacity` أصبح حالة lifecycle رسمية ومراقبة.
- Diagnostics يفحص mismatch في عدد/وجهة أوامر التسليم كحالة critical.
- زمن الوصول التشغيلي الظاهر أصبح air=90s، sea=150s، road=60s؛ مدد العقود الواقعية المستندية بقيت منفصلة.

### AI
- HR AI يعتمد على HR Core snapshot بدل الحساب القديم.
- طلبات أصول AI تدخل نفس Asset Acquisition Core ولا تملك مسار شراء خاصًا.
- صلاحية الخطة السنوية ما زالت bounded: يجب أن تكون الخطة approved، masterLetterId مطابق، والميزانية المتبقية تكفي قبل التنفيذ.
- التمويل التلقائي تحت الخطة السنوية يظل محدودًا بميزانية الخطة فقط.

### الحماية والتوافق
- App version: 2.5.0
- Build: 245
- Save Schema: 2.0.0 (لم يتغير)
- Native update/save authority لم تُخفف.
- لا يوجد private signing key أو signed update package داخل المصدر.
- Build245 هو baseline كامل جديد، وليس overlay فوق HR/Procurement القديمين.

### الاختبارات
- كل اختبارات non-browser في المستودع: 84/84 PASS.
- اختبارات Build245 الجديدة تشمل:
  - HR crew gap exactness + owned facility filtering + idempotency + scoped hiring.
  - exact-destination delivery contract.
  - atomic rollback عند نقص/فساد أوامر التسليم.
  - منع إغلاق الطلب إذا وصل الأصل إلى قاعدة خاطئة.
  - إزالة HR legacy owner وواجهة ONE CLICK HR.
  - single-path Asset Acquisition + legacy migration-and-retire.
- JavaScript syntax: PASS.
- Swift frontend parse: PASS.
- Swift/native contract guard: PASS.
- Playwright browser QA لم يُشغّل محليًا لأن dependency غير مثبتة في بيئة العمل؛ يبقى GitHub CI/Xcode هو gate النهائي للمتصفح والبناء الفعلي.
