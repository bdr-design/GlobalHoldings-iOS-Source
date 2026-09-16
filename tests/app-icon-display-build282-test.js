'use strict';
// BUILD282: يمنع رجوع أيقونة تطبيق لا تظهر رغم نجاح البناء.
//
// المشكلة: مجموعة الأيقونات AppIcon.appiconset موجودة وصحيحة (1024×1024، RGB بلا قناة شفافية -
// المطلوب تمامًا)، وASSETCATALOG_COMPILER_APPICON_NAME في project.yml يشير لها بشكل صحيح فتُصرَّف
// ضمن حزمة التطبيق بنجاح. لكن Info.plist المُولَّد (عبر بلوك info/properties في XcodeGen) كان يفتقد
// CFBundleIconName - المفتاح المطلوب من iOS 11 فصاعدًا ليعرف نظام التشغيل وقت التشغيل أي أيقونة
// يعرضها فعليًا (الشاشة الرئيسية، الإعدادات، Spotlight). غياب هذا المفتاح لا يُفشل البناء إطلاقًا -
// المُصرِّف لا يتحقق من هذا الربط - فتظهر المشكلة فقط على جهاز حقيقي بعد التثبيت: أيقونة فارغة أو
// افتراضية رغم بناء ناجح 20/20 خطوة.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectYml = fs.readFileSync(path.join(__dirname, '..', 'project.yml'), 'utf8');

// ---- 1) مجموعة الأيقونات نفسها موجودة وبالحجم الصحيح ----
const iconPath = path.join(__dirname, '..', 'iOS/GlobalHoldings/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png');
assert.ok(fs.existsSync(iconPath), 'AppIcon-1024.png must exist in the asset catalog');
const header = fs.readFileSync(iconPath).subarray(0, 33);
// PNG IHDR: 8 bytes signature + 4 length + 4 "IHDR" + 4 width + 4 height + ... + 1 color type (byte 25)
const width = header.readUInt32BE(16), height = header.readUInt32BE(20), colorType = header.readUInt8(25);
assert.strictEqual(width, 1024, 'the app icon must be exactly 1024x1024');
assert.strictEqual(height, 1024, 'the app icon must be exactly 1024x1024');
assert.notStrictEqual(colorType, 6, 'the app icon must NOT have an alpha channel (PNG color type 6 = RGBA) - iOS rejects/mishandles transparent app icons');
assert.notStrictEqual(colorType, 4, 'the app icon must NOT have an alpha channel (PNG color type 4 = grayscale+alpha)');

// ---- 2) الأصل الجرافيكي مربوط فعليًا عبر المصرِّف ----
assert.ok(projectYml.includes('ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon"'),
  'the asset catalog compiler must be told which icon set to use');

// ---- 3) Info.plist المُولَّد يحمل المفتاح الذي يجعل iOS يعرض الأيقونة فعليًا وقت التشغيل ----
assert.ok(projectYml.includes('CFBundleIconName: "AppIcon"'),
  'CFBundleIconName must be present in the generated Info.plist properties, or the icon compiles into the bundle but never actually displays on a real device');

// اسم مجموعة الأيقونات في المصرِّف وCFBundleIconName يجب يتطابقا حرفيًا، وإلا نفس العطل يرجع بمعرّف مختلف
const compilerName = projectYml.match(/ASSETCATALOG_COMPILER_APPICON_NAME:\s*"([^"]+)"/)?.[1];
const iconName = projectYml.match(/CFBundleIconName:\s*"([^"]+)"/)?.[1];
assert.strictEqual(compilerName, iconName,
  `ASSETCATALOG_COMPILER_APPICON_NAME ("${compilerName}") and CFBundleIconName ("${iconName}") must reference the exact same icon set name`);

console.log('app-icon-display-build282-test: ok');
process.exit(0);
