'use strict';
// Build 372: a fleet batch command of a dispatch (500 assets and their routes) was encoded about nine times, copied
// about five times and its intent hashed twice on its way through the idempotency key, the envelope, authorize and the
// fingerprint. GH_AUTHORIZATION.seal makes one deep-frozen copy of plain JSON data and keeps its canonical text;
// stable() returns that text, the authorization path shares the sealed payload instead of copying it, and digest()
// returns the digest of a long text it has just hashed. This gate holds, on two identical worlds, one dispatching a
// plain payload and one the sealed copy of it:
//   - the idempotency key's digest, the envelope (JSON), the command's result, its idempotent replay and the whole state
//     afterwards are identical; the sealed world really reuses the text and the digest (telemetry), the plain one never;
//   - the domain owner still gets its own mutable copy; the sealed payload cannot be written;
//   - an envelope whose payload is replaced after it was built is refused (approval-intent-digest-mismatch) as before, and
//     an unsealed payload changed by its caller after the envelope was built changes nothing signed;
//   - a value that is not plain JSON data (undefined, NaN, a Date, a Map, a cycle, a getter giving another value each
//     read) is not sealed: seal returns it unchanged and every check fails exactly as for the plain value;
//   - -0, unicode text and large numbers encode the same sealed or not.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||ROOT;
const {harness,minimal}=require(path.join(ROOT,'tests/helpers/core-harness'));

