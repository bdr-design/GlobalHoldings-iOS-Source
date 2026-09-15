const fs=require('fs'),assert=require('assert');const index=fs.readFileSync('WebApp/index.html','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8'),diag=fs.readFileSync('WebApp/diagnostics-core.js','utf8');
for(const f of ['event-ledger-core.js','dependency-core.js','policy-core.js','lifecycle-core.js','demand-closure-core.js','integrity-core.js','procurement-core.js'])assert(index.includes(`src="${f}"`),`missing ${f} load`);
assert(!index.includes('request-core.js')&&!fs.existsSync('WebApp/request-core.js'),'removed request core must stay absent');
assert(advanced.includes('renderManualProcurement')&&advanced.includes('manualOnly'),'manual procurement owner missing');
assert(diag.includes('GH_INTEGRITY_CORE?.check'),'diagnostics not connected to business integrity');
assert(diag.includes('eventLedger'),'diagnostic export missing event ledger');

// Build247 ownership rule: market price evolution belongs to Market Core, not app/UI.
const app=fs.readFileSync('WebApp/app.js','utf8'),market=fs.readFileSync('WebApp/market-core.js','utf8');
assert(!app.includes("state.market.forEach(s=>"),'app.js still owns market price mutation');
assert(!app.includes("competitors.forEach(c=>{c.price="),'app.js still owns competitor price mutation');
assert(app.includes("'market','tick-prices'"),'simulation does not delegate market evolution to Market Core');
assert(market.includes("cmd==='tick-prices'"),'Market Core missing tick-prices command');
assert(market.includes("GH_DETERMINISM"),'Market Core price evolution is not deterministic');

console.log('Business Core Architecture Guard: PASS');
