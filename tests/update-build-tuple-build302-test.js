'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm'),nodeCrypto=require('crypto');

const source=fs.readFileSync('WebApp/advanced-core.js','utf8');
const context={
  console,
  crypto:nodeCrypto.webcrypto,
  TextEncoder,
  TextDecoder,
  atob:globalThis.atob,
  btoa:globalThis.btoa,
  setTimeout,
  clearTimeout,
  addEventListener:()=>{}
};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'advanced-core.js'});

const operationsJSON='[]';
const operationsSha256=nodeCrypto.createHash('sha256').update(operationsJSON).digest('hex');
function pack(version,build,payloadVersion=3){
  return {
    format:'global-holdings-update',
    manifest:{
      id:`tuple-${version}-${build}-${payloadVersion}`,
      version,
      build,
      signaturePayloadVersion:payloadVersion,
      minGameVersion:'2.9.1',
      packageType:'full-web',
      installMode:'clean-snapshot-v1',
      operationsSha256,
      fileCount:0,
      unpackedBytes:0
    },
    operationsJSON
  };
}

async function rejects(value,options,pattern){
  await assert.rejects(()=>context.GH_ADVANCED.validateUpdatePack(value,options),pattern);
}

(async()=>{
  await context.GH_ADVANCED.validateUpdatePack(pack('3.0.0',304),{currentBuild:303});
  await rejects(pack('3.0.0',303),{currentBuild:303},/Downgrade|إعادة التثبيت/);
  await rejects(pack('3.0.0',302),{currentBuild:303},/Downgrade|إعادة التثبيت/);
  await rejects(pack('3.0.0',999,2),{currentBuild:303},/Downgrade|إعادة التثبيت/);
  await context.GH_ADVANCED.validateUpdatePack(pack('3.1.0',0,2),{currentBuild:303});
  await context.GH_ADVANCED.validateUpdatePack(pack('3.0.0',303),{currentBuild:303,postInstall:true});
  await rejects(pack('3.0.0',304),{currentBuild:303,postInstall:true},/لا تطابق Runtime/);

  const swift=fs.readFileSync('iOS/GlobalHoldings/GlobalGameStorage.swift','utf8');
  const controller=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
  const signer=fs.readFileSync('scripts/update_signing.py','utf8');
  assert(swift.includes('gh-update-signature-v3')&&swift.includes('String(build), minimum, packageType, installMode'));
  assert(swift.includes('oldBuild: Int?')&&swift.includes('newBuild: Int?')&&swift.includes('targetBuild <= installedBuild'));
  assert(controller.includes("build:\\(build),saveJSON:save")&&controller.includes('updateStateCommittedIdentity'));
  assert(signer.includes("'gh-update-signature-v3'")&&signer.includes("str(manifest.get('build',''))"));
  console.log('Update semantic-version/build tuple Build303: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
