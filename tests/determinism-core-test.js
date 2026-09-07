const assert=require('assert');const d=require('../WebApp/determinism-core.js');
const a={},b={};d.ensure(a);d.ensure(b);assert.strictEqual(d.nextFloat(a,'market'),d.nextFloat(b,'market'));assert.strictEqual(d.nextId(a,'EV'),'EV-00000001');assert.strictEqual(d.nextId(a,'EV'),'EV-00000002');
const saved=JSON.parse(JSON.stringify(a));assert.strictEqual(d.nextFloat(a,'market'),d.nextFloat(saved,'market'));
console.log('Determinism core: PASS');
