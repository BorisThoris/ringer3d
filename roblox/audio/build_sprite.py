"""Build the Roblox game's sound sprite: one audio file holding every sound the web game plays.

The web game (src/render/audio.ts) plays Kenney's CC0 impact recordings (public/assets/sfx) and
synthesises the rest in code: a rolling rumble coloured by the surface, chimes, an ambient pad
per field mood. Roblox has no Web Audio, so this script renders all of it offline into one file,
laid end to end with silence between, and writes where each sound starts and ends. The game
plays a sound as a PlaybackRegion of that one asset (roblox/src/ReplicatedStorage/Ringer/Sfx.luau).

On top of the web game's set it adds the shop's sounds: coins, a purchase, the shimmer when a
marble is equipped, and the reveal stings for each rarity of a Marble Bag.

    py roblox/audio/build_sprite.py        -> roblox/audio/ringer-sfx.ogg, roblox/audio/sprite.json
"""
import json
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SFX = os.path.join(ROOT, 'public', 'assets', 'sfx')
SR = 44100
GAP = 0.3  # silence between sounds, so a region never bleeds into its neighbour
rng = np.random.default_rng(7)


def decode(path):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'a.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(SR), out], check=True)
        a, _ = sf.read(out, dtype='float32')
    return a


def t(sec):
    return np.arange(int(sec * SR)) / SR


def env(n, attack, decay):
    """Attack then exponential decay (decay = time to ~-60 dB)."""
    x = np.arange(n) / SR
    e = np.exp(-6.9 * x / decay)
    a = int(attack * SR)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e


def filt(x, kind, freq, q=0.7, order=2):
    if kind == 'bandpass':
        bw = freq / max(q, 0.1)
        lo, hi = max(20, freq - bw / 2), min(SR / 2 - 100, freq + bw / 2)
        sos = butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    else:
        sos = butter(order, freq, btype='low' if kind == 'lowpass' else 'high', fs=SR, output='sos')
    return sosfilt(sos, x)


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return (x / m * peak).astype('float32')


def loopable(x, fade=0.25):
    """Crossfade the tail into the head so the clip loops without a click."""
    f = int(fade * SR)
    head, body, tail = x[:f], x[f:-f], x[-f:]
    ramp = np.linspace(0, 1, f)
    return np.concatenate([body, tail * (1 - ramp) + head * ramp])


def tone(freq, sec, kind='sine', decay=0.5, attack=0.005, vib=0.0):
    x = t(sec)
    ph = 2 * np.pi * freq * x + (vib * np.sin(2 * np.pi * 5.5 * x) if vib else 0)
    if kind == 'sine':
        w = np.sin(ph)
    elif kind == 'triangle':
        w = 2 / np.pi * np.arcsin(np.sin(ph))
    elif kind == 'bell':  # inharmonic partials: glassy, toy-box
        w = np.sin(ph) + 0.45 * np.sin(2.76 * ph) * np.exp(-x * 9) + 0.2 * np.sin(5.4 * ph) * np.exp(-x * 18)
    else:
        w = np.sin(ph)
    return w * env(len(x), attack, decay)


def seq(notes, step, kind='sine', decay=0.5, tail=0.6, vol=1.0):
    total = step * len(notes) + tail
    out = np.zeros(int(total * SR))
    for i, f in enumerate(notes):
        s = tone(f, tail + 0.1, kind, decay)
        a = int(i * step * SR)
        n = min(len(s), len(out) - a)
        out[a:a + n] += s[:n]
    return out * vol


def sparkle(sec, density, lo, hi, decay=0.06):
    out = np.zeros(int(sec * SR))
    for _ in range(int(density * sec)):
        a = rng.integers(0, len(out) - int(0.2 * SR))
        s = tone(rng.uniform(lo, hi), 0.2, 'sine', decay) * rng.uniform(0.3, 1)
        out[a:a + len(s)] += s
    return out


def noise(sec):
    return rng.uniform(-1, 1, int(sec * SR))


