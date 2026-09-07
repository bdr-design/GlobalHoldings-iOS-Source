'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),rows=[];
for(const file of fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.js')&&!f.startsWith('browser')).sort()){
 const started=performance.now(),out=spawnSync(process.execPath,[path.join('tests',file)],{cwd:root,encoding:'utf8',timeout:120000});
 const ok=out.status===0;rows.push({file,ok,durationMs:Math.round(performance.now()-started),output:out.stdout+out.stderr,error:out.error?.message});console.log((ok?'PASS ':'FAIL ')+file);if(!ok)console.error(out.stdout+out.stderr+(out.error?.message||''));
}
fs.mkdirSync(path.join(root,'build/ci'),{recursive:true});fs.writeFileSync(path.join(root,'build/ci/guard-results.json'),JSON.stringify({node:process.version,passed:rows.filter(r=>r.ok).length,total:rows.length,results:rows},null,2));
console.log('Repository suites: '+rows.filter(r=>r.ok).length+'/'+rows.length);if(rows.some(r=>!r.ok))process.exitCode=1;
