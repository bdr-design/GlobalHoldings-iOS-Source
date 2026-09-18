#!/usr/bin/env python3
"""Build the Global Holdings clean full-web snapshot from repository source."""
from __future__ import annotations
import base64, hashlib, json, os
from update_signing import sign_manifest
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'WebApp'; UPDATES=Path(os.environ.get('GH_UPDATE_OUTPUT_DIR',ROOT/'updates'))
VERSION=(ROOT/'VERSION').read_text(encoding='utf-8').strip()
BUILD=int((ROOT/'BUILD').read_text(encoding='utf-8').strip())
MIN_GAME_VERSION='2.9.1'
ALLOWED={'.html','.js','.css','.webp','.png','.jpg','.jpeg','.json','.txt'}
# Content-only snapshots preserve player settings and economic parameters.
# Never reintroduce retired operational settings through an update manifest.
OPERATIONS=[]
def compact(v): return json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
def swift_json_compact(v):
    # Foundation JSONSerialization escapes forward slashes (\/). The native updater hashes that exact byte representation.
    return compact(v).replace(b'/', b'\\/')
def main():
    files=[]; total=0
    for source in sorted(p for p in WEB.rglob('*') if p.is_file() and p.suffix.lower() in ALLOWED):
        data=source.read_bytes(); total+=len(data)
        files.append({'path':source.relative_to(ROOT).as_posix(),'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode('ascii')})
    manifest={'id':f'gh-internal-{VERSION}-build{BUILD}-clean-release','name':f'Global Holdings {VERSION} - BUILD{BUILD} Clean Release','version':VERSION,'build':BUILD,'minGameVersion':MIN_GAME_VERSION,'packageType':'full-web','installMode':'clean-snapshot-v1','channel':'stable','signaturePayloadVersion':3,'createdAt':datetime.now(timezone.utc).isoformat(),'releaseNotes':f'BUILD{BUILD}: مسارات أسطول مشتركة محدودة السعة للشاحنات والسفن، مغادرات مجدولة بفواصل تمنع القفز، وأوامر تعيين/مغادرة جماعية ذرية مع حاجز حفظ يمنع تداخل الأزرار. يبقى الطيران حصري المسار. حزمة محتوى فقط تحفظ ملف اللاعب والاقتصاد وSave Schema 2.0.0.',
    'fileCount':len(files),'unpackedBytes':total,'operationsSha256':hashlib.sha256(compact(OPERATIONS)).hexdigest()}
    index=[[f['path'],f['sha256'],f['size']] for f in files]
    manifest['filesIndexSha256']=hashlib.sha256(swift_json_compact(index)).hexdigest()
    sign_manifest(manifest)
    package={'format':'global-holdings-update','manifest':manifest,'operationsJSON':compact(OPERATIONS).decode('utf-8'),'files':files,'version':VERSION,'id':manifest['id'],'name':manifest['name'],'operationsSha256':manifest['operationsSha256']}
    payload=json.dumps(package,ensure_ascii=False,separators=(',',':'))
    UPDATES.mkdir(exist_ok=True)
    for pattern in ('*.ghupdate','*.saneiupdate'):
        for old in UPDATES.glob(pattern): old.unlink()
    version_tag=VERSION.replace('.','')
    for ext in ('saneiupdate','ghupdate'):
        (UPDATES/f'GlobalHoldings_Internal_Update_V{version_tag}_BUILD{BUILD}_CLEAN_RELEASE.{ext}').write_text(payload,encoding='utf-8')
    print(f'Built {VERSION} BUILD{BUILD} clean signed snapshot: {len(files)} files, {total:,} unpacked bytes')
if __name__=='__main__': main()
