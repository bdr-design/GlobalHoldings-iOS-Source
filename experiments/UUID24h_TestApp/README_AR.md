# تطبيق UUID التجريبي — 24 ساعة

هذا مشروع **SwiftUI مستقل** لتوليد UUID عشوائي وحفظه محليًا لمدة 24 ساعة.

**ليس UDID حقيقيًا، ولا يغيّر IDFV أو معرّفات أي تطبيق آخر، ولا يتصل بخوادم يودل.**

## ما الذي يفعله؟
- يبدأ توليد UUID من الضغط على زر «إنشاء UUID تجريبي».
- يحفظ نفس UUID لمدة 24 ساعة عند غلق التطبيق وإعادة فتحه.
- يعرض الوقت المتبقي بصيغة HH:MM:SS.
- يتيح نسخ المعرّف.
- يسمح بإنشاء معرّف جديد يدويًا بعد انتهاء 24 ساعة.

## البناء عبر المستودع
الفرع: uuid24h-ios-sandbox

1. افتح تبويب **Actions** في مستودع GitHub.
2. اختر **UUID24h iOS Sandbox**.
3. شغّل Workflow من تبويب Actions (أو عند أي تعديل على ملفات المشروع).
4. بعد نجاح البناء، افتح أحدث Run ثم نزّل **UUID24hTestApp_unsigned** من Artifacts.

الملف الناتج **IPA غير موقّع**؛ يلزم إعادة توقيعه بشهادة مناسبة لتثبيته على آيفون عادي. لا يضمن هذا البناء توافق كل أدوات التوقيع.

يمكن فتح المشروع على Mac بواسطة XcodeGen:

    cd experiments/UUID24h_TestApp
    brew install xcodegen
    xcodegen generate
    open UUID24hTestApp.xcodeproj

## اختبار منطق الـ24 ساعة على Linux أو macOS

    cp Tests/TrialUUIDStoreTests.swift /tmp/main.swift
    swiftc Sources/TrialUUIDStore.swift /tmp/main.swift -o /tmp/uuid24h-tests
    /tmp/uuid24h-tests

المدة تبدأ من وقت الإنشاء. لا يتضمن النموذج حماية ضد تغيير ساعة الجهاز.
