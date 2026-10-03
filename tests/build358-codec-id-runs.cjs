'use strict';
// Build 358 (million-asset save, step 4a): crew contracts, the hiring log and delivery receipts carry one id per
// purchased asset (assetIds), so a save of a million assets holds millions of id strings. GH_STATE_CODEC stores an
// array of 64+ ids `prefix + digits` with consecutive numbers as [-3, prefix, width, first, count] (inside collections
// and at meta.runPaths elsewhere). This proves the encoding is exact on every edge, keeps
// serialize() === JSON.stringify(encodeState()), marks such saves gh-shape-2 (which earlier decoders refuse), and
// rejects malformed runs; then measures a real game save.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js'));
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}
const seq=(prefix,first,count,width=0)=>Array.from({length:count},(_,i)=>prefix+(width?String(first+i).padStart(width,'0'):String(first+i)));
function exact(label,state){
  const text=CODEC.serialize(state);assert.equal(text,JSON.stringify(CODEC.encodeState(state)),`${label}: serialize equals encodeState`);
  assert.equal(JSON.stringify(CODEC.deserialize(text)),JSON.stringify(state),`${label}: round trip is exact`);
  return JSON.parse(text);
}

test('runs at run paths and inside collections round-trip exactly',()=>{
  const state={advanced:{labor:{employmentContracts:[{id:'E1',assetIds:seq('N-AIR-',1,3000,8)},{id:'E2',assetIds:seq('N-SEA-',41,64,8)}],hiringLog:[{id:'H1',assetIds:seq('GH ROAD ',7,500)}]}},
    realism:{procurement:{deliveries:Array.from({length:70},(_,i)=>({id:`D${i}`,assetIds:seq(`N-R${i}-`,1,100,5)}))}}};
  const tree=exact('mixed',state),meta=tree.stateCodec;
  assert.equal(meta.version,'gh-shape-2');assert.equal(meta.runPaths.length,3,'three run paths outside collections');
  const text=JSON.stringify(tree);assert(text.length<JSON.stringify(state).length/20,'ids shrink by far');
  return {raw:JSON.stringify(state).length,saved:text.length,runPaths:meta.runPaths.length};
});
test('edges: width overflow, uint32 limit, digit-ending prefixes, long digit runs, short and broken arrays',()=>{
  const cases={
    widthOverflow:seq('X-',40,100,2),                 // X-40 .. X-139: padding width 2 is outgrown
    unpaddedGrowth:seq('Y',1,120),                     // Y1 .. Y120
    uintEdge:seq('Z',0xFFFFFFFF-63,64),                // last 64 numbers below 2^32
    beyondUint:seq('Z',0xFFFFFFFF-62,64),             // crosses 2^32: must stay raw
    prefixDigit:seq('A1-',5,80),                      // prefix contains digits
    longDigits:Array.from({length:70},(_,i)=>`L${String(12345678901+i)}`),  // 11-digit tails: prefix 'L1' + 10 digits
    short:seq('S',1,63),                              // below the run minimum
    broken:[...seq('B',1,70),'B999'],                 // one element out of sequence
    gapped:seq('G',1,70).filter((_,i)=>i!==30),
    mixedTypes:[...seq('M',1,70),7],
    zeroPaddedStart:seq('P',0,90,3),
    leadingZeroUnpadded:['Q0',...seq('Q',1,80)]
  };
  const tree=exact('edges',{cases}),runs=(tree.stateCodec.runPaths||[]).map(p=>p.at(-1)).sort();
  assert.deepEqual(runs,['leadingZeroUnpadded','longDigits','prefixDigit','uintEdge','unpaddedGrowth','widthOverflow','zeroPaddedStart'].sort(),'exactly the true runs are encoded');
  return runs;
});
test('a save without runs is unchanged gh-shape-1',()=>{
  const tree=exact('no runs',{rows:Array.from({length:80},(_,i)=>({i,name:`row ${i}`})),ids:seq('S',1,10)});
  assert.equal(tree.stateCodec.version,'gh-shape-1');assert.equal(tree.stateCodec.runPaths,undefined);return tree.stateCodec.version;
});
test('malformed runs and run paths are corrupt saves',()=>{
  const good=JSON.parse(CODEC.serialize({a:{ids:seq('N',1,100)}})),errors={};
  const attempt=(label,mutate)=>{const tree=structuredClone(good);mutate(tree);try{CODEC.decodeState(tree);errors[label]='accepted';}catch(error){errors[label]=error.message;}};
  attempt('count too large',t=>{t.a.ids[4]=(1<<24)+1;});
  attempt('width too large',t=>{t.a.ids[2]=11;});
  attempt('negative first',t=>{t.a.ids[3]=-1;});
  attempt('past uint32',t=>{t.a.ids[3]=0xFFFFFFFF;});
  attempt('prefix not text',t=>{t.a.ids[1]=5;});
  attempt('run path under v1',t=>{t.stateCodec.version='gh-shape-1';});
  attempt('run path not a run',t=>{t.a.ids=['x'];});
  attempt('unknown version',t=>{t.stateCodec.version='gh-shape-9';});
  for(const [label,message] of Object.entries(errors))assert.match(message,/^state-codec-corrupt:/,`${label}: ${message}`);
  return errors;
});
test('a real game save stores its asset id lists as runs',()=>{
  const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
  const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE;e.load('migration-core');e.load('state-codec-core');
  state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;const base=state.globalBases.find(r=>r.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
  for(let order=1;order<=2;order++)TX.execute(state,{label:`runs-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:2000,manual:true,requestRef:`RUNS-${order}`,upfront:item.price*2000,totalPrice:item.price*2000,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});
  if(s.GH_FLEET_DATA.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
  const C=s.GH_STATE_CODEC,text=C.serialize(state),tree=JSON.parse(text);
  assert.equal(text,JSON.stringify(C.encodeState(state)));
  const decoded=C.deserialize(text),strip=v=>JSON.stringify({...v,fleet:null});assert.equal(strip(decoded),strip(state),'the decoded game equals the live game');
  const runPaths=(tree.stateCodec.runPaths||[]).map(p=>p.join('.'));
  for(const prefix of ['advanced.labor.employmentContracts','advanced.labor.hiringLog','realism.procurement.deliveries'])assert(runPaths.some(p=>p.startsWith(prefix)&&p.endsWith('assetIds')),`${prefix} ids are runs: ${runPaths}`);
  const lists=['employmentContracts','hiringLog'].map(k=>JSON.stringify(tree.advanced.labor[k]).length).concat([JSON.stringify(tree.realism.procurement.deliveries).length]);
  assert(lists.every(n=>n<20000),`id lists are compact: ${lists}`);
  return {runPaths:runPaths.length,listBytes:lists};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-codec-id-runs',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
