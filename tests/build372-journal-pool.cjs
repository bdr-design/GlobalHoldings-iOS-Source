'use strict';
// Build 372: a store journal's log is sized once for a writer that knows its rows (writeRows reserves them) and an ended
// journal's log and row marks are reused by the next journal of the store (fleet-store-core releaseJournal). Reuse must
// not change what a rollback restores: over many journals on one store, alternately rolled back and committed, each with
// row writes (set, extras, replayed rows through writeRows, rows added), the store after every rollback must equal, byte
// for byte (records, values, extras, length, live), the store before that journal (its structure and revision counters
// only grow, by design); and a journal that follows a large replay must not see rows marked by the one before it.
const assert=require('node:assert/strict'),path=require('node:path');
const STORE=require(path.join(__dirname,'../WebApp/fleet-store-core.js')),FIX=require('./helpers/fleet-fixture');
const fleet=FIX.fleet(),assets=[];for(let i=0;i<40000;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;assets.push(a);}
const store=STORE.fromAssets(assets,{at:0});
const image=()=>({rows:Buffer.from(new Uint8Array(store.rows,0,store.length*STORE.STRIDE)).toString('base64'),values:JSON.stringify(store.values),extras:JSON.stringify(store.extras),length:store.length,live:store.live});
let seed=7;const random=n=>{seed=(seed*1103515245+12345)>>>0;return seed%n;};
const live=()=>{const out=[];for(let i=0;i<store.length;i++)if(STORE.isAlive(store,i))out.push(i);return out;};
let rollbacks=0,commits=0,replayed=0;
for(let round=0;round<40;round++){
  const before=image(),journal=STORE.beginJournal(store),rows=live();
  for(let k=0;k<200;k++){const index=rows[random(rows.length)];STORE.set(store,index,'condition',40+random(60));if(k%20===0)STORE.set(store,index,'note',{round,k});}
  // A replay of many rows (as the engine thread's apply writes them): their own bytes with one field changed.
  const count=round%4===0?30000:500,indices=Int32Array.from(rows.slice(0,count)),copy=STORE.readRows(store,indices),words=new Float64Array(copy.bytes);
  for(let k=0;k<count;k++)words[k*STORE.F64_PER_ROW+STORE.O.progress]=(round%10)/10;
  STORE.writeRows(store,indices,copy.bytes,copy.extras,{});replayed+=count;
  if(round%3===0)STORE.add(store,{...structuredClone(fleet[0]),id:`QA-ADD-${round}`});
  if(round%2===0){STORE.rollbackJournal(journal);rollbacks++;{const after=image(),diff=Object.keys(before).filter(key=>before[key]!==after[key]);assert.deepEqual(diff,[],`round ${round}: the rollback restores the store exactly`);}}
  else{STORE.endJournal(journal);commits++;}
}
// After a large replay ends, the next journal starts with no row marked: its first write of a row is journaled.
{const big=STORE.beginJournal(store),indices=Int32Array.from(live().slice(0,30000)),copy=STORE.readRows(store,indices);STORE.writeRows(store,indices,copy.bytes,copy.extras,{});STORE.endJournal(big);
 const before=image(),next=STORE.beginJournal(store);for(const index of live().slice(0,30000).filter((_,k)=>k%97===0))STORE.set(store,index,'condition',11);STORE.rollbackJournal(next);
 assert.deepEqual(image(),before,'rows written by an earlier journal are journaled again by the next one');}
console.log(JSON.stringify({ok:true,rounds:40,rollbacks,commits,replayed}));
