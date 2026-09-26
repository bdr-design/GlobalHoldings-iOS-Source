'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
const html=fs.readFileSync(path.join(web,'index.html'),'utf8');
const runtime=JSON.parse(fs.readFileSync(path.join(web,'runtime-required.json'),'utf8'));
const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]||'';

assert.match(csp,/default-src 'self'/);
assert.match(csp,/script-src 'self'(?:;|$)/);
assert.doesNotMatch(csp,/script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|https?:)/);
assert.match(csp,/img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org https:\/\/server\.arcgisonline\.com/);
assert.match(csp,/connect-src 'self' blob: https:\/\/router\.project-osrm\.org/);
for(const directive of ["object-src 'none'","base-uri 'none'","form-action 'none'","frame-src 'none'"])assert(csp.includes(directive),directive);

const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match=>match[1]);
assert(scripts.length>0);
for(const source of scripts){assert(!/^https?:/i.test(source),`external executable script: ${source}`);assert(fs.existsSync(path.join(web,source)),`missing script: ${source}`);assert(runtime.files.includes(source),`script absent from runtime manifest: ${source}`);}
assert.equal((html.match(/<script(?!\s+src=)/g)||[]).length,0,'inline executable script found');

const firstParty=fs.readdirSync(web).filter(name=>name.endsWith('.js')).map(name=>fs.readFileSync(path.join(web,name),'utf8')).join('\n');
for(const pattern of [/\beval\s*\(/,/new\s+Function\s*\(/,/document\.write\s*\(/])assert(!pattern.test(firstParty),String(pattern));
assert(!/(?:fetch\s*\(|src\s*=|href\s*=|tileLayer\s*\()[^\n]{0,180}http:\/\//i.test(html+'\n'+firstParty),'unencrypted executable endpoint in first-party runtime');

for(const required of ['capability-registry-core.js','company-definitions.js','company-platform-core.js','authorization-core.js','document-proof-core.js','signature-pad-core.js','formation-engine.js','map-feature-core.js','map-layer-registry.js','authorization-ui.css'])assert(runtime.files.includes(required),`missing protected runtime file: ${required}`);
assert(html.includes('accept="image/png,image/jpeg,image/webp"'),'logo picker MIME allowlist missing');
assert(firstParty.includes('image/png')&&firstParty.includes('image/jpeg')&&firstParty.includes('image/webp'),'logo decoder MIME allowlist missing');
assert(firstParty.includes('native-save-ack-timeout')&&firstParty.includes('saveHash')&&firstParty.includes('expectedPreviousRevision'),'native persistence correlation contract missing');

console.log(JSON.stringify({passed:true,csp:true,localScripts:scripts.length,runtimeFiles:runtime.files.length,unsafeExecutors:0,logoMimeAllowlist:true,nativeAckCorrelation:true},null,2));
