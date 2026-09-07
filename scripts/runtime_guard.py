#!/usr/bin/env python3
"""One runtime inventory for source, Native installer, .app and final IPA."""
import argparse, hashlib, json, re, sys, zipfile
from pathlib import Path, PurePosixPath

FORMAT = 'gh-runtime-required-v1'
def safe_path(name):
    return bool(name) and '\\' not in name and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/'))

def inventory(root):
    root=Path(root)
    if not root.is_dir(): raise ValueError('Runtime directory missing')
    result={}
    for p in root.rglob('*'):
        if p.is_symlink(): raise ValueError('Runtime symlink: '+str(p))
        if p.is_file(): result[p.relative_to(root).as_posix()]=p.read_bytes()
    return result

def validate(root):
    data=inventory(root)
    manifest=json.loads(data.get('runtime-required.json',b'null'))
    if not isinstance(manifest,dict) or manifest.get('format')!=FORMAT or manifest.get('saveSchemaVersion')!='2.0.0' or type(manifest.get('minimumNativeBuild')) is not int or manifest['minimumNativeBuild']<251: raise ValueError('Invalid runtime manifest')
    names=manifest.get('files')
    if not isinstance(names,list) or not names or any(not isinstance(n,str) or not safe_path(n) for n in names) or len(names)!=len(set(names)): raise ValueError('Invalid or duplicate runtime path')
    if set(names)!=set(data): raise ValueError('Runtime file set mismatch: missing='+str(sorted(set(names)-set(data)))+' extra='+str(sorted(set(data)-set(names))))
    if any(not content for content in data.values()): raise ValueError('Empty runtime file')
    html=data['index.html'].decode()
    refs=re.findall(r'<(?:script|link)\b[^>]*?\b(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"',html,re.I)
    local=[x for x in refs if not re.match(r'\w+:|//',x)]
    if len(local)!=len(set(local)): raise ValueError('Duplicate runtime script/style reference')
    if any(x not in data for x in local): raise ValueError('Missing index dependency')
    scripts=re.findall(r'<script\b[^>]*src="([^"]+)"',html,re.I)
    order=['transaction-core.js','domain-command-core.js','finance-core.js','hr-core.js','fleet-core.js','corporate-core.js','control-plane-core.js','map-provider-core.js','app.js']
    if any(x not in scripts for x in order) or sorted(scripts.index(x) for x in order)!=[scripts.index(x) for x in order]: raise ValueError('Unsafe domain registration/bootstrap order')
    if 'Content-Security-Policy' not in html or "object-src 'none'" not in html or "'unsafe-eval'" in html: raise ValueError('Unsafe runtime CSP')
    for tag in re.findall(r'<(?:script|link)\b[^>]*https://[^>]*>',html):
        if 'integrity="sha256-' not in tag or 'crossorigin="anonymous"' not in tag: raise ValueError('Unpinned external script/style')
    return data

def compare(expected,actual,label):
    if set(expected)!=set(actual): raise ValueError(label+' file set mismatch: missing='+str(sorted(set(expected)-set(actual)))+' extra='+str(sorted(set(actual)-set(expected))))
    for name in expected:
        if hashlib.sha256(expected[name]).digest()!=hashlib.sha256(actual[name]).digest(): raise ValueError(label+' hash mismatch: '+name)

def ipa_inventory(path):
    prefix='Payload/GlobalHoldings.app/WebApp/'
    with zipfile.ZipFile(path) as z:
        entries=[i for i in z.infolist() if not i.is_dir()]
        names=[i.filename for i in entries]
        if len(names)!=len(set(names)) or any(not safe_path(n) for n in names): raise ValueError('Unsafe or duplicate IPA entries')
        if any((i.external_attr>>16)&0o170000==0o120000 for i in entries if i.filename.startswith(prefix)): raise ValueError('Runtime symlink in IPA')
        if z.testzip(): raise ValueError('Corrupt IPA container')
        for name in ['Payload/GlobalHoldings.app/GlobalHoldings','Payload/GlobalHoldings.app/Info.plist']:
            if name not in names or not z.read(name): raise ValueError('Missing IPA executable/metadata')
        return {i.filename[len(prefix):]:z.read(i) for i in entries if i.filename.startswith(prefix)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]/'WebApp');parser.add_argument('--compare',type=Path);parser.add_argument('--ipa',type=Path);a=parser.parse_args()
    try:
        source=validate(a.root)
        if a.compare: compare(source,inventory(a.compare),'Built .app WebApp')
        if a.ipa: compare(source,ipa_inventory(a.ipa),'Final IPA WebApp')
        print('RUNTIME EXACT FILE/HASH GUARD: PASS ('+str(len(source))+' files)')
    except Exception as e: print('RUNTIME GUARD: FAIL: '+str(e),file=sys.stderr);return 1
    return 0
if __name__=='__main__': sys.exit(main())
