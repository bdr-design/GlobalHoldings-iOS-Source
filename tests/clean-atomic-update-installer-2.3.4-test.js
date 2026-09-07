const fs=require('fs');
const assert=(x,m)=>{if(!x)throw new Error(m)};
const storage=fs.readFileSync('iOS/GlobalHoldings/GlobalGameStorage.swift','utf8');
const controller=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
const app=fs.readFileSync('WebApp/app.js','utf8');
const advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
const builder=fs.readFileSync('scripts/build_update.py','utf8');
for(const token of [
  'clean-snapshot-v1','Always start from an empty staging directory','validateExactSnapshot',
  'confirmCurrentUpdateBoot','recoverUnconfirmedUpdateIfNeeded','GlobalHoldingsPendingContentBootVersion',
  'WebApp.previous','WebApp.staging','clearPendingBootMarker','Overlay القديمة مرفوضة'
])assert(storage.includes(token),`Missing clean atomic installer token: ${token}`);
assert(!/copyItem\(at: webURL, to: stagingWebURL\)/.test(storage),'Installer must never copy current WebApp into staging');
assert(controller.includes('case "confirmUpdateBoot"')&&controller.includes('confirmNativeUpdateBoot'),'Native boot confirmation bridge is missing');
assert(app.includes("action:'confirmUpdateBoot'")&&app.includes('UPDATE_BOOT_CONFIRM_REQUEST'),'WebApp does not confirm a completed bootstrap');
assert(advanced.includes("installMode!=='clean-snapshot-v1'"),'Web validator does not reject overlay updates early');
assert(builder.includes("'installMode':'clean-snapshot-v1'")&&builder.includes("'signaturePayloadVersion':2"),'Update builder is not emitting signed clean snapshots');
console.log('Clean Atomic Update Installer 2.3.9: PASS');
