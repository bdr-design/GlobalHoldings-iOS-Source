'use strict';
// Build 372: STORE.materialize (every draft and receipt of a dispatch batch, five per asset) defined each field with
// Object.defineProperty; it now assigns it, except for a key Object.prototype has (__proto__ would set the prototype, an
// inherited accessor would run), which still goes through defineProperty. This gate holds, for the fleet fixture and for
// assets whose profile, binding and extras hold every key Object.prototype has (__proto__, constructor, toString...),
// integer-like keys, the empty key and unicode keys:
//   - the materialized asset has exactly the own properties of an object built with defineProperty in STORE.keys order:
//     the same keys in the same order, each a data property, writable, enumerable and configurable, with the same value;
//   - its prototype is Object.prototype (a __proto__ field is an own property, never the prototype);
//   - every value equals the asset's own, and is a copy: writing it leaves the store unchanged.
const assert=require('node:assert/strict'),path=require('node:path');
const STORE=require(path.join(__dirname,'../WebApp/fleet-store-core.js')),FIX=require('./helpers/fleet-fixture');

const prototypeKeys=Object.getOwnPropertyNames(Object.prototype);
assert.ok(prototypeKeys.includes('__proto__')&&prototypeKeys.includes('constructor'));
const nasty=[...prototypeKeys,'0','7','10','-1','1.5','','مفتاح','✈ key','__proto__x'];
const fleet=FIX.fleet(),assets=[];
for(let i=0;i<3000;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(6,'0')}`;assets.push(a);}
// Profile, binding and extras keys: the fixture's own, plus every nasty key in extras (and as nested data).
nasty.forEach((key,k)=>{const a=structuredClone(fleet[k%fleet.length]);a.id=`QA-NASTY-${k}`;Object.defineProperty(a,key,{value:{k,key,list:[k,-0,'x']},enumerable:true,writable:true,configurable:true});a.note={[key]:k};assets.push(a);});
const store=STORE.fromAssets(assets,{at:0});

let checked=0;
for(let index=0;index<store.length;index++){
  if(!STORE.isAlive(store,index))continue;
  const got=STORE.materialize(store,index),order=STORE.keys(store,index);
  assert.equal(Object.getPrototypeOf(got),Object.prototype,`row ${index}: the prototype is Object.prototype`);
  // The reference: defineProperty for every key, in materialize order (as materialize built it before).
  const reference={};for(const key of order)Object.defineProperty(reference,key,{value:got[key],writable:true,enumerable:true,configurable:true});
  assert.deepEqual(Reflect.ownKeys(got),Reflect.ownKeys(reference),`row ${index}: the same keys in the same order`);
  for(const key of Reflect.ownKeys(got)){
    const d=Object.getOwnPropertyDescriptor(got,key);
    assert.ok(d&&'value' in d&&d.writable===true&&d.enumerable===true&&d.configurable===true,`row ${index}: ${String(key)} is a plain data property`);
  }
  checked++;
}
// The nasty assets: each key is an own field with the asset's value, and a copy.
nasty.forEach((key,k)=>{
  const index=STORE.indexOf(store,`QA-NASTY-${k}`),got=STORE.materialize(store,index);
  assert.ok(Object.prototype.hasOwnProperty.call(got,key),`${JSON.stringify(key)} is an own property`);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.getOwnPropertyDescriptor(got,key).value)),{k,key,list:[k,0,'x']});
  assert.equal(Object.getPrototypeOf(got),Object.prototype);
  Object.getOwnPropertyDescriptor(got,key).value.list.push('written');got.note[key]='written';
  const again=STORE.materialize(store,index);assert.deepEqual(JSON.parse(JSON.stringify(Object.getOwnPropertyDescriptor(again,key).value.list)),[k,0,'x'],'the store is unchanged (its values are JSON copies, as before)');assert.equal(again.note[key],k);
});
console.log(JSON.stringify({ok:true,rows:checked,nastyKeys:nasty.length}));
