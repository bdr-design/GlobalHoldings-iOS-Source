'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const root=path.resolve(__dirname,'..'),script=path.join(root,'scripts/source_integrity.py');
assert(fs.existsSync(script),'deterministic source-integrity owner is missing');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/build-unsigned-ipa.yml'),'utf8');
assert(workflow.includes('python3 scripts/source_integrity.py --check'),'CI does not use the same deterministic source-integrity owner');
const manifest=fs.readFileSync(path.join(root,'SOURCE_INTEGRITY_SHA256.txt'),'utf8');
for(const forbidden of ['deliverables/','tests/screenshots/','__pycache__/','.pyc'])assert(!manifest.includes(forbidden),`generated/ignored path leaked into source manifest: ${forbidden}`);
const out=spawnSync('python3',[script,'--check'],{cwd:root,encoding:'utf8'});
assert.strictEqual(out.status,0,`${out.stdout}${out.stderr}`);

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'gh-source-integrity-contract-'));
const checkFixture=()=>spawnSync('python3',[script,'--check','--root',fixture],{encoding:'utf8'});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
try{
  fs.writeFileSync(path.join(fixture,'alpha.txt'),'authoritative source\n');
  fs.writeFileSync(path.join(fixture,'SOURCE_INTEGRITY_SHA256.txt'),`${digest('authoritative source\n')}  alpha.txt\n`);
  assert.strictEqual(checkFixture().status,0,'a valid extracted source tree was rejected');

  fs.writeFileSync(path.join(fixture,'undeclared.txt'),'must fail\n');
  let rejected=checkFixture();
  assert.notStrictEqual(rejected.status,0,'an undeclared archive file bypassed the source policy');
  assert((rejected.stdout+rejected.stderr).includes('Files missing from source manifest'));
  fs.unlinkSync(path.join(fixture,'undeclared.txt'));

  fs.writeFileSync(path.join(fixture,'alpha.txt'),'tampered source\n');
  rejected=checkFixture();
  assert.notStrictEqual(rejected.status,0,'a SHA-256 mismatch was accepted');
  assert((rejected.stdout+rejected.stderr).includes('SHA-256 mismatch'));
  fs.writeFileSync(path.join(fixture,'alpha.txt'),'authoritative source\n');

  fs.symlinkSync('missing-target',path.join(fixture,'broken-link'));
  rejected=checkFixture();
  assert.notStrictEqual(rejected.status,0,'a broken symlink bypassed archive integrity');
  assert((rejected.stdout+rejected.stderr).includes('Symlink source entries are forbidden'));
}finally{
  fs.rmSync(fixture,{recursive:true,force:true});
}
console.log('BUILD305.1 deterministic source integrity: PASS');