# ---- The web game's synthesised sounds ----------------------------------------------------

def chime(kind):
    """audio.ts chime(): the same notes, steps and decays."""
    notes = {'capture': [880, 1108.7, 1318.5], 'win': [523.3, 659.3, 784, 1046.5, 1318.5], 'lose': [392, 349.2, 293.7], 'turn': [660, 990], 'tap': [1200]}[kind]
    step = 0 if kind == 'tap' else 0.11 if kind == 'win' else 0.07
    dec = 0.05 if kind == 'tap' else 0.5
    return seq(notes, step, 'triangle' if kind == 'lose' else 'sine', dec, tail=0.6, vol=0.08 / 0.22 if kind == 'tap' else 1)


ROLL_TONE = {  # audio.ts ROLL_TONE
    'wood': ('lowpass', 380, 4), 'concrete': ('bandpass', 950, 0.7), 'grass': ('highpass', 2600, 0.6),
    'sand': ('bandpass', 3600, 0.5), 'ice': ('bandpass', 1900, 3.5), 'gravel': ('bandpass', 1400, 0.6), 'turf': ('lowpass', 900, 0.8),
}


def roll(kind):
    k, f, q = ROLL_TONE[kind]
    x = filt(noise(2.5), k, f, q)
    if kind == 'gravel':  # crunchy: grit bursts on top
        x += filt(noise(2.5) * (rng.uniform(0, 1, int(2.5 * SR)) > 0.997), 'bandpass', 2400, 1) * 4
    return loopable(norm(x, 0.8))


PADS = {  # audio.ts startPad(): the same chords, an octave down, detuned saws through a lowpass
    'bright': [261.6, 329.6, 392, 493.9], 'calm': [220, 277.2, 329.6, 415.3], 'night': [196, 233.1, 293.7, 349.2],
    'cold': [246.9, 311.1, 370, 466.2], 'ominous': [110, 130.8, 155.6, 185],
}


def pad(mood):
    sec = 16.25
    x = t(sec)
    out = np.zeros(len(x))
    for f in PADS[mood]:
        for det in (-6, 6):
            fr = f / 2 * 2 ** (det / 1200)
            saw = 2 * ((fr * x) % 1) - 1
            lfo = 1 + 0.6 * np.sin(2 * np.pi * rng.uniform(0.07, 0.17) * x + rng.uniform(0, 6))
            out += saw * lfo
    out = filt(out, 'lowpass', 500 if mood == 'ominous' else 900, order=2)
    return loopable(norm(out, 0.5))


# ---- The Roblox game's own: the shop and the bag -------------------------------------------

def coin():
    return norm(seq([1567.98, 2093], 0.07, 'bell', 0.25, tail=0.35), 0.7)


def buy():
    x = seq([784, 988, 1175, 1568], 0.06, 'bell', 0.4, tail=0.6)
    x[: len(x)] += np.pad(sparkle(0.8, 30, 3000, 6000), (0, max(0, len(x) - int(0.8 * SR))))[: len(x)] * 0.25
    return norm(x, 0.8)


def equip():
    """A rising glassy shimmer: the marble comes alive."""
    sec = 0.9
    x = t(sec)
    f = 600 * 2 ** (x / sec * 2)
    sweep = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.02, 0.9) * 0.4
    return norm(sweep + sparkle(sec, 40, 2500, 7000) * 0.5, 0.75)


def whoosh(sec=0.45, lo=400, hi=3000):
    x = t(sec)
    n = noise(sec)
    out = np.zeros(len(n))
    # a swept bandpass, block by block
    blocks = 24
    for b in range(blocks):
        a, z = b * len(n) // blocks, (b + 1) * len(n) // blocks
        fc = lo * (hi / lo) ** (b / blocks)
        out[a:z] = filt(n, 'bandpass', fc, 1.2)[a:z]
    shape = np.sin(np.pi * x / sec) ** 2
    return norm(out * shape, 0.6)


