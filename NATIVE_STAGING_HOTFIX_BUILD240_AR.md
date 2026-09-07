# إصلاح Native لمسار Staging — Build 240

## المشكلة
كان `validateExactSnapshot` يقارن مسارات الملفات كنص خام (`url.path.hasPrefix(folder.path)`). على iOS قد يظهر نفس Sandbox بصيغ متكافئة مثل `/var/...` و`/private/var/...`، فيرفض ملفًا شرعيًا داخل `WebApp.staging` برسالة «مسار ملف Staging غير متوقع».

## الإصلاح
- Canonicalize للمجلد والملف عبر `resolvingSymlinksInPath().standardizedFileURL`.
- استخراج المسار النسبي بعد التطبيع فقط.
- الإبقاء على فحص containment داخل Staging.
- الإبقاء على `isSafePath` لمنع `..` والمسارات المطلقة/غير الآمنة.
- لا Overlay ولا تخفيف لمطابقة Clean Snapshot.

## الإصدار
WebApp: 2.3.8 (بدون تغيير)
Native build: 240
