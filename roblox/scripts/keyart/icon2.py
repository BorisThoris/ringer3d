"""Icon v2 in the chart style (Steal An Egg / Throw Food): the avatar big and close, the hero object
big beside it, each a sticker cutout over a bright blurred scene and a sunburst. Built from the
pass11 mythic beauty + matte, split into an avatar layer and a marble layer.
Usage: py icon2.py <out.png> [avatar_scale] [marble_diam] [marble_cx] [marble_cy]"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter
sys.path.insert(0, str(Path(__file__).parent))
from compose import key_mask, sunburst, grade

BASE = Path(__file__).parent / "pass11"
beauty = Image.open(BASE / "04-mythic-a.png").convert("RGB")
matte = Image.open(BASE / "05-mythic-a-matte.png").convert("RGB")
W, H = beauty.size
mask = key_mask(matte)
beauty = ImageEnhance.Color(beauty).enhance(1.2)
beauty = ImageEnhance.Contrast(beauty).enhance(1.08)

out = sys.argv[1]
s = float(sys.argv[2]) if len(sys.argv) > 2 else 0.55
md = int(sys.argv[3]) if len(sys.argv) > 3 else 290
mcx = float(sys.argv[4]) if len(sys.argv) > 4 else 256
mcy = float(sys.argv[5]) if len(sys.argv) > 5 else 132
N = 512


def layer(box):
    """RGBA cut of the subject inside box (orig pixels)."""
    rgba = beauty.crop(box).convert("RGBA")
    rgba.putalpha(mask.crop(box))
    return rgba


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
        return g.filter(ImageFilter.GaussianBlur(1.2))
    outl = Image.new("RGBA", big.size, (0, 0, 0, 0))
    outl.paste(Image.new("RGBA", big.size, (30, 20, 60, 255)), (0, 0), grow(outline + rim))
    outl.paste(Image.new("RGBA", big.size, (255, 255, 255, 255)), (0, 0), grow(outline))
    outl.alpha_composite(rgba, (pad, pad))
    return outl, pad


# Background: the bright lobby, blurred, zoomed on its colourful lower half, plus a sunburst.
from compose import gradient
bg = gradient((N, N), [(255, 236, 120), (255, 170, 40), (255, 90, 60)]).convert("RGBA")
bg = Image.alpha_composite(bg, sunburst((N, N), (mcx, mcy), rays=16, alpha=60))

# Marble: the upper half of the matte.
mb = mask.crop((0, 0, W, int(H * 0.5))).point(lambda v: 255 if v > 128 else 0).getbbox()
marble = layer(mb)
ms = md / marble.size[0]
marble = marble.resize((md, int(marble.size[1] * ms)), Image.LANCZOS)
mst, mp = sticker(marble, 7, 3)
# Avatar: head to waist.
ab = (int(W * 0.30), int(H * 0.53), int(W * 0.66), int(H * 0.85))
ab = (ab[0], ab[1], ab[2], ab[3])
av = layer(ab)
av = av.resize((int(av.size[0] * s), int(av.size[1] * s)), Image.LANCZOS)
ast, ap = sticker(av, 9, 3)

bg.alpha_composite(mst, (int(mcx - mst.size[0] / 2), int(mcy - mst.size[1] / 2)))
bg.alpha_composite(ast, (int(N / 2 - ast.size[0] / 2), N - ast.size[1] + ap))
img = grade(bg.convert("RGB"), 1.05, 1.03, 0.12)
img.save(out)
print("wrote", out, "avatar", av.size, "marble", marble.size)
