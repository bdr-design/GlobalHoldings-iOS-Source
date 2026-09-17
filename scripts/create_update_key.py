#!/usr/bin/env python3
"""Create an Ed25519 recovery bundle outside the repository; never print secrets."""
import argparse
import base64
import json
import os
import re
import zipfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--key-id', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', args.key_id):
        raise SystemExit('Invalid key identifier')
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    if output == root or root in output.parents:
        raise SystemExit('Private key output must be outside the repository')
    output.mkdir(parents=True, exist_ok=True)
    path = output / (args.key_id + '.env')
    archive = output / 'GlobalHoldings_Update_Key_BUILD310_PRIVATE.zip'
    if path.exists() or archive.exists():
        raise SystemExit('Refusing to overwrite a signing key')
    private = Ed25519PrivateKey.generate()
    raw = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    public = base64.b64encode(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    config = 'GH_UPDATE_SIGNING_PRIVATE_KEY_B64=' + base64.b64encode(raw).decode() + '\n'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(config)
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr(path.name, config)
        bundle.writestr('PUBLIC_KEY.json', json.dumps({'keyId': args.key_id, 'algorithm': 'ed25519', 'publicKeyBase64': public}, indent=2))
        bundle.writestr('README_AR.txt', 'نسخة سرية لمفتاح تحديث Global Holdings. احفظها في مدير أسرار ولا ترفعها للمستودع أو تشاركها علنًا.\nللتوقيع: عيّن GH_UPDATE_SIGNING_KEY_FILE إلى المسار الكامل لملف .env ثم شغّل scripts/build_update.py.\nهذا مفتاح تحديث محتوى اللعبة وليس شهادة توقيع تطبيقات Apple.\nالتطبيق المثبت قبل BUILD310 لا يثق بهذا المفتاح.\n')
    os.chmod(archive, 0o600)
    print(json.dumps({'keyId': args.key_id, 'publicKeyBase64': public, 'keyFile': str(path), 'backup': str(archive)}))

if __name__ == '__main__':
    main()
