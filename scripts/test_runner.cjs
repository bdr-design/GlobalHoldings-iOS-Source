'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),rows=[];
const supersededPath=path.join(root,'tests','superseded-by-build301.json');
const superseded=fs.existsSync(supersededPath)?JSON.parse(fs.readFileSync(supersededPath,'utf8')):{};
for(const file of fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.js')&&!f.startsWith('browser')).sort()){
 if(superseded[file]){rows.push({file,ok:true,skipped:true,supersededBy:'build301-system-consolidation-test.js',reason:superseded[file]});console.log(`SKIP ${file} — ${superseded[file]}`);continue;}
 const started=performance.now(),out=spawnSync(process.execPath,[path.join('tests',file)],{cwd:root,encoding:'utf8',timeout:120000});
 const ok=out.status===0;rows.push({file,ok,durationMs:Math.round(performance.now()-started),output:out.stdout+out.stderr,error:out.error?.message});console.log((ok?'PASS ':'FAIL ')+file);if(!ok)console.error(out.stdout+out.stderr+(out.error?.message||''));
}
const active=rows.filter(r=>!r.skipped),skipped=rows.filter(r=>r.skipped);
fs.mkdirSync(path.join(root,'.ci-output/ci'),{recursive:true});fs.writeFileSync(path.join(root,'.ci-output/ci/guard-results.json'),JSON.stringify({node:process.version,passed:active.filter(r=>r.ok).length,total:active.length,superseded:skipped.length,results:rows},null,2));
console.log(`Repository suites: ${active.filter(r=>r.ok).length}/${active.length} active; ${skipped.length} explicitly superseded by BUILD301`);if(active.some(r=>!r.ok))process.exitCode=1;
