import type { SurfaceKind } from '../game/arenas';
import { vibrate } from '../platform';
import { sample } from './assets';

/** Real recordings (Kenney Impact Sounds, CC0) for each surface's contacts. */
const SURFACE_SOUNDS: Record<SurfaceKind, { kerb: string; tap: string; kerbVol: number; tapVol: number }> = {
  wood: { kerb: 'impactWood_medium', tap: 'impactWood_light', kerbVol: 0.9, tapVol: 0.5 },
  concrete: { kerb: 'impactPlate_medium', tap: 'footstep_concrete', kerbVol: 0.8, tapVol: 0.35 },
  grass: { kerb: 'impactSoft_heavy', tap: 'footstep_grass', kerbVol: 0.9, tapVol: 0.4 },
  sand: { kerb: 'impactSoft_heavy', tap: 'impactSoft_medium', kerbVol: 0.8, tapVol: 0.35 },
  ice: { kerb: 'impactPlate_light', tap: 'footstep_snow', kerbVol: 0.8, tapVol: 0.3 },
};

/** How each surface colours the rolling rumble: filter shape and loudness. */
const ROLL_TONE: Record<SurfaceKind, { type: BiquadFilterType; freq: number; q: number; gain: number }> = {
  wood: { type: 'lowpass', freq: 380, q: 4, gain: 1.1 }, // hollow, resonant desk
  concrete: { type: 'bandpass', freq: 950, q: 0.7, gain: 0.9 }, // gritty
  grass: { type: 'highpass', freq: 2600, q: 0.6, gain: 0.45 }, // soft swish
  sand: { type: 'bandpass', freq: 3600, q: 0.5, gain: 0.55 }, // hiss
  ice: { type: 'bandpass', freq: 1900, q: 3.5, gain: 0.75 }, // thin, ringing
};

const TAKES = 5;

