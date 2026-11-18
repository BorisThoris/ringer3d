"""Marble Duels thumbnail v3: the marbles are the subject. The ring with dressed players kneeling
round it (Studio render), and over it the game's marbles cut out from sky shots: two big ones
smashing together with an impact burst, the rest knocked flying. Sticker outlines, one title.
Usage: py duel3.py <ring.png> <sprite dir> <out.jpg>"""
import math
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter
sys.path.insert(0, str(Path(__file__).parent))
from compose import crop, grade, key_mask, words

W, H = 1920, 1080
ring_path, sprites, out = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
files = {p.stem.split("-", 1)[1]: p for p in sprites.glob("*.png")}


# Each marble's glass, tinted by its own core colour (the sky behind the shot tints them all blue).
TINT = {"blackhole": (150, 80, 255), "ember": (255, 120, 40), "tide": (40, 150, 255),
        "aurora": (60, 225, 230), "volt": (255, 80, 200), "pumpkin": (255, 150, 40)}


def clear_glass(img, mid):
    """The shot's sky shows through the clear shell and tints every marble the same blue: turn
    those sky pixels into pale glass so each marble's coloured core is what reads."""
    import numpy as np
    a = np.asarray(img).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    # Sky: blue-dominant, bright, and not the vivid core.
    sky = ((b > r + 25) & (b >= g) & (mx > 150) & (sat < 0.75)) | ((sat < 0.22) & (mx > 165))
    # Bright glass: white at the top shading down, faintly tinted by the marble's own core colour.
    tint = np.array(TINT.get(mid, (200, 220, 255)), np.float32)
    # A ball: lit top-left, darker toward the rim.
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = (xx - w * 0.38) / (w * 0.62), (yy - h * 0.36) / (h * 0.62)
    shade = (1.05 - 0.38 * np.clip(np.sqrt(dx * dx + dy * dy), 0, 1.3))[..., None]
    glass = (np.array([255, 255, 255], np.float32) * 0.45 + tint * 0.55) * shade
    out = np.where(sky[..., None], glass, a)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def sprite(mid):
    """The marble `mid` cut out of its sky shot: the round shell only, with a glass rim and a
    highlight so it reads as a ball at thumbnail size."""
    beauty = Image.open(files["m-" + mid]).convert("RGB")
    mask = key_mask(Image.open(files["m-" + mid + "-matte"]).convert("RGB"))
    bb = mask.point(lambda v: 255 if v > 128 else 0).getbbox()
    b = clear_glass(beauty.crop(bb), mid)
    b = ImageEnhance.Contrast(ImageEnhance.Color(b).enhance(1.35)).enhance(1.12).convert("RGBA")
    w, h = b.size
    disc = Image.new("L", (w, h), 0)
    ImageDraw.Draw(disc).ellipse((1, 1, w - 2, h - 2), fill=255)
    b.putalpha(ImageChops.multiply(mask.crop(bb), disc))
    # Glass rim: a soft darker ring at the edge, and a white highlight top-left.
    rim = Image.new("L", (w, h), 0)
    ImageDraw.Draw(rim).ellipse((0, 0, w - 1, h - 1), outline=255, width=max(3, w // 22))
    rim = rim.filter(ImageFilter.GaussianBlur(w / 40))
    b.alpha_composite(Image.composite(Image.new("RGBA", (w, h), (20, 40, 110, 150)), Image.new("RGBA", (w, h), (0, 0, 0, 0)), ImageChops.multiply(rim, disc)))
    hi = Image.new("L", (w, h), 0)
    ImageDraw.Draw(hi).ellipse((w * 0.2, h * 0.12, w * 0.48, h * 0.34), fill=200)
    hi = hi.filter(ImageFilter.GaussianBlur(w / 30))
    b.alpha_composite(Image.composite(Image.new("RGBA", (w, h), (255, 255, 255, 255)), Image.new("RGBA", (w, h), (0, 0, 0, 0)), hi))
    return b


def sticker(rgba, outline, rim):
    a = rgba.getchannel("A").point(lambda v: 255 if v > 100 else 0)
    pad = outline + rim + 4
    big = Image.new("L", (a.size[0] + pad * 2, a.size[1] + pad * 2), 0)
    big.paste(a, (pad, pad))

    def grow(px):
        g, size = big, px * 2 + 1
        while size > 1:
            k = min(size, 9) | 1
            g = g.filter(ImageFilter.MaxFilter(k))
            size -= k - 1
        return g.filter(ImageFilter.GaussianBlur(1.3))
    o = Image.new("RGBA", big.size, (0, 0, 0, 0))
    o.paste(Image.new("RGBA", big.size, (30, 20, 60, 255)), (0, 0), grow(outline + rim))
    o.paste(Image.new("RGBA", big.size, (255, 255, 255, 255)), (0, 0), grow(outline))
    o.alpha_composite(rgba, (pad, pad))
    return o


def place(img, mid, d, cx, cy, rot=0, streak=None):
    s = sprite(mid).resize((d, d), Image.LANCZOS)
    if rot:
        s = s.rotate(rot, resample=Image.BICUBIC)
    st = sticker(s, max(5, d // 34), max(2, d // 90))
    if streak:
        # Motion streaks behind a flying marble, pointing back along its path.
        dx, dy = streak
        L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(L)
        n = math.hypot(dx, dy)
        px, py = -dy / n, dx / n
        for k, (off, wd) in enumerate([(-0.3, 0.16), (0, 0.22), (0.3, 0.16)]):
            ox, oy = cx + px * off * d, cy + py * off * d
            tail = (ox - dx * d * 1.6, oy - dy * d * 1.6)
            dr.polygon([tail, (ox + px * wd * d, oy + py * wd * d), (ox - px * wd * d, oy - py * wd * d)], fill=(255, 255, 255, 170))
        img.alpha_composite(L.filter(ImageFilter.GaussianBlur(4)))
    img.alpha_composite(st, (int(cx - st.size[0] / 2), int(cy - st.size[1] / 2)))


def burst(img, cx, cy, r):
    """The comic impact star where the two marbles meet."""
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    for scale, col in [(1.0, (255, 120, 30, 255)), (0.78, (255, 220, 60, 255)), (0.5, (255, 255, 235, 255))]:
        pts = []
        n = 14
        for i in range(n * 2):
            a = i / (n * 2) * math.tau + 0.2
            rr = r * scale * (1.0 if i % 2 == 0 else 0.48) * (1 + 0.18 * math.sin(i * 2.7))
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.9))
        d.polygon(pts, fill=col)
    glow = L.getchannel("A").filter(ImageFilter.GaussianBlur(r * 0.25))
    img.alpha_composite(Image.composite(Image.new("RGBA", (W, H), (255, 240, 180, 200)), Image.new("RGBA", (W, H), (0, 0, 0, 0)), glow))
    img.alpha_composite(L)


ring = crop(Image.open(ring_path).convert("RGB"), W, H, 0.5, 0.5)
ring = ImageEnhance.Color(ring).enhance(1.15).filter(ImageFilter.GaussianBlur(1.2))
img = ring.convert("RGBA")
# Knocked-out marbles flying (behind the smash).
place(img, "tide", 230, 330, 700, rot=20, streak=(-0.8, -0.35))
place(img, "volt", 200, 1610, 640, rot=-15, streak=(0.85, -0.4))
place(img, "aurora", 170, 1320, 940, streak=(0.5, 0.6))
place(img, "ember", 150, 560, 960, rot=-40, streak=(-0.6, 0.6))
# The smash: Black Hole (left) into Ember (right).
CX, CY = 960, 720
place(img, "blackhole", 430, CX - 235, CY + 10, streak=(1, 0.08))
place(img, "ember", 360, CX + 240, CY - 60, rot=25)
burst(img, CX + 5, CY - 30, 150)
out_img = grade(img.convert("RGB"), 1.08, 1.05, 0.2)
out_img = words(out_img, "MARBLE DUELS", "lucky", 175, 0.5, 0.13, [(255, 255, 255), (130, 215, 255), (40, 110, 255)], tilt=-3)
out_img.save(out, quality=93)
print("wrote", out)
