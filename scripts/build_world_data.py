#!/usr/bin/env python3
"""Build the compact browser-side airport and port registry used by v2.0.0."""

from __future__ import annotations

import json
import os
from pathlib import Path

import airportsdata


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "WebApp" / "world-data.js"
SEAROUTE_ROOT = Path(os.environ.get("GH_SEAROUTE_ROOT", "/tmp/gh-worlddata/searoute"))


def clean(value: object) -> str:
    return " ".join(str(value or "").replace("_", " ").split())


airports = []
for code, item in sorted(airportsdata.load("ICAO").items()):
    airports.append([
        code,
        clean(item.get("iata")),
        clean(item.get("name")),
        clean(item.get("city")),
        clean(item.get("subd")),
        clean(item.get("country")),
        round(float(item.get("lat") or 0), 6),
        round(float(item.get("lon") or 0), 6),
        round(float(item.get("elevation") or 0)),
    ])

with (SEAROUTE_ROOT / "data" / "ports.geojson").open(encoding="utf-8") as handle:
    port_features = json.load(handle)["features"]

ports = []
for feature in port_features:
    lon, lat = feature["geometry"]["coordinates"]
    props = feature["properties"]
    ports.append([
        clean(props.get("port")),
        clean(props.get("name")),
        clean(props.get("cty")),
        round(float(lat), 6),
        round(float(lon), 6),
        1 if props.get("t") == 1 else 0,
    ])
ports.sort(key=lambda row: (row[2], row[1], row[0]))

payload = {
    "meta": {
        "airportCount": len(airports),
        "iataCount": sum(1 for row in airports if row[1]),
        "portCount": len(ports),
        "terminalCount": sum(row[5] for row in ports),
        "portCountries": len({row[2] for row in ports}),
        "generated": "2026-09-02",
        "airportSource": "airportsdata 20260902 / validated global airport registry",
        "portSource": "searoute 1.6.0 global ports registry",
    },
    "airports": airports,
    "ports": ports,
}

OUTPUT.write_text(
    "window.GH_WORLD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
