"""Ringer 3D Roblox store art with Z-Image-Turbo (local, D:/hf-cache).
python gen.py <outdir>   -- writes one PNG per job, skips files that already exist."""
import os, sys, torch
from diffusers import ZImagePipeline

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
STYLE = "glossy stylised 3D toy render, vibrant saturated colours, soft studio lighting, clean shapes, high detail, no text, no letters, no watermark"
JOBS = [
    ("icon", 1024, 1024, 11, "A big glowing orange cat's-eye glass marble smashing into a cluster of colourful glass marbles inside a white chalk ring on a warm wooden table, marbles flying outward, bold centred composition for a game icon, " + STYLE),
    ("thumb-desk", 1536, 864, 21, "Wide action shot: colourful glass marbles exploding out of a white chalk circle drawn on a wooden desk, a fiery orange shooter marble crashing into the cluster with a bright motion trail, pencils and an eraser nearby, low camera angle, " + STYLE),
    ("thumb-boss", 1536, 864, 31, "A huge black obsidian marble with glowing orange cracks hovering above a frozen blue ice lake with a chalk ring, smaller glass marbles scattered on the ice, dramatic rim light, epic boss battle mood, " + STYLE),
    ("thumb-collection", 1536, 864, 41, "A treasure showcase of rare collectible glass marbles on small velvet pedestals in a row: a glowing green aurora marble, a purple galaxy marble with stars, a shiny golden metallic marble, a neon cyan marble, a ruby red marble, sparkles and spotlights, " + STYLE),
    ("pass-vip", 1024, 1024, 51, "A shiny golden marble wearing a small jewelled golden crown, centred, sparkles, rich purple gradient background, game shop icon, " + STYLE),
    ("pass-trails", 1024, 1024, 61, "A blue glass marble zooming diagonally leaving a long bright glowing cyan comet trail, centred, dark navy background, game shop icon, " + STYLE),
    ("prod-coins500", 1024, 1024, 71, "A small neat stack of shiny gold coins, centred, soft teal background, game shop icon, " + STYLE),
    ("prod-coins1500", 1024, 1024, 72, "A big pile of shiny gold coins with a few sparkles, centred, soft teal background, game shop icon, " + STYLE),
    ("prod-coins5000", 1024, 1024, 73, "An overflowing treasure chest full of gold coins glowing, centred, soft teal background, game shop icon, " + STYLE),
    ("prod-bag", 1024, 1024, 74, "A small brown leather drawstring pouch with colourful glass marbles spilling out of it, one marble glowing, centred, warm orange background, game shop icon, " + STYLE),
    ("badge-welcome", 1024, 1024, 81, "A single orange glass marble resting on a white chalk ring on a wooden surface, round badge emblem composition, centred, " + STYLE),
    ("badge-firstWin", 1024, 1024, 82, "A golden trophy cup holding a glowing blue glass marble, round badge emblem composition, centred, confetti, " + STYLE),
    ("badge-towerTop", 1024, 1024, 83, "A cracked black obsidian marble splitting apart with orange light bursting from the cracks, round badge emblem composition, centred, " + STYLE),
    ("badge-limited", 1024, 1024, 84, "A glowing green aurora glass marble in a small glass display case with a silver plaque, round badge emblem composition, centred, " + STYLE),
    ("badge-sweep", 1024, 1024, 85, "Thirteen colourful glass marbles arranged in a neat cross shape, sparkling, top-down view, round badge emblem composition, centred, " + STYLE),
]

# Straight onto the GPU: staging ~20 GB in RAM first paged the machine to a crawl.
pipe = ZImagePipeline.from_pretrained("Tongyi-MAI/Z-Image-Turbo", torch_dtype=torch.bfloat16, cache_dir="D:/hf-cache/hub", device_map="cuda", low_cpu_mem_usage=True)
print("loaded", flush=True)
for name, w, h, seed, prompt in JOBS:
    path = os.path.join(out, name + ".png")
    if os.path.exists(path):
        continue
    img = pipe(prompt=prompt, width=w, height=h, num_inference_steps=9, guidance_scale=0.0, generator=torch.Generator("cuda").manual_seed(seed)).images[0]
    img.save(path)
    print("saved", path, flush=True)
print("done", flush=True)