function world(){
  const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core']),a=h.s,st=minimal();
  st.profile={name:'QA Holdings',founder:'QA Founder'};
  const Auth=a.GH_AUTHORIZATION,commands=a.GH_DOMAIN_COMMANDS,seen=[];
  Auth.ensurePrincipal(st,{id:'founder',legalName:'QA Founder'});Auth.createVisualSeal(st,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
  Auth.createDefaultMandate(st,{principalId:'founder',companyIds:['*'],scopes:['qa.*']});Auth.registerCommandTargetResolver('qa',()=>['group']);
  commands.register('qa',{execute(ctx,name,payload){
    if(name!=='batch')throw new Error('unknown-qa-command');
    // The owner's payload is its own copy: writing it must work and must not reach the caller's payload.
    payload.assignments.push({id:'OWNER-WRITE'});payload.routes.extra={written:true};seen.push(payload.assignments.length);
    ctx.state.qaLog=Array.isArray(ctx.state.qaLog)?ctx.state.qaLog:[];ctx.state.qaLog.push({count:payload.assignments.length-1,first:payload.assignments[0].id,routes:Object.keys(payload.routes).length});
    return payload.assignments.slice(0,-1).map(row=>({id:row.id,routeId:row.routeId,phase:'turnaround'}));
  }});
  return {a,st,Auth,commands,seen};
}
function payloadFor(seed){
  const routes={},assignments=[];
  for(let r=0;r<40;r++){const points=[];for(let k=0;k<64;k++)points.push([-180+((seed*31+r*7+k*13)%360)+k/7,((seed+r+k)%180)-90+0.125*k]);
    routes[`R-${r}@B-${r%8}`]={id:`R-${r}`,name:`مسار ${r} — Route ${r} ✈`,mode:'air',ownerCompanyId:'air',fromFacility:`B-${r%8}`,toFacility:`B-${(r+3)%8}`,route:points,fleetCapacity:4096,distanceKm:1234.5+r,zero:-0,big:2**53-1-r,flags:{exclusive:r%2===0,tags:['a','b',String(r)]}};}
  for(let i=0;i<500;i++){const r=(i*7+seed)%40;assignments.push({id:`QA-${String(seed*1000+i).padStart(7,'0')}`,routeId:`R-${r}`,baseFacility:`B-${r%8}`,phase:'turnaround',routeRef:`R-${r}@B-${r%8}`});}
  return {assignments,routes};
}
const snapshot=value=>JSON.stringify(value);

// 1. The same commands, plain and sealed.
const plain=world(),sealed=world();
const keyFor=(w,payload)=>w.Auth.digest({domain:'qa',name:'batch',payload,revision:Number(w.st.saveRevision)||0});
const runs=[];
for(const seed of [1,2,3]){
  const p=payloadFor(seed),q=sealed.Auth.seal(payloadFor(seed));
  assert.ok(sealed.Auth.isSealed(q),'a plain payload is sealed');assert.ok(Object.isFrozen(q)&&Object.isFrozen(q.assignments[0])&&Object.isFrozen(q.routes['R-0@B-0'].route[0]),'deep-frozen');
  assert.equal(sealed.Auth.stable(q),plain.Auth.stable(p),'the same canonical text');
  const kp=keyFor(plain,p),kq=keyFor(sealed,q);assert.equal(kq,kp,'the idempotency key digest');
  const key=`QA-BATCH-${seed}-${kp.slice(0,24)}`;
  const ep=plain.Auth.buildActiveEnvelope(plain.st,{domain:'qa',name:'batch',payload:p,idempotencyKey:key,actor:{principalId:'founder'}});
  const eq=sealed.Auth.buildActiveEnvelope(sealed.st,{domain:'qa',name:'batch',payload:q,idempotencyKey:key,actor:{principalId:'founder'}});
  assert.equal(snapshot(eq),snapshot(ep),'the envelope');
  const rp=plain.commands.dispatchEnvelope({state:plain.st},ep),rq=sealed.commands.dispatchEnvelope({state:sealed.st},eq);
  assert.equal(snapshot(rq),snapshot(rp),'the result');
  const again=sealed.commands.dispatchEnvelope({state:sealed.st},eq),againPlain=plain.commands.dispatchEnvelope({state:plain.st},ep);
  assert.equal(snapshot(again),snapshot(againPlain),'the idempotent replay');
  assert.equal(snapshot(sealed.st),snapshot(plain.st),`the whole state after seed ${seed}`);
  assert.equal(q.assignments.length,500,'the owner wrote its own copy, not the sealed payload');assert.equal(q.routes.extra,undefined);
  assert.throws(()=>{q.assignments.push({id:'X'});},TypeError,'a sealed payload cannot be written');assert.throws(()=>{q.routes['R-0@B-0'].name='changed';},TypeError);
  assert.equal(sealed.Auth.stable(q),plain.Auth.stable(p),'unchanged after the attempts');
  runs.push(seed);
}
assert.deepEqual(sealed.seen,plain.seen);assert.ok(sealed.seen.every(n=>n===501),'each owner wrote its copy');
const tq=sealed.Auth.sealTelemetry(),tp=plain.Auth.sealTelemetry();
assert.equal(tq.sealed,3);assert.ok(tq.textHits>=3*6,`the sealed text is reused (${tq.textHits})`);assert.ok(tq.digestHits>=3,`the intent digest is reused (${tq.digestHits})`);
assert.equal(tp.sealed,0);assert.equal(tp.textHits,0);

// 2. A payload replaced after the envelope was built is refused, sealed or not.
for(const w of [plain,sealed]){
  const p=w===sealed?w.Auth.seal(payloadFor(9)):payloadFor(9),key=`QA-TAMPER-${w===sealed?'S':'P'}`;
  const envelope=w.Auth.buildActiveEnvelope(w.st,{domain:'qa',name:'batch',payload:p,idempotencyKey:key,actor:{principalId:'founder'}});
  const forged=JSON.parse(JSON.stringify(envelope));forged.command.payload.assignments[3].routeId='R-FORGED';
  assert.throws(()=>w.commands.dispatchEnvelope({state:w.st},forged),/approval-intent-digest-mismatch/,'a changed payload is refused');
}
assert.equal(snapshot(sealed.st),snapshot(plain.st),'refused envelopes changed nothing');

// 2b. An unsealed payload is still copied into its envelope: the caller changing it afterwards changes nothing signed.
{
  const p=payloadFor(11),key='QA-LATE-WRITE',envelope=plain.Auth.buildActiveEnvelope(plain.st,{domain:'qa',name:'batch',payload:p,idempotencyKey:key,actor:{principalId:'founder'}});
  p.assignments[0].routeId='R-LATE';p.assignments.length=10;
  const out=plain.commands.dispatchEnvelope({state:plain.st},envelope);assert.equal(out.ok,true);assert.equal(out.result.length,500,'the envelope kept its own copy');assert.notEqual(out.result[0].routeId,'R-LATE');
}
// 3. What is not plain JSON data is not sealed, and fails as before.
{
  const {Auth}=sealed;class Row{constructor(){this.id='R';}}
  const cyclic={a:{}};cyclic.a.self=cyclic;
  let reads=0;const shifting={};Object.defineProperty(shifting,'value',{enumerable:true,get:()=>++reads});
  const cases=[['undefined',{a:undefined}],['nan',{a:NaN}],['date',{at:new Date(0)}],['map',{m:new Map([[1,2]])}],['cycle',cyclic],['getter',{inner:shifting}]];
  // A class instance encodes as before (stable accepts an object whose tag is Object, and the path used to copy it into a
  // plain object anyway): it is sealed, to the same text.
  {const value={rows:[new Row()]},out=Auth.seal(value);assert.ok(Auth.isSealed(out),'an instance encodes as before');assert.equal(Auth.stable(out),plain.Auth.stable(value));}
  for(const [label,value] of cases){
    const before=Auth.sealTelemetry().refused,out=Auth.seal(value);
    assert.equal(out,value,`${label}: returned unchanged`);assert.equal(Auth.isSealed(out),false);assert.equal(Auth.sealTelemetry().refused,before+1,`${label}: refused`);
    let plainError=null,sealedError=null;try{Auth.stable(value);}catch(error){plainError=error.message;}try{Auth.stable(out);}catch(error){sealedError=error.message;}
    if(label!=='getter'){assert.ok(plainError,`${label}: not encodable`);assert.equal(sealedError,plainError,`${label}: the same error`);}
  }
}
// 4. -0, unicode and large numbers.
{
  const value={z:-0,t:'نص ✈ 𝄞 "q" \\ \n',n:[2**53-1,-(2**53-1),1e-300,1.5e300],o:{b:1,a:2}},s=sealed.Auth.seal(value);
  assert.ok(sealed.Auth.isSealed(s));assert.equal(sealed.Auth.stable(s),plain.Auth.stable(value));assert.equal(sealed.Auth.digest(s),plain.Auth.digest(value));
}
console.log(JSON.stringify({ok:true,seeds:runs.length,telemetry:tq}));
