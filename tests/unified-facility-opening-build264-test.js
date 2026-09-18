const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync('WebApp/app.js', 'utf8');

// 1) لا وجود إطلاقًا لمسار الشراء المباشر المكرر القديم (كان يخصم مبلغًا ثابتًا لا يطابق السعر المعروض)
assert(!app.includes("price=18000000"), 'the old hardcoded $18M direct-spend path must be gone');
assert(!/kind:'logistics'[^}]*capacity:240/.test(app), 'the old duplicate flat-spend logistics facility literal must be gone');

// 2) لا وجود لنظام "فتح قاعدة عالمية بالضغط على أي مكان بالخريطة" الميت والمكسور
assert(!app.includes('startBasePlacement'), 'the dead/broken map-click global-base placement system must be fully removed');
assert(!app.includes('place-global-base'), 'no leftover listener for the removed global-base placement button');

// 3) تأكيد التوحيد: فتح المركز اللوجستي لا يملك مسار خريطة حرًا؛ الدليل العالمي هو المدخل الوحيد.
assert(!app.includes('startHubPlacement')&&!app.includes('place-logistics')&&!app.includes('confirmMapPlacement'), 'the superseded free-map logistics opening path must be fully removed');
assert(app.includes("if(company==='road')result=openLogisticsHub(entity.key,opts)"), 'the global directory must delegate logistics opening through its canonical directory key');

// 4) لا وجود لمستمع أزرار ميت لا يقابله أي عنصر HTML فعلي
assert(!app.includes("querySelectorAll('.open-global-route')"), 'dead unused .open-global-route listener must be removed');

console.log('Duplicate/dead facility-opening code removal BUILD264: PASS');
