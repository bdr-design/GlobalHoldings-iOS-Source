#!/usr/bin/env python3
"""Verify a newly compiled Build345 IPA; never modify or repack an old IPA."""
from pathlib import Path
import hashlib,json,os,plistlib,struct,subprocess,sys,zipfile
from verify_current_source import verify
root=Path(__file__).resolve().parents[1]
ipa=Path(sys.argv[1]);out=Path(sys.argv[2]);evidence=out.parent
source=verify(root)
assert (source['version'],source['build'],source['save_schema'])==('3.0.3',345,'2.0.0')
manifest=json.loads((root/'RUNTIME_SOURCE_MANIFEST.json').read_text())
auth=json.loads((root/'EXPERIMENTAL_BUILD_AUTHORIZATION.json').read_text())
assert auth['test_build_authorized'] is True and auth['production_approved'] is False
assert auth['source_tree_sha256']==source['source_tree_sha256']
assert source['release_approved'] is False
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert commit==os.environ['SOURCE_COMMIT']
assert subprocess.check_output(['git','diff','--name-only','HEAD','--','WebApp','iOS','project.yml','BUILD','VERSION'],cwd=root,text=True).strip()==''
accepted=json.loads((evidence/'source-acceptance-results.json').read_text())
assert accepted['completed'] is True and accepted['all_tests_passed'] is True and accepted['runtime_unchanged'] is True
assert accepted['passed']==accepted['total'] and accepted['total']>=160
assert accepted['runtime_source']['source_tree_sha256']==source['source_tree_sha256']
assert all(t['exit_code']==0 for t in accepted['tests'])
native=json.loads((evidence/'native-tests.json').read_text())
wk=json.loads((evidence/'webkit-smoke.json').read_text())
for result,floor in [(native,43),(wk,6)]:
    assert result['failed']==0 and result['passed']==result['total'] and result['total']>=floor
prefix='Payload/GlobalHoldings.app/'
with zipfile.ZipFile(ipa) as z:
    assert z.testzip() is None
    names=z.namelist();assert len(names)==len(set(names))
    rows={r.filename:r for r in z.infolist() if not r.is_dir()}
    assert rows and all(n.startswith(prefix) for n in rows)
    info=plistlib.loads(z.read(prefix+'Info.plist'))
    assert (info['CFBundleIdentifier'],info['CFBundleShortVersionString'],info['CFBundleVersion'],info['UIDeviceFamily'])==('com.example.globalholdings','3.0.3','345',[1])
    assert info['GHSourceSnapshotSHA256']==manifest['webapp_tree_sha256']
    expected={p[7:]:r['sha256'] for p,r in manifest['files'].items() if p.startswith('WebApp/')}
    actual={p[len(prefix+'WebApp/'):]:hashlib.sha256(z.read(p)).hexdigest() for p in rows if p.startswith(prefix+'WebApp/')}
    assert actual==expected,'IPA WebApp differs from tested tracked source'
    required=json.loads(z.read(prefix+'WebApp/runtime-required.json'))
    assert all(p in actual for p in required['files'])
    assert actual['mobility-core.js']=='2ad85f60489a44a75423a75e4c7960f009be50ab443b0d99517271ee59645b9e'
    assert prefix+'Assets.car' in rows and rows[prefix+'Assets.car'].file_size>0
    assert prefix+'embedded.mobileprovision' not in rows and not any(p.startswith(prefix+'_CodeSignature/') for p in rows)
    executable=prefix+'GlobalHoldings';assert (rows[executable].external_attr>>16)&0o111
    data=z.read(executable);assert len(data)>=32
    magic,cpu,subtype,kind,count,size,flags,reserved=struct.unpack_from('<8I',data)
    assert magic==0xfeedfacf and cpu==0x0100000c and kind==2
    cursor=32;platforms=[];signatures=[]
    for _ in range(count):
        cmd,length=struct.unpack_from('<II',data,cursor)
        assert length>=8 and cursor+length<=len(data)
        if cmd==0x32:platforms.append(struct.unpack_from('<I',data,cursor+8)[0])
        if cmd==0x1d:signatures.append(cmd)
        cursor+=length
    assert 2 in platforms and not signatures
    app_hashes={p[len(prefix):]:hashlib.sha256(z.read(p)).hexdigest() for p in rows}
record={'ipa_created':True,'version':'3.0.3','build':345,'save_schema':'2.0.0','ipa_name':ipa.name,'ipa_bytes':ipa.stat().st_size,'ipa_sha256':hashlib.sha256(ipa.read_bytes()).hexdigest(),'source_tree_sha256':source['source_tree_sha256'],'webapp_tree_sha256':manifest['webapp_tree_sha256'],'source_commit':commit,'workflow_commit':os.environ['GITHUB_SHA'],'workflow_run_id':int(os.environ['GITHUB_RUN_ID']),'webapp_files':len(expected),'app_files':len(rows),'native_executable_sha256':app_hashes['GlobalHoldings'],'arm64_iphoneos':True,'unsigned':True,'old_ipa_used':False,'source_acceptance':{'passed':accepted['passed'],'total':accepted['total']},'native_tests':{'passed':native['passed'],'total':native['total']},'wkwebview_smoke':{'passed':wk['passed'],'total':wk['total'],'full_game_test':False},'experimental_test_build':True,'physical_iphone_tested':False,'strict_under_5ms_verified':False,'production_approved':False,'remaining':['Frame-drop elimination and under-5-ms maxima not verified','Resident Worker and chunked Native save work remains open','Physical iPhone field test and signing required']}
out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
(evidence/'app-file-hashes.json').write_text(json.dumps(app_hashes,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False,indent=2))
