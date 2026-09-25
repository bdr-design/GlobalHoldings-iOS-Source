#!/usr/bin/env python3
"""Verify the Build 339 source binding and a fresh unsigned iPhoneOS IPA."""
from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

ARCHIVE_SHA256 = "41c79d819a3b013c540606dd7b86e7e5cfa7f3cc704365e1567b443b63e45003"
SOURCE_SHA256 = "f47eca7a668f2c9b2ea3d41d1463033c11573e4530cc751a39dbd4cba9ec38b5"
VERSION = "3.0.0"
BUILD = "339"
SAVE_SCHEMA = "2.0.0"


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def files(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlink in output tree: {path}")
        if path.is_file():
            out[path.relative_to(root).as_posix()] = sha(path)
    return out


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def verify(args: argparse.Namespace) -> dict:
    archive = args.archive.resolve()
    source = args.source.resolve()
    app = args.app.resolve()
    ipa = args.ipa.resolve()
    accepted = json.loads(args.acceptance.read_text())
    manifest = json.loads((source / "RUNTIME_SOURCE_MANIFEST.json").read_text())
    authorization = json.loads((source / "EXPERIMENTAL_BUILD_AUTHORIZATION.json").read_text())
    fix = json.loads((source / "BUILD339_ACCRUED_OBLIGATION_FIX_VERIFICATION.json").read_text())
    release_gate = json.loads((source / "RELEASE_GATE.json").read_text())

    require(sha(archive) == ARCHIVE_SHA256, "Library source archive SHA-256 mismatch")
    sys.path.insert(0, str(source / "tools"))
    from verify_current_source import verify as verify_source

    source_result = verify_source(source)
    require(source_result["source_tree_sha256"] == SOURCE_SHA256, "Runtime source fingerprint mismatch")
    require((source / "VERSION").read_text().strip() == VERSION, "Wrong version")
    require((source / "BUILD").read_text().strip() == BUILD, "Wrong build")
    require(manifest.get("save_schema") == SAVE_SCHEMA, "Wrong Save Schema")
    require(authorization.get("test_build_authorized") is True, "Experimental test build is not authorized")
    require(authorization.get("source_tree_sha256") == SOURCE_SHA256, "Authorization source binding mismatch")
    require(authorization.get("production_approved") is False, "Production approval must remain closed")
    require(release_gate.get("approved") is False, "Release gate must remain closed")
    require(fix.get("runtime_source_tree_sha256") == SOURCE_SHA256, "Fix verification source binding mismatch")
    for key in (
        "record_full_incurred_obligation",
        "reserve_only_available_budget",
        "record_unbudgeted_remainder",
        "settlement_requires_cash",
        "full_snapshot_rollback_preserved",
    ):
        require(fix.get("fix", {}).get(key) is True, f"Accrued-obligation fix contract missing: {key}")

    required_gates = int(authorization["minimum_acceptance_gates"])
    require(accepted.get("completed") is True, "Source acceptance is incomplete")
    require(accepted.get("all_tests_passed") is True, "Source acceptance contains a failure")
    require(accepted.get("runtime_unchanged") is True, "Runtime changed during source acceptance")
    require(accepted.get("runtime_source", {}).get("source_tree_sha256") == SOURCE_SHA256, "Acceptance belongs to another source")
    require(accepted.get("total", 0) >= max(103, required_gates), "Fewer than 103 acceptance gates ran")
    require(accepted.get("passed") == accepted.get("total"), "Not all declared source gates passed")

    expected_web = {
        name.removeprefix("WebApp/"): row["sha256"]
        for name, row in manifest["files"].items()
        if name.startswith("WebApp/")
    }
    actual_web = files(app / "WebApp")
    require(actual_web == expected_web, "Bundled WebApp differs from the verified source tree")
    required_runtime = json.loads((app / "WebApp/runtime-required.json").read_text())
    require(all(name in actual_web for name in required_runtime["files"]), "A required runtime resource is absent")

    info = plistlib.loads((app / "Info.plist").read_bytes())
    require(info.get("CFBundleShortVersionString") == VERSION, "IPA version mismatch")
    require(info.get("CFBundleVersion") == BUILD, "IPA build number mismatch")
    require(info.get("CFBundleIdentifier") == "com.example.globalholdings", "Bundle ID mismatch")
    require(info.get("UIDeviceFamily") == [1], "IPA is not iPhone-only")
    require(info.get("LSRequiresIPhoneOS") is True, "IPA metadata does not require iPhoneOS")
    project = (source / "project.yml").read_text()
    match = re.search(r'(?m)^\s*GHSourceSnapshotSHA256:\s*["\x27]?([0-9a-f]{64})', project)
    require(match is not None and info.get("GHSourceSnapshotSHA256") == match.group(1), "Native bundle snapshot metadata mismatch")
    require((app / "Assets.car").is_file() and (app / "Assets.car").stat().st_size > 0, "Compiled app icon is missing")
    require(not (app / "embedded.mobileprovision").exists(), "Unexpected provisioning profile")
    require(not (app / "_CodeSignature").exists(), "Expected an unsigned test IPA")
    executable = app / "GlobalHoldings"
    require(executable.is_file(), "Native executable missing")
    archs = subprocess.check_output(["/usr/bin/lipo", "-archs", str(executable)], text=True).split()
    require("arm64" in archs, "IPA does not contain an arm64 executable")
    load_commands = subprocess.check_output(["/usr/bin/otool", "-l", str(executable)], text=True)
    require("LC_BUILD_VERSION" in load_commands and re.search(r"(?m)^\s*platform\s+2\s*$", load_commands) is not None,
            "Mach-O is not marked for iPhoneOS")
    require(bool(executable.stat().st_mode & stat.S_IXUSR), "Native executable is not executable")

    app_files = files(app)
    with zipfile.ZipFile(ipa) as bundle:
        require(bundle.testzip() is None, "IPA ZIP CRC check failed")
        rows = bundle.infolist()
        names = [row.filename for row in rows]
        require(len(names) == len(set(names)), "IPA contains duplicate entries")
        prefix = "Payload/GlobalHoldings.app/"
        entries = {row.filename: row for row in rows if not row.is_dir()}
        require(set(entries) == {prefix + name for name in app_files}, "IPA contains missing or unexpected app files")
        for name, expected in app_files.items():
            item = prefix + name
            require(hashlib.sha256(bundle.read(item)).hexdigest() == expected, f"IPA app byte mismatch: {name}")
        mode = entries[prefix + "GlobalHoldings"].external_attr >> 16
        require(bool(mode & 0o111), "IPA lost the executable bit")

    result = {
        "verified": True,
        "ipa_created": True,
        "experimental_test_build": True,
        "unsigned": True,
        "production_approved": False,
        "device_tested": False,
        "version": VERSION,
        "build": int(BUILD),
        "save_schema": SAVE_SCHEMA,
        "source_archive_sha256": ARCHIVE_SHA256,
        "runtime_source_tree_sha256": SOURCE_SHA256,
        "webapp_tree_sha256": manifest["webapp_tree_sha256"],
        "webapp_file_count": len(expected_web),
        "acceptance_gates": {"passed": accepted["passed"], "total": accepted["total"]},
        "bundle_id": info["CFBundleIdentifier"],
        "device_family": info["UIDeviceFamily"],
        "mach_o_architectures": archs,
        "mach_o_platform": "iPhoneOS",
        "old_ipa_used": False,
        "final_ipa_crc_passed": True,
        "ipa_bytes": ipa.stat().st_size,
        "ipa_sha256": sha(ipa),
        "app_file_count": len(app_files),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--acceptance", type=Path, required=True)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--ipa", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
