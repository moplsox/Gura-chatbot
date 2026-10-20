#!/usr/bin/env python3
"""Download an official Live2D Cubism sample model (e.g. Haru, Hiyori, Mao) for development.

The samples are published by Live2D Inc. in https://github.com/Live2D/CubismWebSamples under the
"Live2D Free Material License Agreement". They are NOT redistributed in this repository; this
script fetches them into frontend/public/live2d/models/<Name>/ (git-ignored) on your machine.

Usage:  python3 scripts/download_live2d_sample.py [Haru|Hiyori|Mao|Natori|Mark|Rice|Wanko]
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources"
ROOT = Path(__file__).resolve().parents[1]
DEST_ROOT = ROOT / "frontend" / "public" / "live2d" / "models"


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    with urllib.request.urlopen(url, timeout=60) as r:
        dest.write_bytes(r.read())
    print(f"  ↓ {dest.relative_to(ROOT)}")


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "Haru"
    base = f"{RAW}/{name}"
    dest = DEST_ROOT / name
    manifest = dest / f"{name}.model3.json"
    print(f"Downloading Live2D sample model '{name}' → {dest.relative_to(ROOT)}")
    fetch(f"{base}/{name}.model3.json", manifest)
    data = json.loads(manifest.read_text())
    refs = data["FileReferences"]
    files: list[str] = [refs["Moc"], *refs.get("Textures", [])]
    for key in ("Physics", "Pose", "UserData", "DisplayInfo"):
        if refs.get(key):
            files.append(refs[key])
    files += [e["File"] for e in refs.get("Expressions", [])]
    for group in refs.get("Motions", {}).values():
        for m in group:
            files.append(m["File"])
            if m.get("Sound"):
                files.append(m["Sound"])
    for rel in files:
        fetch(f"{base}/{rel}", dest / rel)
    # License notice next to the model
    (dest / "LICENSE_NOTICE.txt").write_text(
        f"{name} is a sample model © Live2D Inc., provided under the Live2D Free Material License\n"
        "Agreement: https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html\n"
        "Downloaded from https://github.com/Live2D/CubismWebSamples for development/testing only.\n"
    )
    print(f"Done. {len(files)} files. Model URL: /live2d/models/{name}/{name}.model3.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
