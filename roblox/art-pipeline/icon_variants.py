"""Four icon candidates with SDXL (the first prompt's "cat's-eye" drew a cat)."""
import glob, os, torch
from diffusers import StableDiffusionXLPipeline

out = "D:/agent-work/ringer3d/roblox-art/out"
snap = glob.glob("D:/hf-cache/hub/models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/*")[0]
pipe = StableDiffusionXLPipeline.from_pretrained(snap, torch_dtype=torch.float16, variant="fp16", use_safetensors=True).to("cuda")
NEG = "text, letters, words, watermark, logo, signature, blurry, low quality, deformed, animal, cat, face, people, hands, frame, border"
PROMPT = ("one big glossy orange glass marble with a bright swirl inside, smashing into a tight cluster of colourful glass marbles "
          "on a warm wooden table, a white chalk line circle, marbles scattering outward with sparks, centred bold composition, "
          "game app icon, glossy stylised 3d render, pixar style, vibrant saturated colours, soft studio lighting, high detail")
for seed in (12, 13, 14, 15):
    img = pipe(prompt=PROMPT, negative_prompt=NEG, width=1024, height=1024, num_inference_steps=34, guidance_scale=7.0,
               generator=torch.Generator("cuda").manual_seed(seed)).images[0]
    img.save(os.path.join(out, f"icon-v{seed}.png"))
    print("saved", seed, flush=True)
