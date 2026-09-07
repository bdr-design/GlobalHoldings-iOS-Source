'use strict';
const {spawnSync}=require('child_process'),assert=require('assert');
const result=spawnSync('python3',['-'],{encoding:'utf8',input:String.raw`
from pathlib import Path
import tempfile, shutil, sys, zipfile
sys.path.insert(0,str(Path('scripts').resolve()))
from runtime_guard import validate, inventory, compare, ipa_inventory
source=validate(Path('WebApp'))
def rejected(fn):
    try: fn()
    except ValueError: return
    raise AssertionError('Unsafe runtime unexpectedly accepted')
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);dst=root/'WebApp';shutil.copytree('WebApp',dst)
    compare(source,inventory(dst),'Copy')
    (dst/'finance-core.js').unlink();rejected(lambda:validate(dst));shutil.copy('WebApp/finance-core.js',dst/'finance-core.js')
    (dst/'unexpected.js').write_text('evil');rejected(lambda:validate(dst));(dst/'unexpected.js').unlink()
    (dst/'finance-core.js').write_text('corrupted');rejected(lambda:compare(source,inventory(dst),'Copy'))
    for fault in ['none','missing','extra','hash','duplicate']:
        ipa=root/(fault+'.ipa')
        with zipfile.ZipFile(ipa,'w') as z:
            z.writestr('Payload/GlobalHoldings.app/GlobalHoldings',b'test-executable');z.writestr('Payload/GlobalHoldings.app/Info.plist',b'test-metadata')
            for name,data in source.items():
                if fault=='missing' and name=='finance-core.js': continue
                z.writestr('Payload/GlobalHoldings.app/WebApp/'+name,b'bad' if fault=='hash' and name=='finance-core.js' else data)
            if fault in ['extra','duplicate']:z.writestr('Payload/GlobalHoldings.app/WebApp/'+('extra.js' if fault=='extra' else 'finance-core.js'),b'bad')
        if fault=='none':compare(source,ipa_inventory(ipa),'Fixture IPA')
        else:rejected(lambda:compare(source,ipa_inventory(ipa),'Fixture IPA'))
print('Runtime and IPA verifier fault injection: PASS (valid/missing/extra/hash/duplicate)')
`});assert.strictEqual(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim());
