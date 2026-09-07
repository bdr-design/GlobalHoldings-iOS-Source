'use strict';
const assert=require('assert'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const schema=require(path.join(ROOT,'WebApp','save-schema.js'));
const legacy={saveVersion:'2.0.0',saveRevision:0,simSeconds:0,assets:[],market:[],finance:{invoices:[],cheques:[],payables:[],receivables:[],periods:[],journalEntries:[]},companyFinance:{},advanced:{}};assert.equal(schema.validate(legacy).ok,true,'legacy Save Schema 2.0.0 without controlPlane must remain compatible');
const good={saveVersion:'2.0.0',saveRevision:1,simSeconds:0,assets:[],market:[],finance:{invoices:[],cheques:[],payables:[],receivables:[],periods:[],journalEntries:[]},companyFinance:{},advanced:{},controlPlane:{schema:'gh-control-plane-v1',revision:1,commandSequence:1,eventSequence:1,incidentSequence:0,outboxSequence:1,events:[{id:'CPE-000000001',sequence:1,hash:'a'.repeat(64),previousHash:'0'.repeat(64)}],commands:[{id:'CMD-000000001'}],incidents:[],outbox:[{id:'OUT-00000001',eventId:'CPE-000000001',delivered:false}],blackBox:[],registry:{engines:{},links:[]},journalHeadHash:'a'.repeat(64)}};
assert.equal(schema.validate(good).ok,true,JSON.stringify(schema.validate(good)));
const bad=JSON.parse(JSON.stringify(good));bad.controlPlane.outbox[0].eventId='CPE-MISSING';const result=schema.validate(bad);assert.equal(result.ok,false);assert(result.errors.includes('control-plane-outbox-reference'));
console.log('control-plane-save-schema-build243-test: PASS');
