"""Compose key-art captures into Roblox page thumbnails (1920x1080) and an icon (512x512)
in the chart style: big subject, punchy grade, 1-3 huge words with a gradient fill, thick dark
outline and drop shadow, slightly tilted. Usage: py compose.py <spec.json> <out dir>"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageChops

# Roblox's own fonts, from whichever version is installed (a Studio update moves them).
FONTS = max(Path(r"C:\Users\Gaming PC\AppData\Local\Roblox\Versions").glob("*/content/fonts/LuckiestGuy-Regular.ttf"),
            key=lambda p: p.stat().st_mtime).parent
FONT = {"lucky": FONTS / "LuckiestGuy-Regular.ttf", "fredoka": FONTS / "FredokaOne-Regular.ttf"}


def crop(img, w, h, cx, cy, zoom=1.0):
    """Crop to w:h around (cx, cy) as fractions of the image, `zoom` x tighter than the widest fit."""
    W, H = img.size
    cw = min(W, H * w / h) / zoom
    ch = cw * h / w
    x = min(max(0, cx * W - cw / 2), W - cw)
    y = min(max(0, cy * H - ch / 2), H - ch)
    return img.crop((int(x), int(y), int(x + cw), int(y + ch))).resize((w, h), Image.LANCZOS)


def grade(img, sat=1.18, con=1.08, vignette=0.28):
    img = ImageEnhance.Color(img).enhance(sat)
    img = ImageEnhance.Contrast(img).enhance(con)
    if vignette:
        W, H = img.size
        mask = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(mask)
        d.ellipse((-W * 0.25, -H * 0.3, W * 1.25, H * 1.3), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(W * 0.08))
        dark = ImageEnhance.Brightness(img).enhance(1 - vignette)
        img = Image.composite(img, dark, mask)
    return img


def gradient(size, colors):
    W, H = size
    g = Image.new("RGB", (1, len(colors)))
    for i, c in enumerate(colors):
        g.putpixel((0, i), tuple(c))
    return g.resize((W, H), Image.BICUBIC)


def words(img, text, font="lucky", size=170, x=0.5, y=0.16, colors=((255, 250, 170), (255, 170, 30)),
          outline=(40, 16, 60), stroke=None, tilt=-4, shadow=10):
    """Draw `text` centred at (x, y) (fractions): gradient fill, outline, shadow, tilt."""
    W, H = img.size
    f = ImageFont.truetype(str(FONT[font]), size)
    stroke = stroke or max(6, size // 11)
    box = f.getbbox(text, stroke_width=stroke)
    tw, th = box[2] - box[0] + stroke * 2, box[3] - box[1] + stroke * 2
    pad = shadow + stroke + 20
    layer = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    o = (pad - box[0], pad - box[1])
    # Shadow, then outline, then the gradient-filled letters.
    sh = Image.new("L", layer.size, 0)
    ImageDraw.Draw(sh).text((o[0] + shadow * 0.6, o[1] + shadow), text, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
    layer.paste(Image.new("RGBA", layer.size, (0, 0, 0, 150)), (0, 0), sh.filter(ImageFilter.GaussianBlur(3)))
    ImageDraw.Draw(layer).text(o, text, font=f, fill=outline + (255,), stroke_width=stroke, stroke_fill=outline + (255,))
    fill = Image.new("L", layer.size, 0)
    ImageDraw.Draw(fill).text(o, text, font=f, fill=255)
    gb = fill.getbbox()
    grad = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    if gb:
        grad.paste(gradient((gb[2] - gb[0], gb[3] - gb[1]), colors), (gb[0], gb[1]))
    layer.paste(grad, (0, 0), fill)
    # A glossy highlight across the top third of the letters.
    hi = Image.new("L", layer.size, 0)
    if gb:
        ImageDraw.Draw(hi).rectangle((0, gb[1], layer.size[0], gb[1] + (gb[3] - gb[1]) * 0.33), fill=70)
    layer.paste(Image.new("RGBA", layer.size, (255, 255, 255, 255)), (0, 0), ImageChops.multiply(hi, fill))
    layer = layer.rotate(tilt, resample=Image.BICUBIC, expand=True)
    img.paste(layer, (int(x * W - layer.size[0] / 2), int(y * H - layer.size[1] / 2)), layer)
    return img


def key_mask(matte):
    """The subject's alpha from a green-box matte: not-green is subject, edges softened."""
    import numpy as np
    a = np.asarray(matte.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # Only near-pure green is background: glass seen against the green box is green-tinted and
    # must stay subject (the marble's shell was keyed away at a looser threshold).
    green = (g > 170) & (g - r > 150) & (g - b > 150)
    m = Image.fromarray(np.where(green, 0, 255).astype(np.uint8), "L")
    m = m.filter(ImageFilter.MedianFilter(5))
    # Open: drop loose sparkle specks, which otherwise each get a sticker outline.
    k = max(5, (matte.size[0] // 240) | 1)
    m = m.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
    return m.filter(ImageFilter.GaussianBlur(1.2))


def sunburst(size, centre, rays=18, color=(255, 255, 255), alpha=46):
    """Alternating soft rays from `centre` (pixels), the charts' radial burst."""
    import math
    W, H = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    R = (W + H) * 1.5
    cx, cy = centre
    for i in range(rays):
        a0 = (i / rays) * math.tau
        a1 = a0 + math.tau / rays / 2
        d.polygon([(cx, cy), (cx + R * math.cos(a0), cy + R * math.sin(a0)), (cx + R * math.cos(a1), cy + R * math.sin(a1))], fill=color + (alpha,))
    glow = Image.new("L", size, 0)
    gr = min(W, H) * 0.42
    ImageDraw.Draw(glow).ellipse((cx - gr, cy - gr, cx + gr, cy + gr), fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(gr * 0.5))
    layer = layer.filter(ImageFilter.GaussianBlur(3))
    white = Image.new("RGBA", size, color + (255,))
    layer = Image.alpha_composite(layer, Image.composite(white, Image.new("RGBA", size, (0, 0, 0, 0)), glow))
    return layer


def cutout(img, mask, outline=22, rim=7, blur=14):
    """The subject cut out with a white sticker outline and a dark rim, over its own scene
    blurred and lit by a sunburst."""
    W, H = img.size
    bb = mask.point(lambda v: 255 if v > 128 else 0).getbbox() or (0, 0, W, H)
    centre = ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
    bg = ImageEnhance.Color(img.filter(ImageFilter.GaussianBlur(blur))).enhance(1.15).convert("RGBA")
    bg = Image.alpha_composite(bg, sunburst((W, H), centre))
    hard = mask.point(lambda v: 255 if v > 100 else 0)
    def grow(px):
        size = px * 2 + 1
        g = hard
        # MaxFilter is slow for big kernels: grow in steps.
        while size > 1:
            k = min(size, 9) | 1
            g = g.filter(ImageFilter.MaxFilter(k))
            size -= k - 1
        return g.filter(ImageFilter.GaussianBlur(1.5))
    rim_m = grow(outline + rim)
    white_m = grow(outline)
    bg.paste(Image.new("RGBA", (W, H), (30, 20, 60, 255)), (0, 0), rim_m)
    bg.paste(Image.new("RGBA", (W, H), (255, 255, 255, 255)), (0, 0), white_m)
    bg.paste(img.convert("RGBA"), (0, 0), mask)
    return bg.convert("RGB")


def main():
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    base = Path(sys.argv[1]).parent
    for item in spec:
        src = Image.open(base / item["src"]).convert("RGB")
        w, h = item.get("size", [1920, 1080])
        img = crop(src, w, h, item.get("cx", 0.5), item.get("cy", 0.5), item.get("zoom", 1.0))
        if "matte" in item:
            mask = key_mask(crop(Image.open(base / item["matte"]).convert("RGB"), w, h, item.get("cx", 0.5), item.get("cy", 0.5), item.get("zoom", 1.0)))
            img = grade(img, item.get("sat", 1.18), item.get("con", 1.08), 0)
            scale = w / 1920
            img = cutout(img, mask, int(item.get("outline", 22) * scale), int(item.get("rim", 7) * scale), item.get("blur", 14) * scale)
            img = grade(img, 1.0, 1.0, item.get("vignette", 0.22))
        else:
            img = grade(img, item.get("sat", 1.18), item.get("con", 1.08), item.get("vignette", 0.28))
        for t in item.get("text", []):
            t = dict(t)
            if "colors" in t:
                t["colors"] = [tuple(c) for c in t["colors"]]
            if "outline" in t:
                t["outline"] = tuple(t["outline"])
            img = words(img, **t)
        name = item["out"]
        img.save(out / name, quality=93) if name.endswith(".jpg") else img.save(out / name)
        print("wrote", name, img.size)


if __name__ == "__main__":
    main()
