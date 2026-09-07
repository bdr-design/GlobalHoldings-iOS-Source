const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),adv=fs.readFileSync(path.join(root,'WebApp/advanced-core.js'),'utf8'),html=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8');
assert.ok(html.includes('workflow-core.js'),'workflow-core missing from load order');
for(const [name,text] of [['app.js',app],['advanced-core.js',adv]]){
  assert.ok(!/(^|[^.\w])(alert|confirm)\s*\(/m.test(text),`${name} contains direct alert/confirm`);
}
assert.ok(app.includes('GH_WORKFLOW?.run'),'app startup does not require Workflow Core');
console.log('workflow-gateway-architecture-guard: PASS');
