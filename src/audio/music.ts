/**
 * Background music: looped tracks with a crossfade between them. Tracks were
 * rendered locally with ACE-Step (licence-clean) and ship in public/music.
 */
export type Track = 'menu' | 'match' | 'boss';

const FADE = 1.2;
const VOLUME = 0.42;

class Music {
  private els = new Map<Track, HTMLAudioElement>();
  private current: Track | null = null;
  private wanted: Track | null = null;
  private enabled = true;
  private unlocked = false;
  private raf = 0;

  private el(t: Track): HTMLAudioElement {
    let a = this.els.get(t);
    if (!a) {
      a = new Audio(`./music/${t}.mp3`);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      this.els.set(t, a);
    }
    return a;
  }

  /** Browsers only allow playback after a gesture. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.wanted) this.play(this.wanted);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
    else if (this.wanted) this.play(this.wanted);
  }

  play(t: Track): void {
    this.wanted = t;
    if (!this.enabled || !this.unlocked || this.current === t) return;
    const next = this.el(t);
    next.currentTime = 0;
    void next.play().catch(() => {});
    const prev = this.current ? this.el(this.current) : null;
    this.current = t;
    this.fade(next, prev);
  }

  private fade(up: HTMLAudioElement, down: HTMLAudioElement | null): void {
    cancelAnimationFrame(this.raf);
    const t0 = performance.now();
    const v0 = down?.volume ?? 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1000 / FADE);
      up.volume = VOLUME * k;
      if (down) down.volume = v0 * (1 - k);
      if (k < 1) this.raf = requestAnimationFrame(step);
      else down?.pause();
    };
    step();
  }

  private stopAll(): void {
    cancelAnimationFrame(this.raf);
    for (const a of this.els.values()) {
      a.pause();
      a.volume = 0;
    }
    this.current = null;
  }
}

export const music = new Music();
