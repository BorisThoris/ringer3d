"""Round 2 art: Halloween icon candidates and two new thumbnail backgrounds (SDXL, local)."""
import glob, os, torch
from diffusers import StableDiffusionXLPipeline

out = "D:/agent-work/ringer3d/roblox-art/out2"
os.makedirs(out, exist_ok=True)
snap = glob.glob("D:/hf-cache/hub/models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/*")[0]
for f in glob.glob(snap + "/**/*fp16*.safetensors", recursive=True):
    with open(f, "rb") as fh:
        while fh.read(64 << 20):
            pass
pipe = StableDiffusionXLPipeline.from_pretrained(snap, torch_dtype=torch.float16, variant="fp16", use_safetensors=True).to("cuda")
NEG = "text, letters, words, watermark, logo, signature, blurry, low quality, deformed, people, hands, frame, border, cat, animal"
STYLE = "glossy stylised 3d render, pixar style, vibrant saturated colours, strong rim light, high contrast, high detail"
JOBS = [(f"icon-{s}", 1024, 1024, s,
         "one huge glossy orange glass marble with a glowing carved jack-o-lantern face inside, crashing into a cluster of colourful glass marbles, "
         "sparks and marbles flying, dark purple night background with a soft glow behind it, single bold focal point, centred, game app icon, " + STYLE)
        for s in (101, 102, 103, 104, 105, 106)]
JOBS += [
    ("thumb-duel", 1344, 768, 201, "two big glossy glass marbles, one fiery orange and one electric blue, colliding head on in the middle of a white chalk circle on a wooden table, "
     "shockwave and sparks, smaller marbles scattering, dramatic low angle, empty space at the top, " + STYLE),
    ("thumb-halloween", 1344, 768, 202, "a glowing orange jack-o-lantern glass marble on a dark wooden table with carved pumpkins, candles and purple fog, "
     "other glass marbles around it, cosy spooky halloween mood, empty space at the top, " + STYLE),
]
for name, w, h, seed, prompt in JOBS:
    path = os.path.join(out, name + ".png")
    if os.path.exists(path):
        continue
    img = pipe(prompt=prompt, negative_prompt=NEG, width=w, height=h, num_inference_steps=34, guidance_scale=7.0, generator=torch.Generator("cuda").manual_seed(seed)).images[0]
    img.save(path)
    print("saved", name, flush=True)
print("done", flush=True)
