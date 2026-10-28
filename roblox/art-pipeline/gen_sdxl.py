"""Ringer 3D Roblox store art with SDXL base (local, D:/hf-cache), same jobs as gen.py.
The weights are read once sequentially first so loading comes from the file cache, not
random reads on the hard drive."""
import os, sys, glob, torch
from diffusers import StableDiffusionXLPipeline

sys.path.insert(0, os.path.dirname(__file__))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

snap = glob.glob("D:/hf-cache/hub/models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/*")[0]
for f in glob.glob(snap + "/**/*fp16*.safetensors", recursive=True):
    with open(f, "rb") as fh:
        while fh.read(64 << 20):
            pass
    print("warmed", os.path.basename(f), flush=True)

NEG = "text, letters, words, watermark, logo, signature, blurry, low quality, deformed, jpeg artifacts, frame, border, hands, people"
STYLE = "glossy stylised 3d render, pixar style, vibrant saturated colours, soft studio lighting, high detail, octane render"
# (name, width, height, seed, prompt) -- SDXL works best near 1 megapixel.
JOBS = [
    ("icon", 1024, 1024, 11, "big glowing orange cat's-eye glass marble crashing into colourful glass marbles inside a white chalk circle on a wooden table, marbles flying, " + STYLE),
    ("thumb-desk", 1344, 768, 21, "colourful glass marbles exploding out of a white chalk circle on a wooden desk, fiery orange marble with motion trail hitting the cluster, low angle, " + STYLE),
    ("thumb-boss", 1344, 768, 31, "huge black obsidian marble with glowing orange cracks above a frozen blue ice lake with a chalk circle, small glass marbles on the ice, dramatic, " + STYLE),
    ("thumb-collection", 1344, 768, 41, "row of rare glowing glass marbles on velvet pedestals, green aurora marble, purple galaxy marble, gold metal marble, cyan neon marble, ruby marble, spotlights, sparkles, " + STYLE),
    ("pass-vip", 1024, 1024, 51, "shiny golden marble wearing a small jewelled gold crown, sparkles, purple background, game icon, " + STYLE),
    ("pass-trails", 1024, 1024, 61, "blue glass marble flying with a long glowing cyan comet trail, dark navy background, game icon, " + STYLE),
    ("prod-coins500", 1024, 1024, 71, "small stack of shiny gold coins, teal background, game icon, " + STYLE),
    ("prod-coins1500", 1024, 1024, 72, "big pile of shiny gold coins, sparkles, teal background, game icon, " + STYLE),
    ("prod-coins5000", 1024, 1024, 73, "open treasure chest overflowing with glowing gold coins, teal background, game icon, " + STYLE),
    ("prod-bag", 1024, 1024, 74, "small brown leather drawstring pouch with colourful glass marbles spilling out, orange background, game icon, " + STYLE),
    ("badge-welcome", 1024, 1024, 81, "single orange glass marble on a white chalk circle on wood, round emblem, centered, " + STYLE),
    ("badge-firstWin", 1024, 1024, 82, "golden trophy cup holding a glowing blue glass marble, confetti, round emblem, centered, " + STYLE),
    ("badge-towerTop", 1024, 1024, 83, "cracked black obsidian marble splitting apart with orange light bursting out, round emblem, centered, " + STYLE),
    ("badge-limited", 1024, 1024, 84, "glowing green aurora glass marble inside a small glass display case, round emblem, centered, " + STYLE),
    ("badge-sweep", 1024, 1024, 85, "thirteen colourful glass marbles arranged in a cross shape, top-down, sparkles, round emblem, centered, " + STYLE),
]

pipe = StableDiffusionXLPipeline.from_pretrained(snap, torch_dtype=torch.float16, variant="fp16", use_safetensors=True).to("cuda")
print("loaded", flush=True)
for name, w, h, seed, prompt in JOBS:
    path = os.path.join(out, name + ".png")
    if os.path.exists(path):
        continue
    img = pipe(prompt=prompt, negative_prompt=NEG, width=w, height=h, num_inference_steps=32, guidance_scale=6.5, generator=torch.Generator("cuda").manual_seed(seed)).images[0]
    img.save(path)
    print("saved", path, flush=True)
print("done", flush=True)
