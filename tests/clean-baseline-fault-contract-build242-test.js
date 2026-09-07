const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('WebApp/app.js'),adv=read('WebApp/advanced-core.js'),req=read('WebApp/request-core.js'),closure=read('WebApp/demand-closure-core.js'),game=read('WebApp/game-lifecycle-core.js');
const storage=read('iOS/GlobalHoldings/GlobalGameStorage.swift'),vault=read('iOS/GlobalHoldings/GlobalSaveVault.swift'),gvc=read('iOS/GlobalHoldings/GameViewController.swift');
const schema=require(path.join(root,'WebApp/save-schema.js'));

// Crash recovery: every runtime mutation path is journaled before Current moves.
for(const marker of ['BUNDLED-','RESTORE-','stage: "PREPARED"','"SWAP_STARTED"','"STATE_COMMITTED"']) assert(storage.includes(marker),`missing journal marker ${marker}`);
assert(storage.indexOf('removeItem(at: previousWebURL)') < storage.indexOf('advanceUpdateJournal(stage: "SWAP_STARTED")'),'stale rollback runtime can survive into SWAP_STARTED');
assert(storage.includes('restoreRollbackCheckpoint(expectedRuntimeVersion: journal.oldVersion)'),'rollback must restore the independently pinned old runtime/save pair');
assert(gvc.includes('captureVerifiedPreUpdateCheckpoint'),'manual restore/update must checkpoint freshest browser state');

// Vault serialization/reset epochs.
assert(vault.includes('private func commitLocked'),'vault needs one serialized write owner');
assert(vault.includes('queue.sync { try commitLocked'),'synchronous vault writes must serialize');
assert(vault.includes('resetEpoch')&&vault.includes('nativeReset>currentReset'),'reset epoch must dominate simSeconds during recovery');
assert(vault.includes('resetToAsync')&&vault.match(/commitLocked\(json[\s\S]*commitLocked\(json/),'reset must overwrite both authoritative A/B slots');

// Boot gate and update ownership.
assert(app.includes('UPDATE_BOOT_SCHEMA_REJECTED')&&app.includes('UPDATE_BOOT_INTEGRITY_REJECTED'),'WebApp must not boot-confirm corrupt state');
assert(gvc.includes('businessIntegrity?.()'),'native operations must verify business integrity before durable commit');
assert(!adv.includes('lastBoundContext&&applyUpdateOperations'),'WebApp update event must not be a second operations owner');

// Deterministic AI: no wall-clock business cadence in executive paths.
const proactive=adv.slice(adv.indexOf('function proactiveReview'),adv.indexOf('function renderAI'));
assert(!proactive.includes('Date.now')&&!proactive.includes('setInterval'),'executive AI review must be simulation-time only');
assert(!req.includes('Date.now')&&!closure.includes('Date.now'),'request/demand closure business state must not depend on wall clock');
assert(app.includes('proactiveReview(advCtx,true,null,hour)'),'AI hourly owner must be simulation market-hour boundary');

// Scalable trip accounting: no per-trip finance-document explosion.
assert(!app.includes('فاتورة رحلة ${asset.name}'),'per-trip invoice creation must stay removed');
assert(app.includes('تسوية رحلات يومية')&&app.includes('tripFuelAccrued')&&app.includes('tripMaintenanceAccrued')&&app.includes('tripCountAccrued'),'daily settlement batch missing');

// Founder/legal-state sequencing regression.
assert(game.includes("'found-group'")&&read('WebApp/corporate-core.js').includes('s.companyRegistry={group:{...p.registry}}'),'Game lifecycle must atomically delegate founding legal registry to Corporate');
assert(!app.includes('state.companyRegistry={group:state.companyRegistry.group}'),'app.js must not own founding registry initialization');

// Schema contract: gross amount compatibility + budget commitments.
const minimal={saveVersion:'2.0.0',saveRevision:1,simSeconds:1,assets:[],market:[],advanced:{},companyFinance:{group:{accounts:[{balance:1}],debt:0,taxPayable:0,vat:{output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0}}},finance:{invoices:[{number:'I1',amount:115,subtotal:100,tax:15,total:115}],cheques:[],payables:[],receivables:[],periods:[],journalEntries:[]},companyBudgets:{group:{enabled:true,limit:100,spent:60,reserved:30,lines:{capex:100},spentByLine:{capex:60},reservedByLine:{capex:30}}}};
assert(schema.validate(minimal).ok,'valid gross/subtotal/VAT + reserved budget state rejected');
minimal.companyBudgets.group.reserved=50;minimal.companyBudgets.group.reservedByLine.capex=50;
assert(!schema.validate(minimal).ok,'spent + reserved budget overflow must be rejected');
console.log('Clean baseline fault-contract Build242: PASS');
