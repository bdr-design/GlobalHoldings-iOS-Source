'use strict';
const assert=require('node:assert/strict');
const GH_KERNEL=require('../WebApp/kernel-core.js');

const count=20000;
const original={assets:Array.from({length:count},(_,i)=>({id:`A-${i}`,progress:i/count,fuel:99,phase:'idle'})),events:[]};
const kernel=GH_KERNEL.fromLegacyState(original,[
  {name:'assets',path:['assets'],kind:'columns',owner:'simulation',columns:{progress:'f64',fuel:'f64',phase:'u8'},enumValues:{phase:['idle','moving']}},
  {name:'events',path:['events'],kind:'append-only',owner:'operations',cap:400}
]);
const first=kernel.incrementalFingerprint('assets');
const expectedChunks=Math.ceil(count/256);
assert.equal(kernel.fingerprintChunkCalculations(),expectedChunks);
assert.equal(kernel.incrementalFingerprint('assets'),first);
assert.equal(kernel.fingerprintChunkCalculations(),expectedChunks,'unchanged chunks must be reused');
let validatedRows=0;
kernel.addAuditor('assets',({changes,getRow})=>{
  for(const change of changes){if(change.index===undefined)continue;
    const row=getRow(change.index);assert.equal(row.id,`A-${change.index}`);validatedRows++;
  }
  return true;
});
const nativeClone=global.structuredClone;
global.structuredClone=value=>{
  if(Array.isArray(value)&&value.length===count)throw Error('auditor-materialized-entire-asset-section');
  return nativeClone(value);
};

kernel.tx({actor:'simulation',writes:['assets']},writer=>writer.updateRow('assets',1034,{progress:0.42,phase:'moving'}));
const changed=kernel.incrementalFingerprint('assets');
assert.notEqual(changed,first);
assert.equal(kernel.fingerprintChunkCalculations(),expectedChunks+1,'one row update must rehash one bounded chunk');
const preFailure=kernel.incrementalFingerprint('assets');
const calculations=kernel.fingerprintChunkCalculations();
const validatedBeforeFailure=validatedRows;
assert.throws(()=>kernel.tx({actor:'simulation',writes:['assets']},writer=>{
  writer.updateRow('assets',15000,{progress:0.2});
  throw Error('rollback');
}),/rollback/);
assert.equal(kernel.incrementalFingerprint('assets'),preFailure,'inverse journal must restore the section digest');
assert.equal(kernel.fingerprintChunkCalculations(),calculations,'rollback must restore cached untouched chunk hashes');
assert.equal(validatedRows,validatedBeforeFailure,'failed apply must not invoke a commit auditor');
global.structuredClone=nativeClone;

for(let i=0;i<401;i++)kernel.tx({actor:'operations',writes:['events']},writer=>writer.append('events',{id:`E-${i}`}));
const capped=kernel.incrementalFingerprint('events');
assert.throws(()=>kernel.tx({actor:'operations',writes:['events']},writer=>{writer.append('events',{id:'E-failed'});throw Error('cap rollback');}),/cap rollback/);
assert.equal(kernel.incrementalFingerprint('events'),capped,'cap trimming must restore dropped rows and hashes');
assert.equal(kernel.read('events')[0].id,'E-1');
console.log('Build342 incremental 20,000-row section fingerprints, one-chunk invalidation and rollback PASS');
