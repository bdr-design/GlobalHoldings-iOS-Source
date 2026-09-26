#!/usr/bin/env python3
"""Assemble an unsigned TEST IPA from a freshly compiled, hash-pinned native product.

No old IPA is accepted. The supplied Apple artifact must match the documented CI
build. Every native byte and every WebApp byte is verified before publication.
Passing these checks is not physical-device or production-release approval.
"""
from __future__ import annotations
import argparse, hashlib, json, os, plistlib, shutil, stat, struct, tempfile
import tarfile, zipfile
from pathlib import Path, PurePosixPath
from verify_current_source import verify, inventory, tree_digest, digest

def safe(name: str) -> PurePosixPath:
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name or '\0' in name:
        raise ValueError(f'Unsafe archive entry: {name!r}')
    return p

def file_hashes(root: Path) -> dict[str, str]:
    result = {}
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            raise ValueError(f'Symlink forbidden: {p}')
        if p.is_file():
            result[p.relative_to(root).as_posix()] = digest(p)
    return result

def apple_executable(data: bytes) -> dict:
    if len(data) < 32:
        raise ValueError('Truncated executable')
    magic, cpu, subtype, kind, count, size, flags, reserved = struct.unpack_from('<8I', data)
    if magic != 0xfeedfacf or cpu != 0x100000c or kind != 2:
        raise ValueError('Native product is not an arm64 Mach-O executable')
    cursor, platforms, signatures = 32, [], []
    for _ in range(count):
        cmd, length = struct.unpack_from('<II', data, cursor)
        if length < 8 or cursor + length > len(data):
            raise ValueError('Invalid Mach-O load command')
        if cmd == 0x32:
            platforms.append(struct.unpack_from('<I', data, cursor + 8)[0])
        if cmd == 0x1d:
            signatures.append(struct.unpack_from('<II', data, cursor + 8))
        cursor += length
    if 2 not in platforms:
        raise ValueError('Executable is not built for iPhoneOS')
    return {'architecture': 'arm64', 'platforms': platforms, 'code_signature_commands': signatures}

