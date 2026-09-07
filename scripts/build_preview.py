#!/usr/bin/env python3
"""Build a single-file browser preview with local game assets embedded."""

from __future__ import annotations

import base64
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WebApp"
OUTPUT = ROOT.parent / "GlobalHoldings_v2_0_0_PREVIEW.html"


def script_block(name: str) -> str:
    source = (WEB / name).read_text(encoding="utf-8").replace("</script", "<\\/script")
    return f"<script>\n{source}\n</script>"


def main() -> None:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "styles.css").read_text(encoding="utf-8").replace("</style", "<\\/style")
    html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>")
    for name in ("world-data.js", "catalog.js", "realism-core.js", "advanced-core.js", "app.js"):
        html = html.replace(f'<script src="{name}"></script>', script_block(name))

    for image_path in sorted((WEB / "assets" / "images").glob("*.webp")):
        encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
        html = html.replace(
            f"assets/images/{image_path.name}",
            f"data:image/webp;base64,{encoded}",
        )

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Built {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
