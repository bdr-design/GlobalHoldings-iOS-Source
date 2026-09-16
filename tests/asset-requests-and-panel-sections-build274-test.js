'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'app.js'), 'utf8');

// 1) "قيد الوصول" و"توريدات جارية" في لوحة التشغيل الرئيسية كانا يحسبان نفس التعبير حرفيًا
// (نفس المصفوفة، نفس الفلتر) بأسماء متغيرات مختلفة - يعرضان نفس الرقم تحت تسميتين مختلفتين،
// وهذا بالضبط الالتباس الذي طلب توضيحه. وُحِّد إلى إحصاء واحد واضح + قيمة مالية حقيقية بدل التكرار.
assert(!app.includes("const activeDeliveries=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered').length;\n    const openAssetRequests="), 'the duplicate delivery-count computation under two different labels must not reappear');
assert(app.includes('طلبات شراء قيد التسليم') && app.includes('قيمة الطلبات المعلّقة'), 'the operations hub must show one clear pending-order count plus its real financial value, not two identical counts under different names');

// 2) جدول تصنيف ثالث منفصل (panelRoot) - غير meta() وpanelMeta المُصلَحين سابقًا في BUILD270/272 -
// كان لا يزال يحمل مفتاحي اللوحتين المحذوفتين (competitors, more). تحقق نهائي شامل عبر الملف كله.
assert(!/\bcompetitors:'leadership'/.test(app), 'panelRoot must not still categorize the deleted competitors panel');
assert(!/,more:'system'/.test(app), 'panelRoot must not still categorize the deleted more panel');
assert(!app.includes("'competitors'") && !app.includes("'more'"), 'no lookup table in app.js should reference either deleted panel key anymore, in any form');

console.log('Asset-request stat duplication + third stale panelRoot table cleanup BUILD274: PASS');