def reveal(rarity):
    """The bag opens: a drum-roll of ticks, then a sting that grows with rarity."""
    base = {'common': [523.3, 659.3, 784], 'rare': [587.3, 740, 880, 1174.7], 'epic': [659.3, 830.6, 987.8, 1318.5, 1661.2], 'legendary': [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093]}[rarity]
    step = 0.06 if rarity != 'legendary' else 0.07
    x = seq(base, step, 'bell', 0.7 if rarity in ('common', 'rare') else 1.2, tail=1.2 if rarity != 'legendary' else 2.0)
    if rarity in ('epic', 'legendary'):
        sp = sparkle(len(x) / SR, 60 if rarity == 'epic' else 110, 2500, 8000, 0.08)
        x += sp * 0.35
        # a warm chord bed under the sting
        chord = sum(tone(f / 2, len(x) / SR, 'triangle', 1.6, 0.05) for f in base[:3])
        x += chord * 0.25
    if rarity == 'legendary':
        x = np.concatenate([whoosh(0.5, 200, 6000) * 0.6, x])
    return norm(x, 0.85)


def tick():
    return norm(tone(2400, 0.06, 'sine', 0.03) + filt(noise(0.06), 'highpass', 4000) * env(int(0.06 * SR), 0, 0.02) * 0.3, 0.5)


def charge():
    """A soft rising hum while the shot charges (loops)."""
    sec = 2.0
    x = t(sec)
    w = np.sin(2 * np.pi * 220 * x) + 0.4 * np.sin(2 * np.pi * 330 * x) + 0.2 * np.sin(2 * np.pi * 440 * x)
    w *= 1 + 0.3 * np.sin(2 * np.pi * 6 * x)
    return loopable(norm(w, 0.35), 0.2)


def main():
    sounds = []  # (name, samples, loop)
    takes = sorted({f.rsplit('_', 1)[0] for f in os.listdir(SFX) if f.endswith('.ogg')})
    for name in takes:
        for i in range(5):
            p = os.path.join(SFX, f'{name}_{i:03d}.ogg')
            if os.path.exists(p):
                sounds.append((f'{name}_{i}', decode(p), False))
    for k in ('capture', 'win', 'lose', 'turn', 'tap'):
        sounds.append((f'chime_{k}', norm(chime(k), 0.6), False))
    for k in ROLL_TONE:
        sounds.append((f'roll_{k}', roll(k), True))
    for k in PADS:
        sounds.append((f'pad_{k}', pad(k), True))
    sounds += [('coin', coin(), False), ('buy', buy(), False), ('equip', equip(), False), ('whoosh', whoosh(), False), ('tick', tick(), False), ('charge', charge(), True)]
    for r in ('common', 'rare', 'epic', 'legendary'):
        sounds.append((f'reveal_{r}', reveal(r), False))

    gap = np.zeros(int(GAP * SR), dtype='float32')
    parts, index, at = [gap], {}, GAP
    for name, a, loop in sounds:
        a = np.asarray(a, dtype='float32')
        index[name] = {'start': round(at, 4), 'stop': round(at + len(a) / SR, 4), 'loop': loop}
        parts += [a, gap]
        at += len(a) / SR + GAP
    audio = np.clip(np.concatenate(parts), -1, 1)
    out = os.path.join(HERE, 'ringer-sfx.ogg')
    # libsndfile's own Vorbis writer overflows the stack on long files: write WAV, encode with ffmpeg.
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, 'sprite.wav')
        sf.write(wav, audio, SR, subtype='PCM_16')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '6', out], check=True)
    with open(os.path.join(HERE, 'sprite.json'), 'w') as f:
        json.dump({'file': 'ringer-sfx.ogg', 'length': round(at, 3), 'sounds': index}, f, indent=1)
    print(f'{len(index)} sounds, {at:.1f} s, {os.path.getsize(out) / 1e6:.2f} MB -> {out}')


if __name__ == '__main__':
    main()