def run(root: Path, artifact: Path, acceptance: Path, output: Path) -> dict:
    output = output.absolute()
    report_path = output.with_suffix('.verification.json')
    if output.exists() or output.is_symlink() or report_path.exists():
        raise ValueError('Output must be new; no replacement is permitted')
    verified = verify(root)
    authorization = json.loads((root / 'EXPERIMENTAL_BUILD_AUTHORIZATION.json').read_text())
    provenance = json.loads((root / 'provenance/r4-native-build.json').read_text())
    runtime = json.loads((root / 'RUNTIME_SOURCE_MANIFEST.json').read_text())
    if authorization.get('test_build_authorized') is not True or authorization.get('production_approved') is not False:
        raise ValueError('Explicit test-build authorization required')
    if authorization['source_tree_sha256'] != verified['source_tree_sha256']:
        raise ValueError('Authorization belongs to a different source')
    accepted = json.loads(acceptance.read_text())
    if accepted.get('completed') is not True or accepted.get('all_tests_passed') is not True or accepted.get('runtime_unchanged') is not True:
        raise ValueError('All source tests must finish and pass')
    if accepted['runtime_source']['source_tree_sha256'] != verified['source_tree_sha256']:
        raise ValueError('Acceptance result belongs to another runtime')
    if len(accepted['tests']) < authorization['minimum_acceptance_gates'] or any(r['exit_code'] != 0 for r in accepted['tests']):
        raise ValueError('Missing or failed test gate')
    if digest(artifact) != provenance['artifact_sha256']:
        raise ValueError('Apple artifact does not match the pinned fresh compilation')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.gh337-source-ipa-', dir=output.parent))
    try:
        extracted = stage / 'apple'
        extracted.mkdir()
        with zipfile.ZipFile(artifact) as z:
            if z.testzip() is not None:
                raise ValueError('Apple artifact CRC failure')
            names = [i.filename for i in z.infolist()]
            if len(names) != len(set(names)):
                raise ValueError('Duplicate artifact entries')
            for i in z.infolist():
                rel = safe(i.filename)
                if stat.S_ISLNK(i.external_attr >> 16):
                    raise ValueError('Artifact symlink')
                target = extracted.joinpath(*rel.parts)
                if i.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(i) as a, target.open('wb') as b:
                        shutil.copyfileobj(a, b)
        inputs = json.loads((extracted / 'evidence/source-inputs.json').read_text())
        for filename, expected in inputs['swift_sha256'].items():
            if digest(root / 'iOS/GlobalHoldings' / filename) != expected:
                raise ValueError(f'Swift differs from the compiler input: {filename}')
        if digest(root / 'project.yml') != inputs['project_sha256']:
            raise ValueError('Native project differs from the compiler input')
        if inputs['workflow_commit'] != provenance['workflow_commit'] or inputs['webapp_tree_sha256'] != runtime['webapp_tree_sha256']:
            raise ValueError('CI/source binding mismatch')
        checks = {}
        for key, rel in [('native', 'native-regression/native-tests.json'), ('webkit', 'navigation/n2-navigation-tests.json'), ('bundle', 'bundle/bundle-tests.json')]:
            result = json.loads((extracted / 'evidence' / rel).read_text())
            if result.get('failed') != 0 or result.get('passed') != result.get('total') or not result.get('total'):
                raise ValueError(f'Apple test failed or missing: {key}')
            checks[key] = {'passed': result['passed'], 'total': result['total']}
        tar = extracted / 'fresh-native-product.tar.gz'
        if digest(tar) != provenance['native_product_tar_sha256']:
            raise ValueError('Native product archive hash mismatch')
        payload = stage / 'Payload'
        payload.mkdir()
        with tarfile.open(tar, 'r:gz') as t:
            seen = set()
            for m in t.getmembers():
                rel = safe(m.name)
                if rel.parts[0] != 'GlobalHoldings.app' or m.name in seen or not (m.isdir() or m.isfile()):
                    raise ValueError(f'Unsafe or duplicate native product entry: {m.name}')
                seen.add(m.name)
                target = payload.joinpath(*rel.parts)
                if m.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    target.chmod(0o755)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with t.extractfile(m) as src, target.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
                    target.chmod(m.mode & 0o777)
        app = payload / 'GlobalHoldings.app'
        native_files = json.loads((extracted / 'evidence/native-product-hashes.json').read_text())
        if file_hashes(app) != native_files:
            raise ValueError('Fresh compiler product file hashes differ')
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        if (info.get('CFBundleShortVersionString'), info.get('CFBundleVersion'), info.get('UIDeviceFamily')) != ('3.0.0', '340', [1]):
            raise ValueError('Incorrect iPhone version/build/family')
        if info.get('CFBundleIdentifier') != 'com.example.globalholdings' or info.get('GHSourceSnapshotSHA256') != inputs['webapp_tree_sha256']:
            raise ValueError('Bundle identity or snapshot mismatch')
        if not (app / 'Assets.car').is_file() or (app / 'Assets.car').stat().st_size == 0:
            raise ValueError('Compiled app icon missing')
        if (app / 'embedded.mobileprovision').exists() or (app / '_CodeSignature').exists():
            raise ValueError('Unexpected signing data in the unsigned compiler product')
        macho = apple_executable((app / 'GlobalHoldings').read_bytes())
        if not os.access(app / 'GlobalHoldings', os.X_OK):
            raise ValueError('Native executable lost its execute bit')
        web_expected = {k[len('WebApp/'):]: v for k, v in runtime['files'].items() if k.startswith('WebApp/')}
        if tree_digest(web_expected) != inputs['webapp_tree_sha256']:
            raise ValueError('WebApp snapshot fingerprint mismatch')
        # This is final resource assembly from source, not an update overlay. The
        # intermediate bundle has never contained an older game's WebApp/IPA.
        shutil.rmtree(app / 'WebApp')
        shutil.copytree(root / 'WebApp', app / 'WebApp')
        web_hashes = {k: v['sha256'] for k, v in web_expected.items()}
        if file_hashes(app / 'WebApp') != web_hashes:
            raise ValueError('Assembled WebApp differs from tested source')
        for rel, h in native_files.items():
            if not rel.startswith('WebApp/') and digest(app / rel) != h:
                raise ValueError(f'Native byte changed during resource assembly: {rel}')
        required = json.loads((app / 'WebApp/runtime-required.json').read_text())
        if not all(p in web_hashes for p in required['files']):
            raise ValueError('Missing required runtime resource')
        zip_path = stage / 'test.ipa'
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for folder in [payload, *sorted(p for p in payload.rglob('*') if p.is_dir())]:
                z.write(folder, folder.relative_to(stage).as_posix() + '/')
            for p in sorted(payload.rglob('*')):
                if p.is_file():
                    z.write(p, p.relative_to(stage).as_posix())
        all_app_hashes = file_hashes(app)
        prefix = 'Payload/GlobalHoldings.app/'
        with zipfile.ZipFile(zip_path) as z:
            if z.testzip() is not None:
                raise ValueError('Final IPA CRC failure')
            files = {i.filename: i for i in z.infolist() if not i.is_dir()}
            if set(files) != {prefix + name for name in all_app_hashes}:
                raise ValueError('Final IPA has missing or extra files')
            for name, expected in all_app_hashes.items():
                if hashlib.sha256(z.read(prefix + name)).hexdigest() != expected:
                    raise ValueError(f'IPA byte mismatch: {name}')
            if not (files[prefix + 'GlobalHoldings'].external_attr >> 16) & 0o111:
                raise ValueError('IPA executable permissions missing')
        verify(root)
        record = {
            'ipa_created': True, 'experimental_test_build': True, 'production_approved': False,
            'unsigned': True, 'device_tested': False, 'version': '3.0.0', 'build': 337,
            'save_schema': '2.0.0', 'source_tree_sha256': verified['source_tree_sha256'],
            'webapp_tree_sha256': inputs['webapp_tree_sha256'], 'webapp_files': len(web_hashes),
            'app_files': len(all_app_hashes), 'native_executable_sha256': digest(app / 'GlobalHoldings'),
            'macho': macho, 'apple_run': provenance['workflow_run'], 'apple_commit': inputs['workflow_commit'],
            'native_source_matches_compiler_input': True, 'native_product_unchanged': True,
            'source_acceptance': {'passed': len(accepted['tests']), 'total': len(accepted['tests'])},
            'apple_tests': checks, 'old_ipa_used': False, 'final_ipa_crc_passed': True,
            'ipa_bytes': zip_path.stat().st_size, 'ipa_sha256': digest(zip_path),
            'app_file_sha256': all_app_hashes,
        }
        pending_report = stage / 'verification.json'
        pending_report.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
        if output.exists() or output.is_symlink() or report_path.exists():
            raise ValueError('Destination appeared during assembly')
        os.rename(pending_report, report_path)
        try:
            os.rename(zip_path, output)
        except BaseException:
            report_path.unlink(missing_ok=True)
            raise
        return {k: v for k, v in record.items() if k != 'app_file_sha256'}
    finally:
        shutil.rmtree(stage, ignore_errors=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument('--apple-artifact', type=Path, required=True)
    p.add_argument('--acceptance', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(run(a.source.resolve(), a.apple_artifact.resolve(), a.acceptance.resolve(), a.output), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('TEST IPA ASSEMBLY REJECTED: ' + str(error))
