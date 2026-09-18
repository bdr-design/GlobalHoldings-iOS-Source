#!/usr/bin/env python3
"""Generate and verify the deterministic Global Holdings source manifest.

In a Git checkout, the index is the source-of-truth file set. In an extracted
Full Source archive, the same policy is applied to the archive tree. Generated
evidence, caches, dependencies and binary deliverables are never source inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path


MANIFEST_NAME = "SOURCE_INTEGRITY_SHA256.txt"
LINE_RE = re.compile(r"^([0-9a-fA-F]{64})  (.+)$")
IGNORED_DIRECTORY_NAMES = {
    ".git",
    ".ci-output",
    "node_modules",
    "build",
    "GlobalHoldings.xcodeproj",
    "deliverables",
    "__pycache__",
}
IGNORED_PREFIXES = ("tests/screenshots/",)
IGNORED_SUFFIXES = (".pyc", ".pyo", ".DS_Store")


class IntegrityError(RuntimeError):
    pass


def ignored(relative: str) -> bool:
    path = Path(relative)
    if relative == MANIFEST_NAME:
        return True
    if relative.startswith(IGNORED_PREFIXES) or relative.endswith(IGNORED_SUFFIXES):
        return True
    return any(part in IGNORED_DIRECTORY_NAMES for part in path.parts)


def git_root(root: Path) -> Path | None:
    out = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if out.returncode:
        return None
    try:
        discovered = Path(out.stdout.decode("utf-8").strip()).resolve()
    except (UnicodeDecodeError, OSError):
        return None
    return discovered if discovered == root else None


def policy_files(root: Path) -> tuple[list[str], str]:
    if git_root(root) is not None:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "--cached"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if out.returncode:
            raise IntegrityError(out.stderr.decode("utf-8", errors="replace").strip() or "git ls-files failed")
        try:
            names = [item for item in out.stdout.decode("utf-8").split("\0") if item]
        except UnicodeDecodeError as exc:
            raise IntegrityError("Git contains a non-UTF-8 source path") from exc
        mode = "git-index"
    else:
        # Include symlinks explicitly, including broken links and links to
        # directories, so the rejection below cannot be bypassed by an entry
        # that Path.is_file() would otherwise omit.
        names = [
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_symlink() or not path.is_dir()
        ]
        mode = "archive-tree"

    selected: list[str] = []
    for relative in sorted(set(names)):
        path = Path(relative)
        if "\n" in relative or "\r" in relative or "\0" in relative:
            raise IntegrityError(f"Unsupported control character in source path: {relative!r}")
        if path.is_absolute() or ".." in path.parts or ignored(relative):
            continue
        source = root / path
        if source.is_symlink():
            raise IntegrityError(f"Symlink source entries are forbidden: {relative}")
        selected.append(relative)
    if not selected:
        raise IntegrityError("Source integrity policy selected no files")
    return selected, mode


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def read_manifest(path: Path) -> dict[str, str]:
    if not path.is_file() or path.stat().st_size == 0:
        raise IntegrityError(f"Missing or empty {MANIFEST_NAME}")
    expected: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        match = LINE_RE.match(raw)
        if not match:
            raise IntegrityError(f"Malformed manifest line {line_number}: {raw!r}")
        wanted, relative = match.group(1).lower(), match.group(2)
        parts = Path(relative).parts
        if Path(relative).is_absolute() or ".." in parts or ignored(relative):
            raise IntegrityError(f"Forbidden manifest path at line {line_number}: {relative}")
        if relative in expected:
            raise IntegrityError(f"Duplicate manifest path: {relative}")
        expected[relative] = wanted
    if not expected:
        raise IntegrityError("Source integrity manifest is empty")
    return expected


def verify(root: Path) -> int:
    files, mode = policy_files(root)
    expected = read_manifest(root / MANIFEST_NAME)
    policy = set(files)
    declared = set(expected)
    missing_from_manifest = sorted(policy - declared)
    outside_policy = sorted(declared - policy)
    if missing_from_manifest:
        raise IntegrityError("Files missing from source manifest:\n  " + "\n  ".join(missing_from_manifest[:80]))
    if outside_policy:
        raise IntegrityError("Manifest paths outside the source policy:\n  " + "\n  ".join(outside_policy[:80]))
    for relative in files:
        source = root / relative
        if not source.is_file():
            raise IntegrityError(f"Manifest source file is missing: {relative}")
        actual = digest(source)
        if actual != expected[relative]:
            raise IntegrityError(f"SHA-256 mismatch for {relative}: expected {expected[relative]}, got {actual}")
    print(f"Source integrity: PASS ({len(files)} files; policy={mode})")
    return 0


def write(root: Path) -> int:
    files, mode = policy_files(root)
    lines: list[str] = []
    for relative in files:
        source = root / relative
        if not source.is_file():
            raise IntegrityError(f"Tracked source file is missing: {relative}")
        lines.append(f"{digest(source)}  {relative}")
    manifest = root / MANIFEST_NAME
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=root, prefix=".source-integrity-", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write("\n".join(lines) + "\n")
    temporary.replace(manifest)
    print(f"Source integrity: WROTE {len(files)} files (policy={mode})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="verify the existing manifest")
    action.add_argument("--write", action="store_true", help="atomically regenerate the manifest")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        return verify(root) if args.check else write(root)
    except (IntegrityError, OSError) as exc:
        print(f"Source integrity: FAIL — {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
