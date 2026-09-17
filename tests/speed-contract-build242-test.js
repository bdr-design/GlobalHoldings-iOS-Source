const fs=require('fs'),assert=require('assert');
const diag=fs.readFileSync('WebApp/diagnostics-core.js','utf8');
const app=fs.readFileSync('WebApp/app.js','utf8');
assert(diag.includes('ALLOWED_SPEEDS=[0,1,2,3,4,5]'),'diagnostics must allow pause plus five running levels');
assert(!diag.includes('[0,1,2,4,8,16]'),'legacy x8/x16 diagnostics contract must be absent');
assert(app.includes('SAFE_SPEED_VALUES=[0,1,2,3,4,5]'),'app must expose pause plus five running levels');
assert(app.includes('allowedSpeeds:[0,30,60,120,300,600]'),'engine adapter must whitelist the five effective rates without increasing the 600x ceiling');
for(const f of fs.readdirSync('WebApp').filter(x=>x.endsWith('.js'))){
 const s=fs.readFileSync('WebApp/'+f,'utf8');
 assert(!s.includes('[0,1,2,4,8,16]'),`${f} reintroduces unsupported x8/x16 speed contract`);
}
console.log('Build242 speed contract: PASS');
