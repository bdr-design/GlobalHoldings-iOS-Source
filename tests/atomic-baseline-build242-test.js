const fs=require('fs'),path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gvc=read('iOS/GlobalHoldings/GameViewController.swift'),storage=read('iOS/GlobalHoldings/GlobalGameStorage.swift'),vault=read('iOS/GlobalHoldings/GlobalSaveVault.swift'),app=read('WebApp/app.js'),adv=read('WebApp/advanced-core.js'),schema=read('WebApp/save-schema.js'),integrity=read('WebApp/integrity-core.js'),finance=read('WebApp/finance-core.js');
assert(storage.includes('UpdateJournal')&&storage.includes('stage: "PREPARED"')&&storage.includes('"SWAP_STARTED"'),'durable update journal stages missing');
assert(storage.indexOf('stage: "PREPARED"')<storage.indexOf('fileManager.moveItem(at: webURL, to: previousWebURL)'),'journal must be written before runtime mutation');
assert(storage.includes('oldSaveGeneration')&&storage.includes('restoreRollbackCheckpoint'),'runtime/save paired rollback missing');
assert(gvc.includes('updateBootConfirmedVersion')&&gvc.includes('tryFinalizeNativeUpdate')&&!gvc.match(/case \.success\([^)]*\):[\s\S]{0,250}finalizeNativeUpdate\(version:/),'durable save must not auto-finalize before boot confirmation');
assert(gvc.includes('operationsApplyingVersion'),'native operations one-shot guard missing');
assert(vault.includes('runtimeVersion')&&vault.includes('nativeRevision')&&vault.includes('currentRevision')&&vault.includes('nativeRevision>currentRevision'),'save revision/runtime stale-overwrite guard missing');
assert(!app.includes('REALTIME_AI_REVIEW_MS')&&app.includes('proactiveReview(advCtx,true,null,hour)'),'AI must be simulation-time deterministic');
assert(!app.includes('تجميع إيرادات الرحلات ·'),'duplicate daily trip revenue document returned');
assert(app.includes('tripFuelAccrued')&&app.includes('تسوية رحلات يومية')&&app.includes('وقود رحلات يومية')&&app.includes('مخصص صيانة رحلات يومية'),'scalable daily trip settlement documentation missing');
assert((app+finance).includes('journalEntries')&&((app+finance).includes('postJournalEntry')||finance.includes('function journal(')),'balanced journal layer missing');
assert(finance.includes('spentByLine')&&finance.includes('reservedByLine')&&finance.includes('reserveBudget')&&finance.includes('lineRemaining'),'budget line commitment/reservation enforcement missing from Finance Core');
assert((app+finance).includes('vat:{output:0,input:0,creditCarry:0'),'separate VAT input/output model missing');
assert(schema.includes('journal-unbalanced')&&schema.includes('invoice-math')&&schema.includes('delivery-id'),'semantic save validation missing');
assert(integrity.includes('FINANCE_JOURNAL_UNBALANCED')&&integrity.includes('FINANCE_BUDGET_LINE_EXCEEDED'),'runtime financial invariants missing');
assert(!adv.includes("lastBoundContext&&applyUpdateOperations(pending.pack"),'duplicate WebApp update-operations owner returned');

assert(app.indexOf('let nativeSaveRequestSequence=0;') < app.indexOf('if(dedupeCustomRoutes()) save();'), 'native save request sequence must exist before migration can save');
assert(storage.indexOf('removeItem(at: previousWebURL)') < storage.indexOf('advanceUpdateJournal(stage: "SWAP_STARTED")'), 'stale previous runtime must be removed before SWAP_STARTED is journaled');
assert(storage.indexOf('advanceUpdateJournal(stage: "SWAP_STARTED")') < storage.indexOf('moveItem(at: webURL, to: previousWebURL)'), 'SWAP_STARTED must be durable before current runtime is moved');
assert(vault.includes('resetEpoch'), 'save vault must pair reset epochs with saves');
assert(vault.includes('resetToAsync'), 'native reset must replace both A/B authority slots with pristine reset saves');

assert(storage.includes('installedBundledBuildKey')&&storage.includes('buildUpgrade'),'IPA build generation must participate in clean bundled baseline promotion');
assert(storage.includes('installBundledBaseline')&&storage.includes('BUNDLED-')&&storage.includes('STATE_COMMITTED'),'bundled baseline promotion must use the same journal/boot contract');
console.log('Atomic clean baseline build 242: PASS');
