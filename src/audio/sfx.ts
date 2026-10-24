/**
 * Synthesised sound: no audio files. Glass-on-glass clacks are a pair of
 * detuned sine pings plus a click of filtered noise, scaled by impact speed.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private lastClack = 0;
  muted = false;

  /** Must be called from a user gesture (browsers keep audio locked until then). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    // Continuous rolling rumble: looped brown-ish noise through a low-pass.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.rollFilter = this.ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 400;
    this.rollGain = this.ctx.createGain();
    this.rollGain.gain.value = 0;
    src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    src.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  /** Marble-on-marble (glass) or marble-on-ground (thud). `speed` in cm/s. */
  clack(speed: number, ground = false): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClack < 0.012) return;
    this.lastClack = now;
    const vol = Math.min(1, speed / 250) * (ground ? 0.25 : 0.9);
    if (vol < 0.02) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(vol, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + (ground ? 0.08 : 0.25));
    out.connect(this.master);
    const base = ground ? 180 : 2600 + Math.random() * 900;
    for (const mul of ground ? [1] : [1, 1.47, 2.31]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * mul;
      const g = ctx.createGain();
      g.gain.value = 1 / mul;
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + 0.3);
    }
    // Transient click.
    const n = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, 256, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    n.buffer = nb;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = ground ? 300 : 3000;
    n.connect(hp).connect(out);
    n.start(now);
  }

  /** Total rolling speed of everything on the board, cm/s. */
  roll(totalSpeed: number): void {
    if (!this.ctx) return;
    const v = Math.min(1, totalSpeed / 400);
    this.rollGain.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.05);
    this.rollFilter.frequency.setTargetAtTime(250 + v * 600, this.ctx.currentTime, 0.05);
  }

  /** Short rising arpeggio: a marble was won. */
  chime(step = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const notes = [660, 830, 990, 1320];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * Math.pow(2, step / 12);
      const g = ctx.createGain();
      const t = now + i * 0.06;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.4);
    });
  }

  /** Soft UI tick for buttons. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.06);
  }

  /** Low "whomp" for a miss / turn change. */
  whomp(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, now);
    o.frequency.exponentialRampToValueAtTime(90, now + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.4);
  }
}

export const sfx = new Sfx();
