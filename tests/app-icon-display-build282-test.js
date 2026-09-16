'use strict';
// BUILD282: يمنع رجوع أيقونة تطبيق لا تظهر رغم نجاح البناء.
//
// المشكلة كانت ذات مستويين لا يكشفهما نجاح التجميع وحده: يجب ربط Assets.xcassets بمرحلة الموارد
// الفعلية كي ينتج Assets.car، ويجب أن يحمل Info.plist اسم AppIcon نفسه ليعرضه iOS على الشاشة الرئيسية.
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
assert.ok(/- path:\s*iOS\/GlobalHoldings\/Assets\.xcassets\s+buildPhase:\s*resources/.test(projectYml),
  'Assets.xcassets must be attached to the Xcode target resource phase so the IPA contains Assets.car');

// ---- 3) Info.plist المُولَّد يحمل المفتاح الذي يجعل iOS يعرض الأيقونة فعليًا وقت التشغيل ----
assert.ok(projectYml.includes('CFBundleIconName: "AppIcon"'),
  'CFBundleIconName must be present in the generated Info.plist properties, or the icon compiles into the bundle but never actually displays on a real device');

// اسم مجموعة الأيقونات في المصرِّف وCFBundleIconName يجب يتطابقا حرفيًا، وإلا نفس العطل يرجع بمعرّف مختلف
const compilerName = projectYml.match(/ASSETCATALOG_COMPILER_APPICON_NAME:\s*"([^"]+)"/)?.[1];
const iconName = projectYml.match(/CFBundleIconName:\s*"([^"]+)"/)?.[1];
assert.strictEqual(compilerName, iconName,
  `ASSETCATALOG_COMPILER_APPICON_NAME ("${compilerName}") and CFBundleIconName ("${iconName}") must reference the exact same icon set name`);

// ---- 4) ناتج التطبيق مقيد فعليًا بالـiPhone وتتحقق البوابة من كامل المصفوفة ومن Assets.car ----
assert.ok(/PRODUCT_NAME:\s*GlobalHoldings[\s\S]*?TARGETED_DEVICE_FAMILY:\s*"1"/.test(projectYml),
  'TARGETED_DEVICE_FAMILY must be overridden on the application target, not only at project level');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/build-unsigned-ipa.yml'), 'utf8');
assert.ok(workflow.includes("plist.get('UIDeviceFamily') != [1]"),
  'CI must reject any IPA that also advertises iPad support');
assert.ok(workflow.includes("app / 'Assets.car'")&&workflow.includes('missing the compiled AppIcon asset catalog'),
  'CI must reject an IPA that names AppIcon but omits the compiled Assets.car payload');

console.log('app-icon-display-build282-test: ok');
process.exit(0);
