# -*- coding: utf-8 -*-
"""Draw the app icons.

    python tools/build_icons.py

An oral syringe on a blue ground, drawn at 4x and scaled down so the edges
are clean. The badge is white on transparent, as Android requires.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BLUE = (11, 92, 173, 255)
WHITE = (255, 255, 255, 255)


def syringe(d, s, cx, cy, scale, colour):
    """A syringe, pointing left, centred at (cx, cy); `scale` is its length."""
    L = scale
    barrel_w, barrel_h = L * 0.62, L * 0.22
    x0 = cx - L * 0.40
    y0 = cy - barrel_h / 2
    r = barrel_h * 0.18
    lw = max(2, int(L * 0.035))
    # tip
    d.rectangle([x0 - L * 0.12, cy - L * 0.035, x0, cy + L * 0.035], fill=colour)
    # barrel outline and liquid
    d.rounded_rectangle([x0, y0, x0 + barrel_w, y0 + barrel_h], radius=r, outline=colour, width=lw)
    d.rounded_rectangle([x0 + lw * 2, y0 + lw * 2, x0 + barrel_w * 0.55, y0 + barrel_h - lw * 2], radius=r * 0.6, fill=colour)
    # ticks
    for i in range(1, 5):
        tx = x0 + barrel_w * i / 5
        d.line([tx, y0, tx, y0 + barrel_h * (0.45 if i % 2 else 0.3)], fill=colour, width=max(1, lw // 2))
    # plunger rod and thumb
    d.rectangle([x0 + barrel_w, cy - L * 0.03, x0 + barrel_w + L * 0.2, cy + L * 0.03], fill=colour)
    d.rounded_rectangle([x0 + barrel_w + L * 0.2, cy - barrel_h * 0.7, x0 + barrel_w + L * 0.26, cy + barrel_h * 0.7], radius=lw, fill=colour)


def icon(size, *, maskable=False, badge=False):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not badge:
        if maskable:
            d.rectangle([0, 0, s, s], fill=BLUE)
        else:
            d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=BLUE)
    # Maskable icons keep the art inside the central 80% safe zone.
    scale = s * (0.62 if maskable else 0.74 if not badge else 0.9)
    syringe(d, s, s / 2 + scale * 0.02, s / 2, scale, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    icon(192).save(OUT / "icon-192.png")
    icon(512).save(OUT / "icon-512.png")
    icon(512, maskable=True).save(OUT / "maskable-512.png")
    icon(180, maskable=True).convert("RGB").save(OUT / "apple-touch-icon.png")
    icon(96, badge=True).save(OUT / "badge-96.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
