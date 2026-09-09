'use strict';
const fs=require('fs'),assert=require('assert');
const hrCore=fs.readFileSync('WebApp/hr-core.js','utf8');
const adv=fs.readFileSync('WebApp/advanced-core.js','utf8');
const {scenario}=require('./helpers/business-scenario.js');

// 1) لا وجود لأي مسار AI داخل HR Core نفسه.
assert(!hrCore.includes('aiReview')&&!hrCore.includes('aiReviews'),'HR Core must not expose any AI review mechanism');
assert(!hrCore.includes("cmd==='ai-review'"),'HR Core must not accept an ai-review command');

// 2) الواجهة: لا تبويب AI ولا زر مراجعة AI، والتوظيف مباشر فقط.
assert(!adv.includes('AI للموارد البشرية'),'HR UI must not expose an AI tab');
assert(!adv.includes("id==='hr-ai-review'"),'HR UI must not expose an AI review action');
assert(adv.includes("id==='hr-hire-all'||id==='hr-hire-company'"),'HR UI must hire directly with no approval detour');
assert(!/hr-hire-all[\s\S]{0,400}'ai','submit'/.test(adv),'manual HR hiring must not route through the AI approvals queue');

// 3) سلوكي: التوظيف اليدوي عبر أمر النطاق hr/hire ينفّذ فورًا دون طلب AI وسيط، ويسد العجز الحقيقي بالكامل.
const {s,state,ctx,command}=scenario();
command('facilities','create',{facility:{id:'B2',name:'Test hub 2',kind:'depot',company:'road',owned:true,coords:[24.6,46.7]},groupValueAdd:0});
state.advanced.facilities.B2.capacity=10;
command('corporate','open-company',{type:'road',capital:200000000,legalName:'Test Road'});
const before=s.GH_HR_CORE.snapshot(state,ctx,'road');
assert(before.facilityMissing>0,'facility must show a real, deterministic staffing gap before hiring');
const result=command('hr','hire',{company:'road',source:'manual test'});
assert.strictEqual(result.ok,true,'manual hire must execute immediately and succeed');
const after=s.GH_HR_CORE.snapshot(state,ctx,'road');
assert.strictEqual(after.facilityMissing,0,'manual hire must close the entire deterministic gap in one call');
assert(!state.advanced?.ai?.requests?.length,'no AI approval request must be created for HR hiring');

console.log('HR manual-only (no AI) BUILD258 firewall: PASS');
