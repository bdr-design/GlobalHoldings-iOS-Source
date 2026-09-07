# Global Holdings 2.3.7 — Deep Systems Completion

هذه المرحلة تعمّق الأنظمة الحالية بدل إضافة أنظمة متوازية جديدة.

## Workflow Control Plane
- `workflow-core.js` بوابة موحدة للتأكيدات والتنبيهات وسجل الإجراءات.
- لا توجد استدعاءات `alert()/confirm()` مباشرة في `app.js` أو `advanced-core.js`.
- كل إجراء مربوط عبر Interaction Guard يمر بعد النجاح على فحص Business Integrity.
- يسجل Workflow: البداية، التأكيد، الإلغاء، النجاح، الفشل، ونتيجة فحص السلامة بعد الإجراء.
- تاريخ Workflow يدخل ملف `.ghdiag`.

## Finance Integrity
`integrity-core.js` يراجع الآن بالإضافة لدورة الطلبات:
- الحسابات المفقودة أو المكررة.
- الأرصدة غير الرقمية أو السالبة خارج God Mode.
- تطابق السيولة الموحدة مع مجموع حسابات كل الشركات.
- أرقام الفواتير والشيكات المكررة.
- الشيك بلا مستفيد أو حساب مصدر.
- الذمم المسددة التي بقيت في قوائم الذمم المفتوحة.
- القيود المالية ذات القيمة غير الصالحة أو الطرف الناقص.

## Panel ownership
- كل Panel في `advanced-core.js` يجب أن يملك Domain واحدًا في `ui-quality-core.js`.
- `more` هو alias للنظام فقط.
- `energy` مملوك لمجال الشركات.
- CI يفشل إذا ظهر Panel بلا مالك.

## Native / CI consistency
- Native staged-update validator يشترط كل الـcores الحرجة، بما فيها Workflow/Interaction/UI Quality.
- GitHub Workflow يفحص إصدار 2.3.7 / Build 237 بدل metadata قديمة.
- Save Schema بقي 2.0.0.
- Clean Snapshot فقط؛ Delta/Overlay يبقى ممنوعًا.
