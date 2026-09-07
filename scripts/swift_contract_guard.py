#!/usr/bin/env python3
from pathlib import Path
import re, sys
root=Path(__file__).resolve().parents[1]
files={
 'storage':root/'iOS/GlobalHoldings/GlobalGameStorage.swift',
 'vault':root/'iOS/GlobalHoldings/GlobalSaveVault.swift',
 'gvc':root/'iOS/GlobalHoldings/GameViewController.swift',
}
texts={k:p.read_text(encoding='utf-8') for k,p in files.items()}
errors=[]

def defs(text):
    return re.findall(r'^\s*(?:@discardableResult\s*)?(?:(?:private|fileprivate|internal|public|open)\s+)?func\s+(\w+)\s*\(',text,re.M)
for name in ['storage','vault']:
    ds=defs(texts[name])
    dup=sorted({x for x in ds if ds.count(x)>1})
    if dup: errors.append(f'{name}: duplicate method definitions: {dup}')

storage_defs=set(defs(texts['storage'])); vault_defs=set(defs(texts['vault']))
for call in sorted(set(re.findall(r'GlobalGameStorage\.shared\.(\w+)\s*\(',texts['gvc']))):
    if call not in storage_defs: errors.append(f'GameViewController calls undefined GlobalGameStorage.{call}()')
for call in sorted(set(re.findall(r'GlobalSaveVault\.shared\.(\w+)\s*\(',texts['gvc']+texts['storage']))):
    if call not in vault_defs: errors.append(f'Native code calls undefined GlobalSaveVault.{call}()')

storage=texts['storage']; vault=texts['vault']; gvc=texts['gvc']
required_storage=['apply','writeUpdateJournal','advanceUpdateJournal','markUpdateStateCommitted','confirmCurrentUpdateBoot','rollbackPendingUpdate','recoverUnconfirmedUpdateIfNeeded','rollbackJournalLocked','finishCommittedJournalHousekeeping']
for fn in required_storage:
    if fn not in storage_defs: errors.append(f'missing update-state method: {fn}')
required_vault=['commit','commitAsync','pinRollbackCheckpoint','rollbackCheckpointSnapshot','restoreRollbackCheckpoint','resetToAsync','bootstrapJavaScript']
for fn in required_vault:
    if fn not in vault_defs: errors.append(f'missing save-vault method: {fn}')

# Crash-order invariants in the single installer owner.
a=storage.find('private func apply(_ update: ParsedUpdate')
b=storage.find('private func readUpdateJournal',a)
apply=storage[a:b] if a>=0 and b>a else ''
def order(*tokens):
    pos=[apply.find(t) for t in tokens]
    return all(x>=0 for x in pos) and pos==sorted(pos)
if not order('stage: "PREPARED"','writeUpdateJournal(journal)','pinRollbackCheckpoint','advanceUpdateJournal(stage: "STAGED")','advanceUpdateJournal(stage: "SWAP_STARTED")','moveItem(at: webURL, to: previousWebURL)','moveItem(at: stagingWebURL, to: webURL)','advanceUpdateJournal(stage: "RUNTIME_SWAPPED")'):
    errors.append('installer crash-order invariant violated')
if 'clean-snapshot-v1' not in apply and 'clean-snapshot-v1' not in storage: errors.append('native clean-snapshot contract missing')
if 'restoreRollbackCheckpoint(expectedRuntimeVersion: journal.oldVersion)' not in storage: errors.append('journal rollback does not prefer pinned runtime/save checkpoint')
if 'journal.stage == "COMMITTED"' not in storage or 'finishCommittedJournalHousekeeping(journal)' not in storage: errors.append('COMMITTED crash housekeeping contract missing')
if 'updateStateCommittedVersion' not in gvc or 'updateBootConfirmedVersion' not in gvc or 'tryFinalizeNativeUpdate' not in gvc: errors.append('two-gate update finalization missing')
if re.search(r'\.finally\s*\([\s\S]{0,220}success\s*:\s*true',gvc): errors.append('success:true is emitted from finally')
if 'saveRevision' not in vault or 'nativeRevision>currentRevision' not in vault: errors.append('monotonic save revision stale-write guard missing')

if errors:
    print('SWIFT/NATIVE CONTRACT GUARD: FAIL')
    for e in errors: print(' -',e)
    sys.exit(1)
print('SWIFT/NATIVE CONTRACT GUARD: PASS')
