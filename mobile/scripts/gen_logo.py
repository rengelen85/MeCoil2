#!/usr/bin/env python3
"""Generate the MeCoil crosshair logo + Android launcher icons.

Mirrors client/public/icon.svg (viewBox 0 0 100 100):
  - ring:   circle cx50 cy50 r45, stroke #00e5ff width 6, no fill
  - centre: circle cx50 cy50 r10, fill #00e5ff
  - ticks:  4 lines from edge towards centre, width 4

Everything is drawn at 4x supersample then downscaled for smooth edges.
"""
import os
from PIL import Image, ImageDraw

ACCENT = (0, 229, 255, 255)      # #00e5ff
BG = (10, 10, 10, 255)           # #0a0a0a (app background)
SS = 4                           # supersample factor
HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)


def draw_crosshair(size, draw, ox=0, oy=0, scale=1.0):
    """Draw the crosshair into `draw` scaled to `size`, with offset/scale."""
    def p(v):
        return v / 100.0 * size * scale

    cx = ox + p(50)
    cy = oy + p(50)

    # outer ring
    r = p(45)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACCENT, width=int(p(6)))
    # centre dot
    rc = p(10)
    draw.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], fill=ACCENT)
    # ticks (top, bottom, left, right)
    w = int(p(4))
    draw.line([cx, oy + p(5), cx, oy + p(25)], fill=ACCENT, width=w)
    draw.line([cx, oy + p(75), cx, oy + p(95)], fill=ACCENT, width=w)
    draw.line([ox + p(5), cy, ox + p(25), cy], fill=ACCENT, width=w)
    draw.line([ox + p(75), cy, ox + p(95), cy], fill=ACCENT, width=w)


def make_logo(size, bg=None, circle_bg=False):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if bg is not None:
        if circle_bg:
            draw.ellipse([0, 0, big - 1, big - 1], fill=bg)
        else:
            draw.rectangle([0, 0, big, big], fill=bg)
    # inset the crosshair a little so it isn't flush to the icon edge
    inset = 0.84
    off = big * (1 - inset) / 2
    draw_crosshair(big, draw, ox=off, oy=off, scale=inset)
    return img.resize((size, size), Image.LANCZOS)


def main():
    # In-app logo: transparent background, high res.
    assets = os.path.join(MOBILE, "src", "assets")
    os.makedirs(assets, exist_ok=True)
    make_logo(512).save(os.path.join(assets, "logo.png"))
    print("wrote src/assets/logo.png")

    # Android launcher icons (dark background).
    densities = {
        "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192,
    }
    res = os.path.join(MOBILE, "android", "app", "src", "main", "res")
    for d, sz in densities.items():
        folder = os.path.join(res, f"mipmap-{d}")
        make_logo(sz, bg=BG).save(os.path.join(folder, "ic_launcher.png"))
        make_logo(sz, bg=BG, circle_bg=True).save(os.path.join(folder, "ic_launcher_round.png"))
        print(f"wrote mipmap-{d} launcher icons ({sz}px)")


if __name__ == "__main__":
    main()
