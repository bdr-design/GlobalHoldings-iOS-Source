const fs=require('fs'),assert=require('assert');
const index=fs.readFileSync('WebApp/index.html','utf8'),app=fs.readFileSync('WebApp/app.js','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
const required=[['leadershipHub','القيادة'],['companies','الشركات'],['control','التشغيل'],['peopleHub','الموارد'],['finance','المالية'],['governanceHub','الحوكمة'],['systemHub','النظام']];
for(const [panel,label] of required){assert(index.includes(`data-panel="${panel}"`),`missing top-level ${panel}`);assert(index.includes(`<span>${label}</span>`),`missing label ${label}`);}
const bottom=(index.match(/<nav class="bottom-nav workspace-bottom-nav"[\s\S]*?<\/nav>/)||[])[0]||'';assert(bottom,'mobile workspace nav missing');assert.strictEqual((bottom.match(/<button/g)||[]).length,5,'mobile bottom nav must have exactly 5 destinations');
for(const label of ['العالم','القيادة','العمليات','المالية','المزيد'])assert(bottom.includes(`>${label}<`),`mobile nav missing ${label}`);
assert(!bottom.includes('>الشركات<')&&!bottom.includes('>الحوكمة<')&&!bottom.includes('>النظام<'),'secondary workspaces must not crowd mobile bottom nav');
assert(app.includes("'workspaceHub','peopleHub'"),'new advanced workspaces must be fail-closed owned panels');
assert(advanced.includes('function renderPeopleHub(ctx)'),'People/HR hub missing');assert(advanced.includes('function renderWorkspaceHub(ctx)'),'More workspace hub missing');
assert(advanced.includes("['peopleHub','labor'].includes(panel) ? 'people'"),'People panels must root to people domain');
console.log('Navigation architecture Build246: PASS');