/**
 * Sound: recorded glass impacts and surface contacts (CC0, public/assets/sfx), a synthesised
 * rolling rumble shaped by the surface, chimes and an ambient pad. If a recording has not
 * loaded the synthesised version plays, so there is never silence.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private surface: SurfaceKind = 'concrete';
  private buffers = new Map<string, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private padNodes: AudioNode[] = [];
  private lastClack = 0;
  sfxVolume = 0.8;
  musicVolume = 0.35;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startRoll();
    this.preload(['impactGlass_light', 'impactGlass_medium', 'impactGlass_heavy']);
    this.setSurface(this.surface);
  }

  private preload(names: string[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const n of names) {
      for (let i = 0; i < TAKES; i++) {
        const key = `${n}_${String(i).padStart(3, '0')}`;
        if (this.buffers.has(key)) continue;
        void sample(ctx, key).then((b) => b && this.buffers.set(key, b));
      }
    }
  }

  /** Play a random take of a recording; false if none is loaded yet. */
  private play(name: string, vol: number, rate = 1): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const takes: AudioBuffer[] = [];
    for (let i = 0; i < TAKES; i++) {
      const b = this.buffers.get(`${name}_${String(i).padStart(3, '0')}`);
      if (b) takes.push(b);
    }
    if (!takes.length) return false;
    const src = ctx.createBufferSource();
    src.buffer = takes[Math.floor(Math.random() * takes.length)];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfx);
    src.start();
    return true;
  }

  /** The ground changes: its contact recordings and the colour of the rolling sound. */
  setSurface(kind: SurfaceKind) {
    this.surface = kind;
    const s = SURFACE_SOUNDS[kind];
    this.preload([s.kerb, s.tap]);
    const ctx = this.ctx;
    if (ctx && this.rollFilter) {
      const t = ROLL_TONE[kind];
      this.rollFilter.type = t.type;
      this.rollFilter.frequency.setTargetAtTime(t.freq, ctx.currentTime, 0.05);
      this.rollFilter.Q.setTargetAtTime(t.q, ctx.currentTime, 0.05);
    }
  }

  /** The thumb flick: the shooter scuffs the surface as it leaves. */
  launch(power: number) {
    const s = SURFACE_SOUNDS[this.surface];
    this.play(s.tap, s.tapVol * (0.4 + power * 0.6));
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (this.ctx) {
      this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
      this.music.gain.setTargetAtTime(music, this.ctx.currentTime, 0.2);
    }
  }

  /** Glass-on-glass clack. strength ~ contact force. */
  clack(strength: number, kind: 'marble' | 'kerb' = 'marble') {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastClack < 0.012) return;
    this.lastClack = now;
    const vol = Math.min(1, Math.log10(1 + strength) / 3.2);
    if (vol < 0.04) return;
    // Real recordings first: glass on glass, or the field's own boundary material.
    if (kind === 'kerb') {
      const s = SURFACE_SOUNDS[this.surface];
      if (this.play(s.kerb, vol * s.kerbVol)) return;
    } else {
      const take = vol > 0.75 ? 'impactGlass_heavy' : vol > 0.4 ? 'impactGlass_medium' : 'impactGlass_light';
      if (this.play(take, 0.25 + vol * 0.75, 1.15)) return;
    }
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.sfx);

    if (kind === 'kerb') {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(70, now + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.6, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + 0.16);
      return;
    }
    // Two inharmonic sine partials + a click of filtered noise = convincing glass.
    const base = 2600 + Math.random() * 900;
    for (const [mult, amp, dec] of [
      [1, 0.5, 0.09],
      [2.76, 0.25, 0.05],
      [5.4, 0.1, 0.025],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = base * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dec);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + dec + 0.02);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5000;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    n.connect(bp).connect(ng).connect(out);
    n.start(now, Math.random());
    n.stop(now + 0.03);
  }

  private startRoll() {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rollFilter = lp;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    n.connect(lp).connect(this.rollGain).connect(this.sfx);
    n.start();
  }

  /** Continuous rolling rumble, driven every frame by total marble speed. */
  setRolling(speed: number) {
    if (!this.ctx || !this.rollGain) return;
    const v = Math.min(0.35, speed * 0.02) * ROLL_TONE[this.surface].gain;
    this.rollGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  chime(kind: 'capture' | 'turn' | 'win' | 'lose' | 'tap') {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes =
      kind === 'capture' ? [880, 1108.7, 1318.5] : kind === 'win' ? [523.3, 659.3, 784, 1046.5, 1318.5] : kind === 'lose' ? [392, 349.2, 293.7] : kind === 'turn' ? [660, 990] : [1200];
    const step = kind === 'tap' ? 0 : kind === 'win' ? 0.11 : 0.07;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = kind === 'lose' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * step;
      const vol = kind === 'tap' ? 0.08 : 0.22;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'tap' ? 0.05 : 0.5));
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.6);
    });
  }

  /** Slow, warm ambient pad; chord set per arena mood. */
  startPad(mood: 'bright' | 'calm' | 'night' | 'cold' | 'ominous') {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopPad();
    const chords: Record<string, number[]> = {
      bright: [261.6, 329.6, 392, 493.9],
      calm: [220, 277.2, 329.6, 415.3],
      night: [196, 233.1, 293.7, 349.2],
      cold: [246.9, 311.1, 370, 466.2],
      ominous: [110, 130.8, 155.6, 185],
    };
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = mood === 'ominous' ? 500 : 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 3);
    lp.connect(g).connect(this.music);
    this.padNodes.push(lp, g);
    for (const f of chords[mood]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f / 2;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        // Gentle tremolo
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.1;
        const lg = ctx.createGain();
        lg.gain.value = 0.03;
        lfo.connect(lg).connect(og.gain);
        o.connect(og).connect(lp);
        o.start();
        lfo.start();
        this.padNodes.push(o, lfo);
      }
    }
  }

  stopPad() {
    for (const n of this.padNodes) {
      if (n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      n.disconnect();
    }
    this.padNodes = [];
  }
}

export const sound = new Sound();

export function haptic(ms: number) {
  vibrate(ms);
}
