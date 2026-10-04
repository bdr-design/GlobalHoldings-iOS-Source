#!/usr/bin/env python3
"""Render the executive dark map from the bundled Natural Earth II tiles.

Water is told from land by its blue cast; land keeps the shaded relief as a
blue-grey ramp; coastlines get a thin light edge. Requires ImageMagick 6
(`convert`). The output mirrors WebApp/assets/maps/ne2 tile for tile.
"""
from __future__ import annotations
import argparse, json, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'WebApp/assets/maps/ne2'
TARGET = ROOT / 'WebApp/assets/maps/ne2-dark'
SEA, LAND_LOW, LAND_HIGH, COAST = '#08121A', '#101C24', '#2E404C', '#4A6B7C'


def render(src: Path, dst: Path, work: Path) -> None:
    mask, land, edge = work / 'mask.png', work / 'land.png', work / 'edge.png'
    run = lambda *args: subprocess.run(['convert', *map(str, args)], check=True)
    run(src, '-fx', '(u.b-u.r)>0.15?1:0', '-colorspace', 'Gray', '-blur', '0x0.7', mask)
    run(src, '-colorspace', 'Gray', '-level', '45%,98%', '+level-colors', f'{LAND_LOW},{LAND_HIGH}', land)
    run(mask, '-threshold', '50%', '-morphology', 'EdgeIn', 'Diamond:1', '-blur', '0x0.5', edge)
    dst.parent.mkdir(parents=True, exist_ok=True)
    run(land, '(', '-size', '256x256', f'xc:{SEA}', ')', mask, '-composite',
        '(', '-size', '256x256', f'xc:{COAST}', ')', edge, '-composite', '-quality', '84', dst)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='re-render tiles that already exist')
    args = parser.parse_args()
    if not shutil.which('convert'):
        raise SystemExit('ImageMagick convert is required')
    tiles = sorted(SOURCE.rglob('*.webp'))
    with tempfile.TemporaryDirectory() as tmp:
        for tile in tiles:
            out = TARGET / tile.relative_to(SOURCE)
            if out.exists() and not args.force:
                continue
            render(tile, out, Path(tmp))
    (TARGET / 'SOURCE.txt').write_text('Rendered by tools/render_dark_map_tiles.py from assets/maps/ne2.\n'
                                       'Made with Natural Earth. Natural Earth II is in the public domain.\n')
    manifest_path = ROOT / 'WebApp/runtime-required.json'
    manifest = json.loads(manifest_path.read_text())
    web = ROOT / 'WebApp'
    manifest['files'] = sorted(set(manifest['files']) | {str(f.relative_to(web)) for f in TARGET.rglob('*') if f.is_file()})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(tiles)} tiles -> {TARGET.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
