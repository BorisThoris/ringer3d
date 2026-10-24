import { initPhysics } from '../core/physics';
import type { PlayerInfo } from '../core/types';
import { ARENA_LIST, type ArenaId } from '../game/arenas';
import { FIGHTERS } from '../game/story';
import { GameSession, type SessionOptions } from '../game/session';
import { settings } from '../game/settings';
import { sound } from '../render/audio';
import { Controls } from '../render/controls';
import { GameView } from '../render/GameView';

/** Owns the single 3D canvas for the app's lifetime and swaps game sessions in and out. */
class Engine {
  view: GameView | null = null;
  controls: Controls | null = null;
  session: GameSession | null = null;
  private demoArena = 0;

  async init(container: HTMLElement) {
    await initPhysics();
    if (this.view) return; // React StrictMode runs effects twice in development
    this.view = new GameView(container, settings.get().quality);
    this.controls = new Controls(this.view, () => this.session);
    settings.subscribe(() => {
      const s = settings.get();
      this.view?.setQuality(s.quality);
      sound.setVolumes(s.sfx, s.music);
    });
    sound.setVolumes(settings.get().sfx, settings.get().music);
  }

  /** Bots play each other behind the menus: the live backdrop. */
  startDemo(arena?: ArenaId) {
    if (!this.view) return;
    const id = arena ?? ARENA_LIST[this.demoArena % ARENA_LIST.length].id;
    const pool = FIGHTERS.filter((f) => f.id !== 'obsidian');
    const a = pool[(this.demoArena * 3) % pool.length];
    const b = pool[(this.demoArena * 3 + 4) % pool.length];
    const players: PlayerInfo[] = [
      { id: 'd1', name: a.name, marble: a.marble, kind: 'bot', botProfile: 'skilled' },
      { id: 'd2', name: b.name, marble: b.marble, kind: 'bot', botProfile: 'skilled' },
    ];
    this.run({
      mode: 'demo',
      arena: id,
      players,
      seed: (Math.random() * 1e9) | 0,
      localSeats: [],
      onEnd: () => {
        this.demoArena++;
        if (this.session?.isDemo) this.startDemo();
      },
    });
  }

  run(opts: SessionOptions): GameSession | null {
    if (!this.view) return null;
    this.session?.dispose();
    const s = new GameSession(this.view, opts);
    this.session = s;
    s.start();
    return s;
  }

  stop() {
    this.session?.dispose();
    this.session = null;
  }
}

export const engine = new Engine();

// Handy for debugging and automated screenshots.
(globalThis as unknown as { __ringer: Engine }).__ringer = engine;
