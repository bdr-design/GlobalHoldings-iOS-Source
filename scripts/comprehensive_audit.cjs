#!/usr/bin/env node
'use strict';
/**
 * أداة تدقيق شاملة (Comprehensive Audit) — تجمع كل طريقة اكتشاف حقيقية استُخدمت طوال هذه
 * الجلسة في أداة واحدة قابلة لإعادة التشغيل عند أي إصدار قادم، بدل تكرار نفس البحث يدويًا:
 *
 *  A) كل استدعاء أمر نطاق (dispatch/execute) مقابل الأوامر الحقيقية المعرّفة في كل نواة.
 *  B) كل معرّف زر (data-gh-action) مقابل معالجاته الفعلية في handleAction.
 *  C) كل مستمع نقر بنمط CSS (querySelectorAll('.class')) مقابل وجود عنصر HTML مطابق فعليًا.
 *  D) كل هدف تنقّل (data-open/data-panel) مقابل الموجّهين الفعليين في app.js وadvanced-core.js.
 *  E) كل دالة معرّفة بصيغة "function name(" في app.js/advanced-core.js لا يستدعيها أي مكان
 *     آخر في الملفين (اكتشاف ميت جديد قبل أن يتراكم كـ"فوضى").
 *
 * الاستخدام: node scripts/comprehensive_audit.cjs
 * يطبع تقريرًا؛ لا يعدّل أي ملف؛ خروجه 0 دائمًا (أداة استكشاف لا حارس CI صارم).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WEBAPP = path.join(ROOT, 'WebApp');

const read = f => fs.readFileSync(path.join(WEBAPP, f), 'utf8');
const app = read('app.js');
const adv = read('advanced-core.js');
const coreFiles = fs.readdirSync(WEBAPP).filter(f => f.endsWith('-core.js'));
const allWebAppFiles = fs.readdirSync(WEBAPP).filter(f => f.endsWith('.js'));

let issues = 0;
const report = (title) => console.log(`\n=== ${title} ===`);
const flag = (msg) => { issues++; console.log('  !!', msg); };
const ok = (msg) => console.log('  ok:', msg);

// --- A) domain command cross-reference -------------------------------------------------
report('A) domain command call sites vs real per-domain commands');
const domainFile = {};
for (const f of coreFiles) {
  const c = read(f);
  const m = c.match(/GH_DOMAIN_COMMANDS\?\.register\?\.\('([a-zA-Z0-9_-]+)'/);
  if (m) domainFile[m[1]] = f;
}
const domainCmds = {};
for (const [domain, f] of Object.entries(domainFile)) {
  const c = read(f);
  const cmds = new Set([...c.matchAll(/cmd==='([a-zA-Z0-9_-]+)'/g)].map(x => x[1]));
  for (const m of c.matchAll(/case\s*'([a-zA-Z0-9_-]+)'\s*:/g)) cmds.add(m[1]);
  domainCmds[domain] = cmds;
}
const coreVarToDomain = {
  GH_HR_CORE: 'hr', GH_AI_EXECUTIVE_CORE: 'ai', GH_CONTRACTS_CORE: 'contracts', GH_MARKET_CORE: 'market',
  GH_CORPORATE_CORE: 'corporate', GH_BANKING_CORE: 'banking', GH_FACILITY_CORE: 'facilities', GH_GOVERNANCE_CORE: 'governance',
  GH_ROUTE_CORE: 'routes', GH_OPERATIONS_CORE: 'operations', GH_PROCUREMENT_CORE: 'procurement', GH_STRATEGY_CORE: 'strategy',
  GH_FLEET_CORE: 'fleet', GH_FINANCE_CORE: 'finance',
};
const dispatchPattern = /(?:dispatch|execute)\??\.?\(\s*\{[^{}]*\}\s*,\s*'([a-zA-Z0-9_-]+)'\s*,\s*'([a-zA-Z0-9_-]+)'/g;
const execPattern = new RegExp(`(${Object.keys(coreVarToDomain).join('|')})\\??\\.execute\\??\\.?\\(\\s*\\{[^{}]*\\}\\s*,\\s*'([a-zA-Z0-9_-]+)'`, 'g');
let totalCalls = 0;
for (const f of allWebAppFiles) {
  const c = read(f);
  for (const m of c.matchAll(dispatchPattern)) {
    totalCalls++;
    const [, domain, cmd] = m;
    if (domainCmds[domain] && !domainCmds[domain].has(cmd)) flag(`${f}: dispatch to unknown command ${domain}/${cmd}`);
  }
  for (const m of c.matchAll(execPattern)) {
    totalCalls++;
    const domain = coreVarToDomain[m[1]], cmd = m[2];
    if (domainCmds[domain] && !domainCmds[domain].has(cmd)) flag(`${f}: ${m[1]}.execute unknown command ${cmd}`);
  }
}
ok(`${totalCalls} domain-command call sites checked across ${allWebAppFiles.length} files`);

// --- B) data-gh-action ids vs handleAction -----------------------------------------------
report('B) data-gh-action button ids vs their handlers');
const actionIds = new Set();
for (const f of [app, adv]) {
  for (const m of f.matchAll(/action\('([a-zA-Z0-9_-]+)'/g)) actionIds.add(m[1]);
  for (const m of f.matchAll(/data-gh-action="([a-zA-Z0-9_-]+)"/g)) actionIds.add(m[1]);
}
const indexHtmlContent = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
const combined = app + adv + indexHtmlContent;
let unhandled = 0;
for (const id of actionIds) {
  const direct = combined.includes(`id==='${id}'`) || combined.includes(`'${id}':[`) || new RegExp(`startsWith\\('${id.split('-')[0]}-`).test(combined);
  if (!direct) { flag(`action id with no direct handler match: ${id} (verify manually - may be handled by a prefix/table dispatch)`); unhandled++; }
}
ok(`${actionIds.size} action ids scanned, ${unhandled} flagged for manual check`);

// --- C) CSS-class-bound listeners vs actual elements --------------------------------------
report('C) querySelectorAll(\'.class\') listeners vs matching HTML');
const classListeners = [...app.matchAll(/querySelectorAll\('\.([a-zA-Z0-9-]+)'\)/g)].map(m => m[1]);
const uniqueClasses = [...new Set(classListeners)];
let deadListeners = 0;
for (const cls of uniqueClasses) {
  const hasElement = new RegExp(`class=\\\\?"[^"]*\\b${cls}\\b`).test(combined) || new RegExp(`className[^;]*['"\`][^'"\`]*\\b${cls}\\b`).test(combined);
  if (!hasElement) { flag(`listener bound to .${cls} but no matching HTML element found in either file (dead binding, or class built dynamically)`); deadListeners++; }
}
ok(`${uniqueClasses.length} CSS-class listeners scanned, ${deadListeners} flagged for manual check`);

// --- D) navigation targets vs routers ------------------------------------------------------
report('D) data-open/data-panel targets vs both routers');
const routed = new Set();
for (const m of app.matchAll(/panel==='([a-zA-Z]+)'/g)) routed.add(m[1]);
const advMapMatch = adv.match(/function render\(panel,arg,ctx\)\{[\s\S]*?return map\[panel\]/);
if (advMapMatch) for (const m of advMapMatch[0].matchAll(/([a-zA-Z]+):\(\)=>/g)) routed.add(m[1]);
const referenced = new Set();
for (const f of [app, adv]) {
  for (const m of f.matchAll(/data-open="([a-zA-Z]+)"/g)) referenced.add(m[1]);
  for (const m of f.matchAll(/data-panel="([a-zA-Z]+)"/g)) referenced.add(m[1]);
}
const indexHtml = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
for (const m of indexHtml.matchAll(/data-panel="([a-zA-Z]+)"/g)) referenced.add(m[1]);
const brokenLinks = [...referenced].filter(p => !routed.has(p));
const orphanPanels = [...routed].filter(p => !referenced.has(p) && !new RegExp(`'${p}'`).test(combined.replace(/panel==='[a-zA-Z]+'/g, '').replace(new RegExp(`${p}:\\(\\)=>`), '')));
if (brokenLinks.length) brokenLinks.forEach(p => flag(`button references panel "${p}" with no route handler`));
else ok('zero broken navigation links');
console.log(`  note: ${orphanPanels.length} panel(s) present in a router with no *literal* string reference found elsewhere (${orphanPanels.join(', ') || 'none'}) - verify manually, dynamic ${'${panel}'} card arrays cause false positives here`);

// --- E) function-name reachability (new dead-code detector) --------------------------------
report('E) functions defined in app.js/advanced-core.js never referenced again');
for (const [label, src] of [['app.js', app], ['advanced-core.js', adv]]) {
  const names = [...src.matchAll(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1]);
  let deadCount = 0;
  for (const name of new Set(names)) {
    const count = (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
    if (count <= 1) { flag(`${label}: function "${name}" is defined but never referenced again anywhere in the same file`); deadCount++; }
  }
  ok(`${label}: ${new Set(names).size} functions scanned, ${deadCount} flagged as fully unreferenced`);
}

console.log(`\n=== SUMMARY: ${issues} item(s) flagged for human review (not all are bugs - see notes above) ===`);
