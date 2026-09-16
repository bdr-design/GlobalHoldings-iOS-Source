const fs=require('fs'),assert=require('assert');
const realism=fs.readFileSync('WebApp/realism-core.js','utf8'),app=fs.readFileSync('WebApp/app.js','utf8');
assert(realism.includes("const DELIVERY_WINDOW_SECONDS=Object.freeze({air:90,sea:150,road:60})"),'delivery SLA window mismatch');
assert(app.includes("baseWindow=type==='air'?90:type==='sea'?150:60"),'purchase delivery SLA mismatch');
assert(!realism.includes('recoveredBaseId'),'silent delivery rebase must be removed');
assert(realism.includes('approved-destination-missing-or-full'),'exact destination blocking reason missing');
assert(app.includes('manualPurchaseFromCard')&&app.includes('baseId=card?.querySelector'),'manual purchase must pin an explicit delivery destination');
assert(app.includes('purchase-assets')&&app.includes('leadSeconds'),'procurement delivery contract must retain destination and SLA');
console.log('Delivery Destination Build245: PASS');
