#!/usr/bin/env python3
"""Verify the current 340 source from the pinned Build 335 RC1 clean-source lineage; never an IPA as development source."""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path,PurePosixPath

RUNTIME_DIRS=('WebApp','iOS')
ROOT_FILES=('project.yml','BUILD','VERSION')
RETIRED=('repack_ipa.py','build_release_archives.py','build334_release_common.py','verify_build333.py')

def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def inventory(root:Path)->dict:
    files={}
    for folder in RUNTIME_DIRS:
        base=root/folder
        if base.is_symlink() or not base.is_dir():raise ValueError(f'Missing or linked source directory: {folder}')
        for p in sorted(base.rglob('*')):
            if p.is_symlink():raise ValueError(f'Source symlink: {p}')
            if p.is_file():files[p.relative_to(root).as_posix()]={'bytes':p.stat().st_size,'sha256':digest(p)}
    for rel in ROOT_FILES:
        p=root/rel
        if p.is_symlink() or not p.is_file():raise ValueError(f'Missing or linked root source file: {rel}')
        files[rel]={'bytes':p.stat().st_size,'sha256':digest(p)}
    return files

def tree_digest(files:dict)->str:
    return hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def verify(root:Path,release:bool=False)->dict:
    manifest=json.loads((root/'RUNTIME_SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
    if (manifest.get('version'),manifest.get('build'),manifest.get('save_schema'))!=('3.0.0',340,'2.0.0'):raise ValueError('Incorrect source metadata')
    expected=manifest['files']
    for name in expected:
        p=PurePosixPath(name)
        if not name or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:raise ValueError('Unsafe manifest path')
    actual=inventory(root)
    if set(actual)!=set(expected):raise ValueError(f'Source file-set mismatch: missing={sorted(set(expected)-set(actual))}; extra={sorted(set(actual)-set(expected))}')
    for name,row in actual.items():
        if row!=expected[name]:raise ValueError(f'Source byte mismatch: {name}')
    sha=tree_digest(actual)
    if sha!=manifest.get('source_tree_sha256'):raise ValueError('Source tree digest mismatch')
    if (root/'BUILD').read_text().strip()!='340' or (root/'VERSION').read_text().strip()!='3.0.0':raise ValueError('BUILD/VERSION mismatch')
    project=(root/'project.yml').read_text()
    for key,value in [('CURRENT_PROJECT_VERSION','340'),('CFBundleVersion','340'),('MARKETING_VERSION','3.0.0'),('CFBundleShortVersionString','3.0.0')]:
        if not re.search(r'(?m)^\s*'+key+r':\s*[\"\x27]?'+re.escape(value)+r'[\"\x27]?\s*$',project):raise ValueError(f'Native project metadata mismatch: {key}')
    for name in RETIRED:
        if (root/'tools'/name).exists():raise ValueError(f'Retired IPA-based tool present: {name}')
    gate=json.loads((root/'RELEASE_GATE.json').read_text())
    if release and (gate.get('approved') is not True or gate.get('blocking_issues') or gate.get('source_tree_sha256')!=sha):raise ValueError('IPA release gate is closed; source verification is not device approval')
    return {'verified':True,'files':len(actual),'source_tree_sha256':sha,'version':'3.0.0','build':340,'save_schema':'2.0.0','release_approved':gate.get('approved') is True,'blocking_issues':gate.get('blocking_issues',[])}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--release',action='store_true');a=p.parse_args()
    try:print(json.dumps(verify(a.root.resolve(),a.release),ensure_ascii=False,indent=2))
    except Exception as e:raise SystemExit(f'SOURCE VERIFICATION FAILED: {e}')
