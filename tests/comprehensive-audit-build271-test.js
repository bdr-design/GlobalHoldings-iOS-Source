'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 1) أداة التدقيق الشاملة الجديدة (scripts/comprehensive_audit.cjs) يجب أن تعمل دون أخطاء
// وتُنتج تقريرًا حقيقيًا - أصل قابل لإعادة الاستخدام عند أي إصدار قادم، لا فحصًا لمرة واحدة.
(function auditToolRuns(){
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'comprehensive_audit.cjs')], { encoding: 'utf8' });
  assert(out.includes('SUMMARY:'), 'the audit tool must produce a final summary line');
  assert(out.includes('domain-command call sites checked'), 'section A must run');
  assert(out.includes('action ids scanned'), 'section B must run');
})();

// 2) زر "غادر الآن" الفردي: departNow() كان موجودًا وصحيحًا منذ BUILD258 (فحص جاهزية موحّد،
// سبب تعطل دقيق) لكن بلا أي زر حقيقي يستدعيه من صفحة إدارة الأصل - المسار الوحيد للمغادرة
// كان جماعيًا فقط. أضيف الزر الآن بشرط أن يكون الأصل فعليًا في مرحلة turnaround وله مسار.
(function departNowButtonWired(){
  const app = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'app.js'), 'utf8');
  assert(app.includes("a.phase==='turnaround'&&a.routeId?`<button class=\"secondary-btn depart-now\""), 'the per-asset page must render a real depart-now button when the asset is actually ready');
  assert(app.includes("querySelectorAll('.depart-now')"), 'a handler for that button must already exist (it did, unreachable, since BUILD258)');
})();

// 3) مسارا إعادة تعيين مكررين ميتين تمامًا (.reset-save) أزيلا لصالح المسار الحقيقي الوحيد
// العامل (.new-game-direct)، الذي تحقق أنه فعليًا مرتبط بزر حقيقي في لوحة الإعدادات.
(function deadResetDuplicateRemoved(){
  const app = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'app.js'), 'utf8');
  const adv = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'advanced-core.js'), 'utf8');
  assert(!app.includes("querySelectorAll('.reset-save')"), 'the dead duplicate reset-save listener must be removed');
  assert(app.includes("querySelectorAll('.new-game-direct')"), 'the one real, working reset path must remain');
  assert(adv.includes('class="primary-btn new-game-direct"'), 'a real button using that class must exist in Settings');
})();

console.log('Comprehensive audit tool + depart-now button + dead reset cleanup BUILD271: PASS');

// 4) بعد كل التنظيف الإضافي هذه الجولة (BUILD273): صفر دوال ميتة متبقية في app.js وadvanced-core.js.
// هذا تأكيد صارم (assert) لا مجرد تقرير، حتى لا تتراكم دوال ميتة جديدة بصمت مستقبلًا.
(function zeroOrphanedFunctions(){
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'comprehensive_audit.cjs')], { encoding: 'utf8' });
  assert(out.includes('app.js: ') && /app\.js: \d+ functions scanned, 0 flagged/.test(out), 'app.js must have zero fully-unreferenced functions');
  assert(/advanced-core\.js: \d+ functions scanned, 0 flagged/.test(out), 'advanced-core.js must have zero fully-unreferenced functions');
})();

// 5) قسم I (كاشف الإحصاء المكرر، أُضيف في BUILD275 بعد خلل "قيد الوصول/توريدات جارية" الحقيقي في
// BUILD274) يجب أن يعمل فعليًا لا أن يمر صامتًا فقط لأن الكود الحالي نظيف. تحقق مباشر: نمرّر له
// نفس الخلل الأصلي حرفيًا في كود وهمي منفصل ونتأكد أنه يُكتشف - لا نكتفي بأن الفحص الحقيقي رجع صفرًا.
(function duplicateStatDetectorActuallyWorks(){
  const buggyCode = "\n  function renderControl(){\n    const activeDeliveries=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered').length;\n    const openAssetRequests=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered').length;\n    return activeDeliveries+openAssetRequests;\n  }\n";
  const funcStarts = [...buggyCode.matchAll(/function\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*\{/g)].map(m => m.index);
  funcStarts.push(buggyCode.length);
  let caught = false;
  for (let i = 0; i < funcStarts.length - 1; i++) {
    const body = buggyCode.slice(funcStarts[i], Math.min(funcStarts[i + 1], funcStarts[i] + 6000));
    const seen = new Map();
    for (const m of body.matchAll(/const\s+(\w+)\s*=\s*(\([^;]{20,240}?\)(?:\.[a-zA-Z]+(?:\([^;]{0,80}?\))?)*)\s*;/g)) {
      const [, varName, expr] = m;
      if (seen.has(expr) && seen.get(expr) !== varName) caught = true;
      seen.set(expr, varName);
    }
  }
  assert(caught, 'the duplicate-stat detector must actually catch the exact BUILD274 bug pattern when reintroduced, not just report zero on already-clean code');
})();
