#!/usr/bin/env python3
"""Generate a WeChat 旺柴 (Doge)-style app icon (adaptive foreground + legacy)."""

from PIL import Image, ImageDraw
import os

SIZE = 1024
BG = (255, 243, 224, 255)  # warm cream

YELLOW = (247, 197, 75, 255)    # bright doge yellow
ORANGE = (240, 169, 63, 255)    # lower-face orange
EAR_IN = (224, 158, 60, 255)    # ear inner
WHITE = (255, 255, 255, 255)
DARK = (58, 43, 29, 255)        # eyes / eyebrows / nose / mouth


def draw_doge(draw, cx, cy, s):
    """WeChat 旺柴-style doge: square-ish face, oval brows, w mouth."""

    # Ears (back layer, rounded-ish triangles)
    left_ear = [(cx - 300 * s, cy - 140 * s), (cx - 115 * s, cy - 350 * s), (cx - 10 * s, cy - 170 * s)]
    right_ear = [(cx + 10 * s, cy - 170 * s), (cx + 115 * s, cy - 350 * s), (cx + 300 * s, cy - 140 * s)]
    draw.polygon(left_ear, fill=YELLOW)
    draw.polygon(right_ear, fill=YELLOW)
    inner_l = [(cx - 255 * s, cy - 160 * s), (cx - 135 * s, cy - 310 * s), (cx - 50 * s, cy - 185 * s)]
    inner_r = [(cx + 50 * s, cy - 185 * s), (cx + 135 * s, cy - 310 * s), (cx + 255 * s, cy - 160 * s)]
    draw.polygon(inner_l, fill=EAR_IN)
    draw.polygon(inner_r, fill=EAR_IN)

    # Square-ish face (rounded rect) — the signature 旺柴 shape
    draw.rounded_rectangle(
        [cx - 340 * s, cy - 260 * s, cx + 340 * s, cy + 300 * s],
        radius=110 * s,
        fill=YELLOW,
    )
    # Lower orange shading
    draw.rounded_rectangle(
        [cx - 340 * s, cy + 40 * s, cx + 340 * s, cy + 300 * s],
        radius=110 * s,
        fill=ORANGE,
    )

    # White muzzle / lower face
    draw.rounded_rectangle(
        [cx - 255 * s, cy + 45 * s, cx + 255 * s, cy + 315 * s],
        radius=120 * s,
        fill=WHITE,
    )

    # Tan cheeks on the orange face
    draw.ellipse([cx - 300 * s, cy + 90 * s, cx - 150 * s, cy + 230 * s], fill=(250, 205, 120, 255))
    draw.ellipse([cx + 150 * s, cy + 90 * s, cx + 300 * s, cy + 230 * s], fill=(250, 205, 120, 255))

    # Classic sideways oval eyes
    for ex in (-140, 140):
        draw.ellipse([cx + ex * s - 46 * s, cy - 70 * s, cx + ex * s + 46 * s, cy - 30 * s],
                     fill=DARK)

    # Small oval eyebrows ABOVE the eyes (旺柴 signature)
    for ex in (-140, 140):
        draw.ellipse([cx + ex * s - 28 * s, cy - 118 * s, cx + ex * s + 28 * s, cy - 92 * s],
                     fill=DARK)

    # Round nose
    draw.ellipse([cx - 34 * s, cy + 36 * s, cx + 34 * s, cy + 100 * s], fill=DARK)

    # "w" mouth (like WeChat 哇, but subtle)
    draw.arc([cx - 40 * s, cy + 92 * s, cx + 40 * s, cy + 150 * s],
             start=20, end=160, fill=DARK, width=max(8, int(12 * s)))
    draw.arc([cx - 105 * s, cy + 92 * s, cx - 25 * s, cy + 148 * s],
             start=0, end=70, fill=DARK, width=max(8, int(10 * s)))
    draw.arc([cx + 25 * s, cy + 92 * s, cx + 105 * s, cy + 148 * s],
             start=110, end=180, fill=DARK, width=max(8, int(10 * s)))


# Adaptive foreground: transparent background, doge in the safe zone.
fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw_doge(ImageDraw.Draw(fg), 512, 540, 0.60)
fg.save(os.path.join(os.path.dirname(__file__), "..", "assets", "adaptive-icon.png"))

# Legacy icon: rounded Apple-style card.
icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
card = Image.new("RGBA", (SIZE, SIZE), BG)
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=190, fill=255)
icon.paste(card, (0, 0), mask)
draw_doge(ImageDraw.Draw(icon), 512, 560, 0.70)
icon.save(os.path.join(os.path.dirname(__file__), "..", "assets", "icon.png"))

print("done")
