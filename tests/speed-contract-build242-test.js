const fs=require('fs'),assert=require('assert');
const diag=fs.readFileSync('WebApp/diagnostics-core.js','utf8');
const app=fs.readFileSync('WebApp/app.js','utf8');
assert(diag.includes('ALLOWED_SPEEDS=[0,1,2,4]'),'diagnostics must allow exactly Pause/x1/x2/x4');
assert(!diag.includes('[0,1,2,4,8,16]'),'legacy x8/x16 diagnostics contract must be absent');
assert(app.includes('SAFE_SPEED_VALUES=[0,1,2,4]'),'app must expose exactly four speed values');
for(const f of fs.readdirSync('WebApp').filter(x=>x.endsWith('.js'))){
 const s=fs.readFileSync('WebApp/'+f,'utf8');
 assert(!s.includes('[0,1,2,4,8,16]'),`${f} reintroduces unsupported x8/x16 speed contract`);
}
console.log('Build242 speed contract: PASS');
