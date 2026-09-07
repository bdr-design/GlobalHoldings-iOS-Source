#!/usr/bin/env python3
from __future__ import annotations
import base64, os
from pathlib import Path

KEY_ID='gh-primary-2026'
ALGORITHM='ed25519'


def signature_payload(manifest:dict)->bytes:
    version=int(manifest.get('signaturePayloadVersion',2) or 2)
    if version==1:
        fields=[
            'gh-update-signature-v1',
            str(manifest.get('id','')),
            str(manifest.get('version','')),
            str(manifest.get('fileCount','')),
            str(manifest.get('unpackedBytes','')),
            str(manifest.get('filesIndexSha256','')),
            str(manifest.get('operationsSha256','')),
        ]
    elif version==2:
        fields=[
            'gh-update-signature-v2',
            str(manifest.get('id','')),
            str(manifest.get('version','')),
            str(manifest.get('minGameVersion','')),
            str(manifest.get('packageType','')),
            str(manifest.get('installMode','')),
            str(manifest.get('fileCount','')),
            str(manifest.get('unpackedBytes','')),
            str(manifest.get('filesIndexSha256','')),
            str(manifest.get('operationsSha256','')),
        ]
    else:
        raise RuntimeError(f'Unsupported signature payload version: {version}')
    return ('\n'.join(fields)).encode('utf-8')


def _load_private_key_bytes()->bytes:
    value=os.environ.get('GH_UPDATE_SIGNING_PRIVATE_KEY_B64','').strip()
    path=os.environ.get('GH_UPDATE_SIGNING_KEY_FILE','').strip()
    if not value and path:
        text=Path(path).read_text(encoding='utf-8')
        for line in text.splitlines():
            if line.startswith('GH_UPDATE_SIGNING_PRIVATE_KEY_B64='):
                value=line.split('=',1)[1].strip();break
    if not value:
        raise RuntimeError('Missing update signing key. Set GH_UPDATE_SIGNING_PRIVATE_KEY_B64 or GH_UPDATE_SIGNING_KEY_FILE. Never commit the private key.')
    raw=base64.b64decode(value,validate=True)
    if len(raw)!=32: raise RuntimeError('Ed25519 private key must be 32 raw bytes encoded as Base64.')
    return raw


def sign_manifest(manifest:dict)->dict:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    private=Ed25519PrivateKey.from_private_bytes(_load_private_key_bytes())
    manifest.setdefault('signaturePayloadVersion',2)
    signature=private.sign(signature_payload(manifest))
    manifest['signatureAlgorithm']=ALGORITHM
    manifest['signatureKeyId']=KEY_ID
    manifest['signature']=base64.b64encode(signature).decode('ascii')
    return manifest
