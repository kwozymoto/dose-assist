# -*- coding: utf-8 -*-
"""Android launcher and notification icons from icons/.

    python tools/android_icons.py

Legacy and round launcher icons from icon-512.png, the adaptive-icon
foreground from maskable-512.png, and the status-bar icon (white on
transparent, as Android requires) from badge-96.png.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

icon = Image.open(ROOT / "icons" / "icon-512.png").convert("RGBA")
mask = Image.open(ROOT / "icons" / "maskable-512.png").convert("RGBA")
badge = Image.open(ROOT / "icons" / "badge-96.png").convert("RGBA")

for d, k in DENS.items():
    out = RES / f"mipmap-{d}"
    out.mkdir(parents=True, exist_ok=True)
    s = round(48 * k)
    icon.resize((s, s), Image.LANCZOS).save(out / "ic_launcher.png")
    r = icon.resize((s, s), Image.LANCZOS)
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).ellipse([0, 0, s - 1, s - 1], fill=255)
    r.putalpha(Image.composite(r.getchannel("A"), m, m))
    r.save(out / "ic_launcher_round.png")
    f = round(108 * k)
    mask.resize((f, f), Image.LANCZOS).save(out / "ic_launcher_foreground.png")
    dr = RES / f"drawable-{d}"
    dr.mkdir(parents=True, exist_ok=True)
    b = round(24 * k)
    badge.resize((b, b), Image.LANCZOS).save(dr / "ic_stat_dose.png")
print("android icons written")
