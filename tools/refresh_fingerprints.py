#!/usr/bin/env python3
"""Refresh project.yml / RUNTIME_SOURCE_MANIFEST / RELEASE_GATE / SOURCE_INTEGRITY fingerprints. Run from repo root."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
root=Path('.').resolve();sys.path.insert(0,str(root/'tools'))
from verify_current_source import inventory,tree_digest,digest
# 1. project.yml snapshot = digest of WebApp files (paths relative to WebApp/)
files=inventory(root);web={k[len('WebApp/'):]:v for k,v in files.items() if k.startswith('WebApp/')};web_sha=tree_digest(web)
p=root/'project.yml';text=p.read_text();text2=re.sub(r'(GHSourceSnapshotSHA256:\s*")[0-9a-f]{64}(")',r'\g<1>'+web_sha+r'\g<2>',text)
assert text2.count(web_sha)==1;p.write_text(text2)
# 2. manifest
files=inventory(root);full=tree_digest(files)
m=json.loads((root/'RUNTIME_SOURCE_MANIFEST.json').read_text());m['files']=files;m['source_tree_sha256']=full;m['webapp_tree_sha256']=web_sha
(root/'RUNTIME_SOURCE_MANIFEST.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
# 3. release gate (stays closed)
g=json.loads((root/'RELEASE_GATE.json').read_text());assert g.get('approved') is False
g['source_tree_sha256']=full;g.setdefault('source_tracking',{})['source_tree_sha256']=full
(root/'RELEASE_GATE.json').write_text(json.dumps(g,ensure_ascii=False,indent=2)+'\n')
# 4. integrity list: every line keeps its path set; new tracked files listed in argv are added
path=root/'SOURCE_INTEGRITY_SHA256.txt';rows=[l.split('  ',1) for l in path.read_text().splitlines() if l.strip()]
names=[n for _,n in rows]
for extra in sys.argv[1:]:
    if extra not in names:names.append(extra)
names=sorted(set(names))
missing=[n for n in names if not (root/n).is_file()]
if missing:raise SystemExit(f'missing files: {missing}')
path.write_text(''.join(f'{digest(root/n)}  {n}\n' for n in names))
print(json.dumps({'webapp':web_sha,'source_tree':full,'integrity_rows':len(names)}))
