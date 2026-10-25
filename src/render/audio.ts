import { vibrate } from '../platform';

export type Track = 'menu' | 'match' | 'boss';

/** Synthesised sound (glass clacks, rolling, chimes, an ambient pad) plus looped music tracks. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private rollGain: GainNode | null = null;
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
    if (this.wanted) void this.playTrack(this.wanted);
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
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    n.connect(lp).connect(this.rollGain).connect(this.sfx);
    n.start();
  }

  /** Continuous rolling rumble, driven every frame by total marble speed. */
  setRolling(speed: number) {
    if (!this.ctx || !this.rollGain) return;
    const v = Math.min(0.35, speed * 0.02);
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

  // ---- Music tracks (public/music, rendered locally with ACE-Step) ----------

  private tracks = new Map<Track, Promise<AudioBuffer | null>>();
  private current: { name: Track; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: Track | null = 'menu';

  private load(name: Track): Promise<AudioBuffer | null> {
    let p = this.tracks.get(name);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(`./music/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? ctx.decodeAudioData(b) : null))
        .catch(() => null);
      this.tracks.set(name, p);
    }
    return p;
  }

  /**
   * Loop a track on the music bus (so the music volume setting applies),
   * crossfading from whatever was playing. Resolves false if it could not
   * load, so callers can fall back to the synth pad.
   */
  async playTrack(name: Track): Promise<boolean> {
    this.wanted = name;
    const ctx = this.ctx;
    if (!ctx) return true; // starts on unlock
    if (this.current?.name === name) return true;
    const buf = await this.load(name);
    if (!buf || this.wanted !== name) return !!buf;
    this.stopPad();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    src.connect(gain).connect(this.music);
    src.start();
    this.fadeOutCurrent();
    this.current = { name, src, gain };
    return true;
  }

  stopTrack() {
    this.wanted = null;
    this.fadeOutCurrent();
  }

  private fadeOutCurrent() {
    const c = this.current;
    const ctx = this.ctx;
    if (!c || !ctx) return;
    this.current = null;
    c.gain.gain.cancelScheduledValues(ctx.currentTime);
    c.gain.gain.setValueAtTime(c.gain.gain.value, ctx.currentTime);
    c.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
    c.src.stop(ctx.currentTime + 1.3);
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
