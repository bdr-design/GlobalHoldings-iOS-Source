# Global Holdings 2.4.0 — Build 244 Guardian Signal Refinement

- Native Build: `244`
- Save Schema: `2.0.0`
- Baseline: Build243 Central Control & Integrity Plane
- التغيير محصور في جودة الإشارات الرقابية: busy-aware UI validation، dedupe بين Diagnostics/Integrity، startup grace للمراجعات، وdelta-based workflow postcheck.

راجع `BUILD244_GUARDIAN_SIGNAL_REFINEMENT_AR.md` قبل تعديل هذه الطبقة.

---

# Global Holdings 2.4.0 — Build 243 Central Control & Integrity Plane

- App/Content: `2.4.0`
- Native Build: `243`
- Save Schema: `2.0.0`
- Update mode: `clean-snapshot-v1`

## الأساس الجديد
Build243 يحافظ على Atomic Clean Baseline السابق ويضيف `control-plane-core.js` كطبقة سلطة/تدقيق مركزية modular: Command IDs، correlation/causation، Incident Center، tamper-evident journal، idempotent Outbox، Engine/Dependency Registry، Black Box، مركز تحكم داخل اللعبة، وربط Save/Update/AI/Business Events.

المحرك المركزي **لا يسرق ملكية المجالات**: Simulation/Finance/Procurement/Save/Native Update تبقى ملاك قواعدها، بينما التفاعل بينها يمر أو يُراقب عبر Control Plane. AI يبقى عاملًا رئيسيًا ومشرفًا تشخيصيًا لكنه لا يعدّل state الحساس مباشرة.

راجع `BUILD243_CENTRAL_CONTROL_PLANE_ARCHITECTURE_AR.md` قبل أي تطوير جديد.

---

# Global Holdings 2.3.7 — Deep Systems Completion

- App/Content: `2.3.7`
- Native Build: `237`
- Save Schema: `2.0.0`
- Update mode: `clean-snapshot-v1`

## ما الجديد
- `workflow-core.js` بوابة واحدة للتأكيدات والـFeedback ومراقبة كل إجراء حساس.
- فحص Business Integrity تلقائي بعد الأزرار والإجراءات الرئيسية.
- توسيع سلامة المالية إلى الحسابات والسيولة الموحدة والفواتير والشيكات والذمم والقيود.
- كل Panel في الأقسام المتقدمة أصبح له Domain owner قابل للاختبار.
- `.ghdiag` يصدر Workflow history ونتيجة آخر Post-action integrity.
- Native/CI صار يرفض Runtime ناقصًا أو Metadata لا يطابق 2.3.7 / Build 237.

راجع `DEEP_SYSTEMS_COMPLETION_2_3_7_AR.md` للتفاصيل.

---

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

# Global Holdings 2.3.0 — إعادة بناء هيكل الأقسام

هذه النسخة تعيد بناء Information Architecture جذريًا إلى سبعة مجالات مالكة فقط: العالم، القيادة، الشركات، التشغيل، المالية، الرقابة، النظام. تم نقل الواجهات دون نسخ محركات الأعمال، وإلغاء «الإدارة» كقسم عام، وإزالة «الأصول» و«الذكاء» من المستوى الرئيسي.

- App/Content: `2.3.0`
- Native Build: `230`
- Save Schema: `2.0.0`
- دراسة الهيكل: `NAVIGATION_ARCHITECTURE_2_3_AR.md`

## المبدأ
كل وظيفة لها مالك واحد. الاختصارات يمكن أن تنقل المستخدم إلى الوظيفة، لكنها لا تنشئ نسخة ثانية منها. مركز طلبات الأصول يبقى حصريًا تحت التشغيل، AI تحت القيادة، الرقابة مستقلة عن التنفيذ، وأدوات التطبيق التقنية تحت النظام.

---

## 2.3.0 — مركز طلبات الأصول وDemand Closure Engine

طلبات أصول الطيران والبحرية واللوجستيات أصبحت مركزية في مكان واحد، مع دراسة AI، تفويض، تمويل مرتبط، تسليم، جاهزية، وإغلاق كامل للطلب.

# Global Holdings — Full Source 2.3.0 Layout Integrity Baseline

- App/Content: `2.3.0`
- Native build: `226`
- Save Schema: `2.0.0`
- Time controls: `Pause / ×1 / ×2 / ×4 / ×8 / ×16`

## ما الجديد في 2.3.0

- إصلاح الشريط العلوي ليملك أربع خانات إجراءات فعلية: AI، التنبيهات، صحة النظام، الإعدادات؛ بدون التفاف أو خروج زر إلى صف ثانٍ.
- ضبط عرض منطقة الإجراءات لكل أحجام iPhone Landscape المدعومة بدل الاعتماد على عرض مخصص لثلاثة أزرار.
- إضافة فحص UI Layout إلى مركز صحة النظام: يكتشف التفاف أزرار الشريط، خروجها من الحاوية، وتداخل actions/KPI/brand وأدوات الخريطة.
- إضافة `layout` snapshot إلى ملف `.ghdiag` لتشخيص المشاكل البصرية من الملف نفسه.
- استمرار مركز صحة النظام وإعادة هيكلة الأقسام من 2.2.5.
- استمرار إصلاحات استقرار الزمن وScoped Transactions من 2.2.4.

## قواعد السلامة

- Simulation Core هو المالك الوحيد للوقت.
- كل Simulation Slice ذرية All-or-Nothing.
- لا يتم تخطي Hour/Day boundaries.
- Save Schema يبقى 2.0.0 للتوافق.
- الفحص التشخيصي لا يصلح الحالة تلقائيًا؛ يكتشف ويصدر تقريرًا فقط.

### ملاحظات 2.3.0
التسليم وAI والتشخيص لم تعد مرتبطة بانتظار ساعة/يوم محاكاة كامل. التسليم يُعالج ذريًا داخل الزمن، AI يراجع دوريًا أثناء الاستخدام، وصحة النظام تتحدث كل 10 ثوانٍ مع سجل قابل للمسح والتصدير.

### 2.3.3 — Core Business Lifecycle
طلبات الأصول الآن تمر بمحركات مستقلة للـLifecycle والسياسات والتبعيات ودفتر الأحداث وسلامة الأعمال. مركز التشخيص يصدر هذه البيانات داخل `.ghdiag`، ولا يسمح محرك الإغلاق بإغلاق الطلب قبل سد كل التبعيات والكمية والجاهزية.

### 2.3.3 — Clean Atomic Update Installer
تحديثات WebApp لم تعد Overlay. كل حزمة كاملة تُثبت في Staging فارغ، تُطابق ملفاتها حرفيًا، ثم تُبدل ذريًا مع الاحتفاظ بنسخة سابقة واحدة حتى تأكيد أول تشغيل ناجح. راجع `CLEAN_ATOMIC_UPDATE_2_3_3_AR.md`.

### المستندات المالية 2.3.4
الشيكات والتحويلات تستخدم الآن قالبًا رسميًا موحدًا مستوحى من نموذج الاعتماد التنفيذي، مع تمييز الحوالات الواردة والصادرة والداخلية وإظهار الهوية القانونية الحالية للكيان.

### 2.3.5 — اكتمال الأقسام
أضيف مركز المهام والقرارات تحت القيادة كصفحة استثناءات موحدة، وUI Quality Core يفحص الأقسام بعد ربط التفاعلات ويصدر مشكلات الواجهة إلى Diagnostics بدل تركها صامتة.
