const fs=require('fs'),assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const app=read('WebApp/app.js'),index=read('WebApp/index.html'),tx=read('WebApp/transaction-core.js'),sim=read('WebApp/simulation-core.js'),swift=read('iOS/GlobalHoldings/GameViewController.swift'),storage=read('iOS/GlobalHoldings/GlobalGameStorage.swift'),vault=read('iOS/GlobalHoldings/GlobalSaveVault.swift');
assert(index.includes('save-schema.js')&&index.includes('determinism-core.js')&&index.includes('diagnostics-core.js'));
assert(app.includes('processOneRecoveryBoundary')&&app.includes('Non-sequential financial boundary')&&app.includes('Non-sequential market boundary'));
assert(!/Math\.random\s*\(/.test([app,read('WebApp/advanced-core.js')].join('\n')),'simulation/business randomness must be deterministic');
assert(!/catch\s*\{\s*\}/.test([app,read('WebApp/advanced-core.js'),read('WebApp/realism-core.js')].join('\n')),'silent catch forbidden');
assert(app.includes('state.simulationWorld.competitors')&&app.includes('state.simulationWorld.competitorAssets'));
assert(tx.includes('Nested state transactions are forbidden')&&tx.includes('restoreValue')&&tx.includes('afterCommit'));
assert(sim.includes("governor:'GREEN'")&&sim.includes("governor==='RED'"));
assert(sim.includes('Object.freeze([0,1,2,4])'),'multiplier speed set missing');
assert(!app.includes('1 دقيقة/ث')&&!app.includes('1 ساعة/ث'),'legacy wall-rate speed labels returned');
assert(app.includes('const SAFE_SPEED_VALUES=[0,1,2,4]'),'app speed values do not match core');
assert(swift.includes('webViewWebContentProcessDidTerminate')&&swift.includes('saveBridge')&&swift.includes('bootstrapJavaScript(force: true, pause: true)'));
assert(vault.includes('save-A')===false); // slot names are generated, not hard-coded single authority
assert(vault.includes('Envelope')&&vault.includes('.atomic')&&vault.includes('currentGeneration'));
assert(storage.includes('Curve25519.Signing.PublicKey')&&storage.includes('isValidSignature')&&storage.includes('gh-primary-2026'));
for(const legacy of ['processTick','simulationBacklogSeconds','advanceSimulationChronologically','processSimulationSlice'])assert(!app.includes(legacy),`legacy path returned: ${legacy}`);
console.log('Defensive baseline 2.3.9 timing guard: PASS');
