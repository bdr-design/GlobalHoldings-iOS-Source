'use strict';
const assert = require('assert');
const fs = require('fs');
const {scenario} = require('./helpers/business-scenario.js');

// 1) كل أمر ناجح يُسجَّل تلقائيًا في domainRuntime.commands من الموزّع المركزي نفسه،
// دون أن يحتاج أي قسم لتذكّر تسجيل نفسه بشكل منفصل.
(function everyCommandIsLogged(){
  const s = scenario();
  const {state, command} = s;
  command('corporate','open-company',{type:'air',capital:300000000,legalName:'Test Air'});
  command('hr','hire',{company:'air',source:'test'});
  const log = state.domainRuntime.commands;
  assert(log.length>=2,'every successful domain command must be recorded automatically');
  assert(log.some(r=>r.domain==='corporate'&&r.name==='open-company'&&r.status==='committed'));
  assert(log.some(r=>r.domain==='hr'&&r.name==='hire'&&r.status==='committed'));
  for(const row of log){
    assert('domain' in row && 'name' in row && 'status' in row && 'actor' in row && 'at' in row,'each logged row must carry enough fields to distinguish what ran, by whom, and whether it succeeded');
  }
})();

// 2) الواجهة يجب أن تعرض فعليًا هذا السجل الموحد (لا يبقى محفوظًا دون عرض كما كان قبل هذا الإصلاح).
(function unifiedLogSurfacedInUI(){
  const adv = fs.readFileSync(require('path').join(__dirname,'..','WebApp','advanced-core.js'),'utf8');
  assert(adv.includes('function renderUnifiedOperationsLog'),'a render function for the unified operations log must exist');
  assert(adv.includes('ctx.state.domainRuntime?.commands'),'it must read from the real, automatically-populated domainRuntime.commands log');
  assert(adv.includes('renderUnifiedOperationsLog(ctx)'),'it must actually be called and rendered, not just defined');
  assert(adv.includes("r.status==='committed'?'نُفِّذ · لا يتطلب موافقة'"),'it must distinguish logging vs approval vs execution vs failure per item 6 of the spec');
})();

console.log('Unified operations log (item 6) BUILD265: PASS');
