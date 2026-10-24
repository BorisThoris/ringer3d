/**
 * Screens, HUD and the frame loop. Plain DOM: the UI is a thin layer of
 * glass over the canvas, rebuilt per screen, with per-frame updates only for
 * the few things that move (power meter, hint, popups).
 */
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { BOT_PROFILES } from '../bots/bot';
import { currentPlayer, standings } from '../core/rules';
import { DEFAULT_CONFIG } from '../core/types';
import { Match, type MatchEvents, type MatchPlayer, type Role } from '../game/match';
import { LobbyClient, customServer, lobbyUrl, normaliseServer, setCustomServer } from '../net/lobby';
import type { GameMsg, RoomInfo, SeatInfo } from '../net/protocol';
import { NetSession } from '../net/session';
import { tap } from '../platform/haptics';
import { Controls } from '../input/controls';
import { ARENAS, arenaById } from '../render/arenas';
import { Scene3D } from '../render/scene';
import type { MarbleLook } from '../render/marble';
import { LADDER, availableTaws, loadProgress, saveProgress, type Fighter } from '../story/ladder';
import { TAWS, type Quality } from '../render/marble';
import { MarblePreview } from '../render/preview';

type Mode = { kind: 'quick'; setup: QuickSetup } | { kind: 'story'; rung: number } | { kind: 'online' } | { kind: 'attract' };

interface QuickSetup {
  opponent: 'rookie' | 'regular' | 'sharp' | 'master' | 'pass2' | 'pass3' | 'pass4';
  arena: string;
  majority: boolean;
  lag: boolean;
}

const PLAYER_COLORS = ['#5ad1ff', '#ff5a7a', '#5cff9d', '#ffd23f'];
const SETTINGS_KEY = 'ringer3d.settings.v1';

/** A cheap CSS stand-in for a marble, for lists where a live 3D view would be overkill. */
function orbCss(look: MarbleLook): string {
  const [a, b = a, c = b] = look.swirl;
  if (look.pattern === 'steelie') return `background: radial-gradient(circle at 32% 28%, #fff 0 6%, ${a} 22%, ${look.base} 60%, #3a3f46 100%)`;
  if (look.pattern === 'clearie')
    return `background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.95) 0 6%, transparent 20%), radial-gradient(circle at 60% 70%, ${look.base}, ${look.base}88 60%, ${look.base}44)`;
  if (look.pattern === 'galaxy')
    return `background: radial-gradient(circle at 30% 26%, rgba(255,255,255,.9) 0 5%, transparent 18%), radial-gradient(circle at 62% 60%, ${a}88, transparent 45%), radial-gradient(circle at 40% 70%, ${b}77, transparent 40%), ${look.base}`;
  return `background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.95) 0 5%, transparent 16%), conic-gradient(from 30deg, ${look.base} 0 18%, ${a} 22% 30%, ${look.base} 34% 52%, ${b} 56% 64%, ${look.base} 68% 84%, ${c} 88% 94%, ${look.base} 98%)`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class App {
  private scene: Scene3D;
  private controls: Controls;
  private ui: HTMLElement;
  private match: Match | null = null;
  private mode: Mode = { kind: 'attract' };
  private last = performance.now();
  private hudEls: { power?: HTMLElement; powerVal?: HTMLElement; powerWrap?: HTMLElement; hint?: HTMLElement; thinking?: HTMLElement } = {};
  private quick: QuickSetup = { opponent: 'regular', arena: 'schoolyard', majority: false, lag: true };
  private playerLook = 0;
  private soundOn = true;
  private quality: Quality | null = null;
  private previews: MarblePreview[] = [];
  private sceneHidden = false;
  private lobby: LobbyClient | null = null;
  private session: NetSession | null = null;
  private playerName = 'Player';

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.scene = new Scene3D(canvas, DEFAULT_CONFIG);
    this.controls = new Controls(canvas, this.scene);
    this.controls.onAimChange = () => this.tickHud();
    this.loadSettings();
    music.setEnabled(this.soundOn);
    window.addEventListener('resize', () => this.scene.resize());
    // Audio unlocks on the first gesture anywhere.
    window.addEventListener(
      'pointerdown',
      () => {
        sfx.unlock();
        music.unlock();
      },
      { capture: true },
    );
    ui.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) sfx.tick();
    });
    this.home();
    requestAnimationFrame(this.frame);
  }

  private loadSettings(): void {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      if (typeof s.soundOn === 'boolean') this.soundOn = s.soundOn;
      if (typeof s.playerName === 'string' && s.playerName.trim()) this.playerName = s.playerName.slice(0, 20);
      if (typeof s.playerLook === 'number') this.playerLook = s.playerLook;
      if (s.quick) this.quick = { ...this.quick, ...s.quick };
      if (s.quality === 'high' || s.quality === 'low') {
        this.quality = s.quality;
        this.scene.setQuality(s.quality);
      }
    } catch {
      /* defaults */
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ soundOn: this.soundOn, playerLook: this.playerLook, quick: this.quick, quality: this.quality, playerName: this.playerName }));
    } catch {
      /* not persisted */
    }
  }

  private frame = (now: number): void => {
    // Timers (banners, bot thinking) follow real time even on a slow device;
    // the physics caps its own catch-up, so a long frame cannot explode it.
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.match?.update(dt);
    this.streamAim(now);
    if (this.mode.kind !== 'attract') this.tickHud();
    // Nothing of the 3D scene shows behind an opaque screen: save the GPU (and the battery).
    if (!this.sceneHidden) this.scene.render(dt);
    requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------ helpers

  private show(html: string): HTMLElement {
    for (const p of this.previews) p.dispose();
    this.previews = [];
    this.sceneHidden = false;
    this.ui.innerHTML = html;
    this.hudEls = {};
    return this.ui;
  }

  private taws(): MarbleLook[] {
    return availableTaws(loadProgress());
  }

  private tawAt(i: number): MarbleLook {
    const t = this.taws();
    return t[((i % t.length) + t.length) % t.length];
  }

  private myTaw(): MarbleLook {
    return this.tawAt(this.playerLook);
  }

  /** Mount a live 3D marble on every `canvas[data-marble]` in the current screen. */
  private mountPreviews(looks: MarbleLook[], accents: string[] = []): void {
    this.ui.querySelectorAll<HTMLCanvasElement>('canvas[data-marble]').forEach((c) => {
      const i = Number(c.dataset.marble);
      this.previews.push(new MarblePreview(c, looks[i], accents[i]));
    });
  }

  private tawPicker(): void {
    music.play('menu');
    const taws = this.taws();
    const locked = TAWS.length + LADDER.length - taws.length;
    let i = ((this.playerLook % taws.length) + taws.length) % taws.length;
    this.show(`
      <div class="screen">
        <button class="back" data-back>‹</button>
        <div class="panel taw-panel">
          <h2>Your taw</h2>
          <p class="sub">Drag to turn it in your fingers.</p>
          <canvas class="taw-view" data-marble="0"></canvas>
          <div class="row taw-nav">
            <button class="iconbtn static" data-prev aria-label="Previous taw">‹</button>
            <div class="taw-name"></div>
            <button class="iconbtn static" data-next aria-label="Next taw">›</button>
          </div>
          <p class="sub" style="text-align:center;margin:10px 0 0">${locked > 0 ? `${locked} more to win from the Tower` : 'Every taw unlocked'}</p>
          <div style="height:14px"></div>
          <button class="btn primary" data-pick>Use this taw</button>
        </div>
      </div>`);
    this.mountPreviews([taws[i]]);
    const name = this.ui.querySelector('.taw-name') as HTMLElement;
    const update = () => {
      name.textContent = taws[i].name ?? `Taw ${i + 1}`;
      this.previews[0].setLook(taws[i]);
    };
    update();
    this.on('[data-prev]', () => {
      i = (i + taws.length - 1) % taws.length;
      update();
    });
    this.on('[data-next]', () => {
      i = (i + 1) % taws.length;
      update();
    });
    this.on('[data-back]', () => this.home());
    this.on('[data-pick]', () => {
      this.playerLook = i;
      this.saveSettings();
      this.home();
    });
  }

  private on(sel: string, f: (el: HTMLElement) => void): void {
    this.ui.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => f(el)));
  }

  private startMatch(
    players: MatchPlayer[],
    arena: string,
    opts: { majority?: boolean; lag?: boolean; attract?: boolean; role?: Role; seed?: number; net?: Partial<MatchEvents> } = {},
  ): void {
    this.match?.dispose();
    this.scene.userYaw = 0;
    this.scene.userZoom = 1;
    sfx.setMuted(opts.attract ? true : !this.soundOn);
    if (!opts.attract) music.play(this.mode.kind === 'story' && LADDER[this.mode.rung]?.id === 'tawking' ? 'boss' : 'match');
    this.scene.setShooterLook(this.myTaw());
    const m = new Match(
      this.scene,
      { arena, players, config: { endOnMajority: !!opts.majority }, lag: opts.lag ?? true, role: opts.role, seed: opts.seed },
      opts.attract
        ? { onOver: () => setTimeout(() => this.mode.kind === 'attract' && this.attract(), 2500) }
        : {
            onChange: () => this.renderPills(),
            onBanner: (t, s, tone) => this.banner(t, s, tone),
            onKnock: (_p, x, z) => {
              this.popup('+1', x, z);
              tap('heavy');
            },
            onOver: () => this.result(),
            ...opts.net,
          },
    );
    this.match = m;
    this.controls.match = opts.attract ? null : m;
  }

  // ------------------------------------------------------------ screens

  private attract(): void {
    const arena = ARENAS[Math.floor(Math.random() * ARENAS.length)].id;
    const look = (i: number): MatchPlayer => ({
      id: `bot${i}`,
      name: ['Lefty', 'Righty'][i],
      color: PLAYER_COLORS[i],
      look: TAWS[i * 2],
      controller: { kind: 'bot', profile: BOT_PROFILES[i ? 'master' : 'sharp'] },
    });
    this.startMatch([look(0), look(1)], arena, { lag: false, attract: true });
  }

  home(): void {
    music.play('menu');
    this.mode = { kind: 'attract' };
    if (!this.match || this.controls.match) this.attract();
    const progress = loadProgress();
    this.show(`
      <div class="screen">
        <div class="logo"><h1>RINGER</h1><div class="tag">Knuckle down</div></div>
        <div class="menu">
          <button class="btn primary" data-go="story"><div>Story<small>${progress.champion ? 'Champion · replay the tower' : `Rung ${progress.rung + 1} of ${LADDER.length}: ${esc(LADDER[Math.min(progress.rung, LADDER.length - 1)].name)}`}</small></div></button>
          <button class="btn" data-go="quick"><span class="ico" style="background:#1f7bff33">⚡</span><div>Quick Match<small>Bots or pass-and-play</small></div></button>
          <button class="btn" data-go="online"><span class="ico" style="background:#8a5cff33">🌐</span><div>Online<small>Server browser, room codes, peer-to-peer</small></div></button>
          <button class="btn" data-go="how"><span class="ico" style="background:#5cff9d22">?</span><div>How to play</div></button>
          <div class="row">
            <button class="btn" data-go="taw" style="flex:1"><span class="orb" style="width:32px;height:32px;${orbCss(this.myTaw())}"></span><div>Your taw</div></button>
            <button class="btn" data-go="sound" style="flex:none;width:auto">${this.soundOn ? '🔊' : '🔇'}</button>
          </div>
        </div>
      </div>`);
    this.on('[data-go="story"]', () => this.storyTower());
    this.on('[data-go="quick"]', () => this.quickSetup());
    this.on('[data-go="online"]', () => this.online());
    this.on('[data-go="how"]', () => this.howTo());
    this.on('[data-go="taw"]', () => this.tawPicker());
    this.on('[data-go="sound"]', () => {
      this.soundOn = !this.soundOn;
      music.setEnabled(this.soundOn);
      this.saveSettings();
      this.home();
    });
  }

  private quickSetup(): void {
    music.play('menu');
    const q = this.quick;
    const opp: [QuickSetup['opponent'], string][] = [
      ['rookie', 'Rookie'],
      ['regular', 'Regular'],
      ['sharp', 'Sharp'],
      ['master', 'Master'],
    ];
    const pass: [QuickSetup['opponent'], string][] = [
      ['pass2', '2 players'],
      ['pass3', '3 players'],
      ['pass4', '4 players'],
    ];
    this.show(`
      <div class="screen">
        <button class="back" data-back>‹</button>
        <div class="panel">
          <h2>Quick Match</h2>
          <p class="sub">Pick an opponent and a field.</p>
          <div class="label">Versus bot</div>
          <div class="seg">${opp.map(([k, l]) => `<button data-opp="${k}" class="${q.opponent === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="label">Pass and play</div>
          <div class="seg">${pass.map(([k, l]) => `<button data-opp="${k}" class="${q.opponent === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="label">Field</div>
          <div class="cards">${ARENAS.map(
            (a) => `<button class="card ${q.arena === a.id ? 'on' : ''}" data-arena="${a.id}" style="background:linear-gradient(160deg, ${a.sky[1]}, ${a.sky[0]} 55%, ${a.groundTint})"><b>${esc(a.name)}</b><span>${esc(a.tagline)}</span></button>`,
          ).join('')}</div>
          <div class="label">Rules</div>
          <div class="seg">
            <button data-maj="0" class="${!q.majority ? 'on' : ''}">Clear the ring</button>
            <button data-maj="1" class="${q.majority ? 'on' : ''}">First to 7</button>
          </div>
          <div class="seg" style="margin-top:8px">
            <button data-lag="1" class="${q.lag ? 'on' : ''}">Lag for order</button>
            <button data-lag="0" class="${!q.lag ? 'on' : ''}">You go first</button>
          </div>
          <div style="height:18px"></div>
          <button class="btn primary" data-start>Play</button>
        </div>
      </div>`);
    this.on('[data-back]', () => this.home());
    this.on('[data-opp]', (el) => {
      q.opponent = el.dataset.opp as QuickSetup['opponent'];
      this.quickSetup();
    });
    this.on('[data-arena]', (el) => {
      q.arena = el.dataset.arena!;
      this.quickSetup();
    });
    this.on('[data-maj]', (el) => {
      q.majority = el.dataset.maj === '1';
      this.quickSetup();
    });
    this.on('[data-lag]', (el) => {
      q.lag = el.dataset.lag === '1';
      this.quickSetup();
    });
    this.on('[data-start]', () => {
      this.saveSettings();
      this.playQuick();
    });
  }

  private playQuick(): void {
    const q = this.quick;
    this.mode = { kind: 'quick', setup: { ...q } };
    let players: MatchPlayer[];
    if (q.opponent.startsWith('pass')) {
      const n = Number(q.opponent.slice(4));
      players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}`, color: PLAYER_COLORS[i], look: this.tawAt(this.playerLook + i), controller: { kind: 'local' } }));
    } else {
      const label = { rookie: 'Rookie Bot', regular: 'Regular Bot', sharp: 'Sharp Bot', master: 'Master Bot' }[q.opponent as 'rookie'];
      players = [
        { id: 'you', name: 'You', color: PLAYER_COLORS[0], look: this.myTaw(), controller: { kind: 'local' } },
        { id: 'bot', name: label, color: PLAYER_COLORS[1], look: this.tawAt(this.playerLook + 1), controller: { kind: 'bot', profile: BOT_PROFILES[q.opponent] } },
      ];
    }
    this.hud();
    this.startMatch(players, q.arena, { majority: q.majority, lag: q.lag });
    this.renderPills();
  }

  private storyTower(): void {
    music.play('menu');
    const prog = loadProgress();
    this.show(`
      <div class="screen">
        <button class="back" data-back>‹</button>
        <div class="logo" style="margin-bottom:16px"><h1 style="font-size:clamp(36px,9vw,64px)">THE TOWER</h1><div class="tag">Eight rings to the crown</div></div>
        <div class="tower">${LADDER.map((f, i) => {
          const cls = i < prog.rung ? 'beaten' : i === prog.rung ? 'current' : prog.champion ? '' : 'locked';
          return `<div class="rung ${cls}"><span class="orb" style="${orbCss(f.look)}"></span><div><div class="name">${esc(f.name)}</div><div class="title">${esc(f.title)} · ${esc(arenaById(f.arena).name)}</div></div><span class="spacer"></span><span class="title">${i + 1}</span></div>`;
        }).join('')}</div>
        <div class="menu" style="margin-top:16px">
          <button class="btn primary" data-fight>${prog.champion && prog.rung >= LADDER.length ? 'Climb again' : `Fight ${esc(LADDER[Math.min(prog.rung, LADDER.length - 1)].name)}`}</button>
          ${prog.rung > 0 ? '<button class="btn" data-reset style="justify-content:center;min-height:48px;font-size:15px">Restart the tower</button>' : ''}
        </div>
      </div>`);
    this.on('[data-back]', () => this.home());
    this.on('[data-reset]', () => {
      saveProgress({ ...prog, rung: 0 });
      this.storyTower();
    });
    this.on('[data-fight]', () => {
      let rung = prog.rung;
      if (rung >= LADDER.length) {
        rung = 0;
        saveProgress({ ...prog, rung: 0 });
      }
      this.versus(rung);
    });
  }

  private versus(rung: number): void {
    const f = LADDER[rung];
    const me = this.myTaw();
    this.show(`
      <div class="versus">
        <div class="side l"><canvas class="vs-marble" data-marble="0"></canvas><h3>YOU</h3><div class="quote">Rung ${rung + 1} of ${LADDER.length}</div></div>
        <div class="side r"><canvas class="vs-marble" data-marble="1"></canvas><h3>${esc(f.name.toUpperCase())}</h3><div class="title-line">${esc(f.title)}</div><div class="quote">“${esc(f.intro)}”</div></div>
        <div class="vs">VS</div>
        <div class="arena">${esc(arenaById(f.arena).name)}${f.majority ? ' · first to 7' : ''} · tap to start</div>
      </div>`);
    this.mountPreviews([me, f.look], ['#5ad1ff', '#ff5a7a']);
    this.sceneHidden = true;
    sfx.whomp();
    const go = () => this.playStory(rung, f);
    const t = setTimeout(go, 4200);
    this.ui.querySelector('.versus')!.addEventListener('click', () => {
      clearTimeout(t);
      go();
    });
  }

  private playStory(rung: number, f: Fighter): void {
    this.mode = { kind: 'story', rung };
    this.hud();
    this.startMatch(
      [
        { id: 'you', name: 'You', color: PLAYER_COLORS[0], look: this.myTaw(), controller: { kind: 'local' } },
        { id: f.id, name: f.name, color: f.look.swirl[0], look: f.look, controller: { kind: 'bot', profile: f.profile } },
      ],
      f.arena,
      { majority: f.majority, lag: true },
    );
    this.renderPills();
  }

  // ------------------------------------------------------------ online

  /** Stable index of a taw across devices (starters, then every fighter's marble). */
  private tawCatalog(): MarbleLook[] {
    return [...TAWS, ...LADDER.map((f) => f.look)];
  }

  private myTawIndex(): number {
    const mine = JSON.stringify(this.myTaw());
    return Math.max(0, this.tawCatalog().findIndex((t) => JSON.stringify(t) === mine));
  }

  private async online(): Promise<void> {
    music.play('menu');
    this.leaveSession();
    this.show(`
      <div class="screen">
        <button class="back" data-back>‹</button>
        <div class="panel online">
          <h2>Online</h2>
          <p class="sub">Open rings near and far. Matches connect peer-to-peer.</p>
          <div class="row">
            <input class="field" data-name maxlength="20" placeholder="Your name" value="${esc(this.playerName)}" aria-label="Your name" />
          </div>
          <div class="row" style="margin-top:10px">
            <input class="field code" data-code maxlength="4" placeholder="CODE" aria-label="Room code" autocapitalize="characters" />
            <button class="btn" data-join style="width:auto;flex:none;justify-content:center">Join</button>
            <span class="spacer"></span>
            <button class="btn primary" data-create style="width:auto;flex:none;padding:14px 20px">Create ring</button>
          </div>
          <div class="label row"><span>Server browser</span><span class="spacer"></span><span class="net-status" data-status>Connecting…</span></div>
          <div class="rooms" data-rooms><div class="empty">Looking for rings…</div></div>
          <details class="server-box"><summary>Server</summary>
            <div class="row" style="margin-top:8px">
              <input class="field" data-server placeholder="${esc(new URL(lobbyUrl()).host)} (default)" value="${esc(customServer())}" aria-label="Server address" />
              <button class="btn" data-server-save style="width:auto;flex:none;justify-content:center">Use</button>
            </div>
            <p class="sub" style="margin:8px 0 0;font-size:13px">LAN party: one player runs <b>npm run serve</b>, everyone enters that PC's address, e.g. 192.168.1.20:8787. Leave empty for the default.</p>
          </details>
        </div>
      </div>`);
    this.on('[data-back]', () => {
      this.leaveSession(true);
      this.home();
    });
    const nameEl = this.ui.querySelector('[data-name]') as HTMLInputElement;
    nameEl.addEventListener('change', () => {
      this.playerName = nameEl.value.trim().slice(0, 20) || 'Player';
      this.saveSettings();
      this.lobby?.connect(this.playerName).catch(() => {});
    });
    this.on('[data-server-save]', () => {
      const v = (this.ui.querySelector('[data-server]') as HTMLInputElement).value;
      try {
        if (v.trim()) normaliseServer(v);
      } catch {
        this.toast('That does not look like a server address.');
        return;
      }
      setCustomServer(v);
      this.leaveSession(true);
      void this.online();
    });
    const status = this.ui.querySelector('[data-status]') as HTMLElement;
    try {
      this.lobby ??= new LobbyClient();
      await this.lobby.connect(this.playerName);
    } catch (e) {
      status.textContent = 'Offline';
      (this.ui.querySelector('[data-rooms]') as HTMLElement).innerHTML = `<div class="empty">${esc((e as Error).message)}<br><small>Online play needs the Ringer server (npm run serve).</small><br><button class="btn" data-retry style="margin-top:12px;justify-content:center">Try again</button></div>`;
      this.on('[data-retry]', () => this.online());
      return;
    }
    const lobby = this.lobby;
    const refresh = async () => {
      if (!this.ui.querySelector('[data-rooms]')) return;
      try {
        const rooms = await lobby.list();
        this.renderRooms(rooms);
        status.textContent = `${rooms.length} open · ${lobby.rtt || '–'} ms`;
      } catch {
        status.textContent = 'Reconnecting…';
      }
    };
    void refresh();
    const timer = window.setInterval(() => (this.ui.querySelector('[data-rooms]') ? void refresh() : clearInterval(timer)), 3000);
    const join = async (code: string) => {
      try {
        this.enterRoom(await lobby.join(code));
      } catch (e) {
        this.toast((e as Error).message);
      }
    };
    this.on('[data-join]', () => void join((this.ui.querySelector('[data-code]') as HTMLInputElement).value));
    (this.ui.querySelector('[data-code]') as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void join((e.target as HTMLInputElement).value);
    });
    this.ui.querySelector('[data-rooms]')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-room]');
      if (b) void join(b.dataset.room!);
    });
    this.on('[data-create]', async () => {
      try {
        this.enterRoom(
          await lobby.create({ name: `${this.playerName}'s ring`, isPublic: true, max: 2, arena: this.quick.arena, majority: false }),
        );
      } catch (e) {
        this.toast((e as Error).message);
      }
    });
  }

  private renderRooms(rooms: RoomInfo[]): void {
    const el = this.ui.querySelector('[data-rooms]');
    if (!el) return;
    el.innerHTML = rooms.length
      ? rooms
          .map(
            (r) => `<button class="room-row" data-room="${r.code}" ${r.inGame || r.players >= r.max ? 'disabled' : ''}>
              <span class="room-dot" style="background:linear-gradient(160deg, ${arenaById(r.arena).sky[1]}, ${arenaById(r.arena).groundTint})"></span>
              <span class="room-main"><b>${esc(r.name)}</b><small>${esc(arenaById(r.arena).name)} · ${r.majority ? 'first to 7' : 'clear the ring'} · host ${esc(r.hostName)}</small></span>
              <span class="room-count">${r.inGame ? 'playing' : `${r.players}/${r.max}`}</span>
            </button>`,
          )
          .join('')
      : '<div class="empty">No open rings right now. Create one and share the code.</div>';
  }

  private enterRoom(joined: Awaited<ReturnType<LobbyClient['join']>>): void {
    const s = new NetSession(this.lobby!, joined, { name: this.playerName, taw: this.myTawIndex() });
    this.session = s;
    s.events = {
      onRoster: () => this.roomScreen(),
      onRoom: () => this.roomScreen(),
      onLinks: () => this.updateLinkBadge(),
      onStart: (msg) => this.startOnline(msg),
      onHostLeft: () => {
        if (this.session !== s) return;
        this.leaveSession();
        this.match?.dispose();
        this.match = null;
        this.home();
        this.toast('The host left. The ring is closed.');
      },
    };
    this.roomScreen();
  }

  private roomScreen(): void {
    const s = this.session;
    if (!s || s.started) return;
    const r = s.room;
    const catalog = this.tawCatalog();
    const seats = s.isHost ? s.seats : s.seats.length ? s.seats : [{ peer: s.hostId, name: r.hostName, color: '#5ad1ff', taw: 0 }];
    this.show(`
      <div class="screen">
        <button class="back" data-leave>‹</button>
        <div class="panel room">
          <div class="row"><h2 style="flex:1">${esc(r.name)}</h2><span class="net-status link-badge"></span></div>
          <p class="sub">${s.isHost ? 'Share the code. Start when everyone is in.' : 'Waiting for the host to start…'}</p>
          <div class="code-big" title="Room code">${r.code}</div>
          <div class="label">Players ${seats.length}/${r.max}</div>
          <div class="seats">${seats
            .map(
              (seat: SeatInfo, i) => `<div class="seat"><span class="orb" style="width:34px;height:34px;${orbCss(catalog[seat.taw] ?? TAWS[0])}"></span>
              <span class="seat-name" style="color:${seat.color}">${esc(seat.name)}${seat.peer === s.you ? ' (you)' : ''}${seat.peer === s.hostId ? ' · host' : ''}</span>
              ${seat.peer.startsWith('bot:') ? `<span class="badge">BOT</span>${s.isHost ? `<button class="mini" data-kick="${i}" aria-label="Remove bot">✕</button>` : ''}` : ''}</div>`,
            )
            .join('')}</div>
          ${
            s.isHost
              ? `<div class="label">Field</div>
          <div class="seg">${ARENAS.map((a) => `<button data-arena="${a.id}" class="${r.arena === a.id ? 'on' : ''}">${esc(a.name.split(' ')[0].replace(/'s$/, ''))}</button>`).join('')}</div>
          <div class="label">Rules</div>
          <div class="seg"><button data-maj="0" class="${!r.majority ? 'on' : ''}">Clear the ring</button><button data-maj="1" class="${r.majority ? 'on' : ''}">First to 7</button></div>
          <div class="seg" style="margin-top:8px">${[2, 3, 4].map((n) => `<button data-max="${n}" class="${r.max === n ? 'on' : ''}">${n} seats</button>`).join('')}
            <button data-pub="${r.isPublic ? 0 : 1}" class="${r.isPublic ? 'on' : ''}">${r.isPublic ? 'Public' : 'Private'}</button></div>
          <div class="row" style="margin-top:14px">
            <button class="btn" data-bot style="justify-content:center" ${seats.length >= r.max ? 'disabled' : ''}>+ Add a fair bot</button>
            <button class="btn primary" data-start ${seats.length < 2 ? 'disabled' : ''}>Start</button>
          </div>`
              : `<div class="label">Field</div><p>${esc(arenaById(r.arena).name)} · ${r.majority ? 'first to 7' : 'clear the ring'}</p>`
          }
        </div>
      </div>`);
    this.updateLinkBadge();
    this.on('[data-leave]', () => {
      this.leaveSession();
      void this.online();
    });
    if (!s.isHost) return;
    this.on('[data-arena]', (el) => s.setRoom({ arena: el.dataset.arena }));
    this.on('[data-maj]', (el) => s.setRoom({ majority: el.dataset.maj === '1' }));
    this.on('[data-max]', (el) => s.setRoom({ max: Number(el.dataset.max) }));
    this.on('[data-pub]', (el) => s.setRoom({ isPublic: el.dataset.pub === '1' }));
    this.on('[data-kick]', (el) => s.removeSeat(Number(el.dataset.kick)));
    this.on('[data-bot]', () => {
      const n = s.seats.filter((x) => x.peer.startsWith('bot:')).length;
      const f = LADDER[(n * 3 + 1) % LADDER.length];
      s.addBot('regular', f.name);
    });
    this.on('[data-start]', () => {
      const msg = s.start();
      if (msg) this.startOnline(msg);
    });
  }

  private startOnline(msg: Extract<GameMsg, { k: 'start' }>): void {
    const s = this.session;
    if (!s) return;
    const catalog = this.tawCatalog();
    const players: MatchPlayer[] = msg.seats.map((seat, i) => {
      const bot = seat.peer.startsWith('bot:') ? BOT_PROFILES[seat.peer.slice(4)] ?? BOT_PROFILES.regular : null;
      return {
        id: seat.peer,
        name: seat.name,
        color: seat.color,
        look: catalog[seat.taw] ?? TAWS[i % TAWS.length],
        controller: seat.peer === s.you ? { kind: 'local' } : bot && s.isHost ? { kind: 'bot', profile: bot } : { kind: 'remote' },
      };
    });
    this.mode = { kind: 'online' };
    this.hud();
    this.startMatch(players, msg.arena, {
      majority: msg.majority,
      lag: msg.lag,
      role: s.isHost ? 'host' : 'client',
      seed: msg.seed,
      net: {
        onShot: (player, seq, shot) => s.send({ k: 'shot', player, seq, shot }),
        onOutcome: (o) => s.send(o),
      },
    });
    const m = this.match!;
    s.events.onGame = (g) => {
      if (this.match !== m) return;
      if (g.k === 'shot') m.receiveShot(g.player, g.seq, g.shot);
      else if (g.k === 'outcome' && !s.isHost) m.receiveOutcome(g);
      else if (g.k === 'aim') m.showRemoteAim(g.player, g.from, g.yaw, g.power);
      else if (g.k === 'takeover') this.toast(`${m.players[g.player].name} left. A fair bot takes their seat.`);
    };
    s.events.onPeerLeft = (_peer, seatIdx) => {
      for (const i of seatIdx) {
        m.setController(i, { kind: 'bot', profile: BOT_PROFILES.regular });
        s.send({ k: 'takeover', player: i });
        this.toast(`${m.players[i].name} left. A fair bot takes their seat.`);
      }
    };
    s.events.onRoster = () => this.mode.kind !== 'online' && this.roomScreen();
    this.renderPills();
    this.updateLinkBadge();
  }

  /** Online: stream the local player's aim ~10 times a second so others watch them line up. */
  private lastAimSent = 0;
  private lastAimKey = '';
  private streamAim(now: number): void {
    const m = this.match;
    const s = this.session;
    if (!m || !s || this.mode.kind !== 'online' || !m.awaitingLocal || now - this.lastAimSent < 100) return;
    const a = m.aim;
    const key = `${a.from.x.toFixed(1)},${a.from.z.toFixed(1)},${a.yaw.toFixed(3)},${a.power.toFixed(2)}`;
    if (key === this.lastAimKey) return;
    this.lastAimKey = key;
    this.lastAimSent = now;
    s.send({ k: 'aim', player: m.activePlayer, from: a.from, yaw: a.yaw, power: a.power });
  }

  private updateLinkBadge(): void {
    const s = this.session;
    const label = !s ? '' : s.links.size === 0 ? (s.isHost ? 'Waiting for players' : 'Connecting…') : { p2p: 'Peer-to-peer', relay: 'Relayed', connecting: 'Connecting…' }[s.linkMode];
    this.ui.querySelectorAll<HTMLElement>('.link-badge').forEach((b) => {
      b.textContent = label;
      b.dataset.mode = s?.linkMode ?? '';
    });
  }

  private leaveSession(closeLobby = false): void {
    this.session?.leave();
    this.session = null;
    if (closeLobby) {
      this.lobby?.close();
      this.lobby = null;
    }
  }

  private toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  private howTo(): void {
    this.show(`
      <div class="screen">
        <button class="back" data-back>‹</button>
        <div class="panel">
          <h2>How to play Ringer</h2>
          <p class="sub">Thirteen marbles sit in a cross. Knock them out of the ring.</p>
          <div class="label">Lag</div><p>Everyone rolls toward a line. Closest goes first.</p>
          <div class="label">Knuckle down</div><p>Start each turn on the ring line. Drag your shooter to slide it around the ring.</p>
          <div class="label">Flick</div><p>Drag anywhere and pull back, like a slingshot. Longer pull, harder flick. Release to shoot; drag back to the start to cancel. Two fingers orbit and zoom.</p>
          <div class="label">Spin</div><p>Tap the white ball: low for backspin (your shooter stops after contact), high for follow.</p>
          <div class="label">Keep going</div><p>Knock one out and stay in the ring: shoot again from where you stopped. Miss, or roll out, and the turn passes. You keep what you knocked out.</p>
          <div class="label">Win</div><p>When the ring is empty, most marbles wins.</p>
          <div style="height:12px"></div>
          <button class="btn primary" data-back>Got it</button>
        </div>
      </div>`);
    this.on('[data-back]', () => this.home());
  }

  // ------------------------------------------------------------ HUD

  private hud(): void {
    this.show(`
      <div class="hud">
        <div class="scorebar"></div>
        <div class="left-count"></div>
        <button class="iconbtn pause" data-pause aria-label="Pause">❚❚</button>
        <button class="iconbtn cam" data-cam aria-label="Camera">◎</button>
        ${this.mode.kind === 'online' ? '<span class="net-status link-badge hud-link"></span><div class="syncing" style="display:none">Syncing with host</div>' : ''}
        <div class="power"><i></i><b></b></div>
        <div class="hint"></div>
        <div class="thinking" style="display:none"></div>
        <div class="dock">
          <div class="nudges">
            <button data-slide="-0.06" aria-label="Move left along the ring">⟲</button>
            <button data-slide="0.06" aria-label="Move right along the ring">⟳</button>
            <span class="sep"></span>
            <button data-nudge="-0.01" aria-label="Aim left">‹</button>
            <button data-nudge="0.01" aria-label="Aim right">›</button>
          </div>
          <span class="spacer"></span>
          <div class="spinpad" aria-label="Spin"><div class="tip" style="left:50%;top:50%"></div><div class="cap">SPIN</div></div>
        </div>
      </div>`);
    this.hudEls = {
      power: this.ui.querySelector('.power i') as HTMLElement,
      powerVal: this.ui.querySelector('.power b') as HTMLElement,
      powerWrap: this.ui.querySelector('.power') as HTMLElement,
      hint: this.ui.querySelector('.hint') as HTMLElement,
      thinking: this.ui.querySelector('.thinking') as HTMLElement,
    };
    this.on('[data-pause]', () => this.pauseMenu());
    let camMode = 0;
    this.on('[data-cam]', () => {
      const m = this.match;
      if (!m) return;
      camMode = (camMode + 1) % 3;
      this.scene.userYaw = 0;
      this.scene.userZoom = 1;
      if (camMode === 1) this.scene.frame('top');
      else if (camMode === 2) this.scene.frame('follow');
      else this.scene.frame('aim', m.aim.from, m.aim.yaw);
    });
    // Repeat-on-hold for the nudge buttons.
    this.ui.querySelectorAll<HTMLElement>('[data-nudge],[data-slide]').forEach((el) => {
      let timer = 0;
      const act = () => (el.dataset.nudge ? this.controls.nudge(Number(el.dataset.nudge)) : this.controls.slide(Number(el.dataset.slide)));
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        act();
        timer = window.setInterval(act, 90);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearInterval(timer));
    });
    const pad = this.ui.querySelector('.spinpad') as HTMLElement;
    const tip = pad.querySelector('.tip') as HTMLElement;
    const setSpin = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const d = Math.hypot(x, y);
      if (d > 0.8) {
        x = (x / d) * 0.8;
        y = (y / d) * 0.8;
      }
      // Snap to centre near the middle so "no spin" is easy to hit.
      if (Math.hypot(x, y) < 0.12) x = y = 0;
      tip.style.left = `${50 + x * 50}%`;
      tip.style.top = `${50 + y * 50}%`;
      this.match?.setSpin(-y / 0.8, x / 0.8);
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      setSpin(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pad.hasPointerCapture(e.pointerId)) setSpin(e);
    });
  }

  private renderPills(): void {
    const m = this.match;
    const bar = this.ui.querySelector('.scorebar');
    if (!m || !bar) return;
    const turn = m.state.order.length ? currentPlayer(m.state) : m.stage.kind === 'lag-wait' || m.stage.kind === 'lag-roll' ? m.stage.player : -1;
    bar.innerHTML = m.players
      .map((p, i) => {
        const lag = m.lagResults[i];
        const score = m.isLagging ? (lag === null ? '–' : `${lag.toFixed(0)}`) : String(m.state.captured[i].length);
        const dot = p.look ? orbCss(p.look) : `background: radial-gradient(circle at 32% 28%, #fff 0 6%, ${p.color} 30%, #111 100%)`;
        return `<div class="pill ${i === turn ? 'turn' : ''}" style="--pc:${p.color}"><span class="dot" style="${dot}"></span><span class="nm">${esc(p.name)}</span><span class="sc">${score}</span></div>`;
      })
      .join('');
    const left = this.ui.querySelector('.left-count');
    if (left) {
      const n = Object.keys(m.state.targets).length;
      left.textContent = m.isLagging ? 'Lagging' : `${n} left in the ring`;
    }
    const nudges = this.ui.querySelector('.nudges') as HTMLElement | null;
    if (nudges) nudges.style.visibility = m.awaitingLocal && !m.isLagging ? 'visible' : 'hidden';
    const pad = this.ui.querySelector('.spinpad') as HTMLElement | null;
    if (pad) pad.style.visibility = m.awaitingLocal && !m.isLagging ? 'visible' : 'hidden';
    this.ui.querySelectorAll<HTMLElement>('[data-slide]').forEach((b) => (b.style.display = m.canPlace ? '' : 'none'));
  }

  private tickHud(): void {
    const m = this.match;
    const h = this.hudEls;
    if (!m || !h.power) return;
    const p = m.aim.power;
    h.power.style.height = `${p * 100}%`;
    h.powerVal!.textContent = p > 0 ? `${Math.round(p * 100)}` : '';
    h.powerWrap!.style.opacity = m.stage.kind === 'aim' || m.stage.kind === 'lag-wait' ? '1' : '0.25';
    const local = m.awaitingLocal;
    const bot = (m.stage.kind === 'aim' || m.stage.kind === 'lag-wait') && m.controllerOf(m.stage.player).kind === 'bot';
    let hint = '';
    if (local) {
      const who = m.players.filter((pl) => pl.controller.kind === 'local').length > 1 ? `${m.players[(m.stage as { player: number }).player].name}: ` : '';
      if (m.isLagging) hint = `${who}pull back to set power, release to lag`;
      else if (p > 0) hint = 'Release to flick · drag back to cancel';
      else if (m.canPlace) hint = `${who}drag your shooter along the line, then pull back to aim`;
      else hint = `${who}pull back to aim from where you stopped`;
    }
    if (h.hint!.textContent !== hint) h.hint!.textContent = hint;
    h.hint!.style.opacity = hint ? '1' : '0';
    // Online, remote humans "line up" too; bots and remote players both show the waiting chip.
    const waiting = bot || ((m.stage.kind === 'aim' || m.stage.kind === 'lag-wait') && m.controllerOf(m.stage.player).kind === 'remote');
    h.thinking!.style.display = waiting ? '' : 'none';
    if (waiting) h.thinking!.textContent = `${m.players[(m.stage as { player: number }).player].name} is lining up`;
    const sync = this.ui.querySelector('.syncing') as HTMLElement | null;
    if (sync) sync.style.display = m.syncing ? '' : 'none';
  }

  private banner(text: string, sub: string, tone: 'good' | 'bad' | 'neutral'): void {
    this.ui.querySelector('.banner')?.remove();
    const hud = this.ui.querySelector('.hud');
    if (!hud) return;
    const el = document.createElement('div');
    el.className = `banner ${tone}`;
    el.innerHTML = `<h2>${esc(text)}</h2><p>${esc(sub)}</p>`;
    hud.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  private popup(text: string, x: number, z: number): void {
    const s = this.scene.toScreen(x, 4, z);
    const hud = this.ui.querySelector('.hud');
    if (!hud || !s.visible) return;
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    hud.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  private pauseMenu(): void {
    const m = this.match;
    if (!m) return;
    m.paused = true;
    const overlay = document.createElement('div');
    overlay.className = 'screen';
    overlay.innerHTML = `
      <div class="menu">
        <h2 style="text-align:center;margin:0 0 8px;font-size:32px">Paused</h2>
        <button class="btn primary" data-resume>Resume</button>
        ${this.mode.kind === 'online' ? '<p class="sub" style="text-align:center;margin:0">Online matches keep playing while you are here.</p>' : '<button class="btn" data-restart style="justify-content:center">Restart match</button>'}
        <button class="btn" data-sound style="justify-content:center">${this.soundOn ? 'Sound on' : 'Sound off'}</button>
        <button class="btn" data-gfx style="justify-content:center">${this.gfxLabel()}</button>
        <button class="btn" data-quit style="justify-content:center">Quit to menu</button>
      </div>`;
    this.ui.appendChild(overlay);
    const close = () => {
      overlay.remove();
      m.paused = false;
    };
    overlay.querySelector('[data-resume]')!.addEventListener('click', close);
    overlay.querySelector('[data-gfx]')!.addEventListener('click', (e) => {
      this.quality = this.scene.getQuality() === 'high' ? 'low' : 'high';
      this.scene.setQuality(this.quality);
      this.saveSettings();
      (e.currentTarget as HTMLElement).textContent = this.gfxLabel();
    });
    overlay.querySelector('[data-sound]')!.addEventListener('click', (e) => {
      this.soundOn = !this.soundOn;
      music.setEnabled(this.soundOn);
      sfx.setMuted(!this.soundOn);
      this.saveSettings();
      (e.currentTarget as HTMLElement).textContent = this.soundOn ? 'Sound on' : 'Sound off';
    });
    overlay.querySelector('[data-restart]')?.addEventListener('click', () => this.replay());
    overlay.querySelector('[data-quit]')!.addEventListener('click', () => {
      this.leaveSession(true);
      this.match?.dispose();
      this.match = null;
      this.home();
    });
  }

  private gfxLabel(): string {
    return this.scene.getQuality() === 'high' ? 'Graphics: Ultra glass' : 'Graphics: Battery saver';
  }

  private replay(): void {
    const mode = this.mode;
    if (mode.kind === 'quick') {
      this.quick = { ...mode.setup };
      this.playQuick();
    } else if (mode.kind === 'story') {
      this.playStory(mode.rung, LADDER[mode.rung]);
    }
  }

  private result(): void {
    const m = this.match;
    if (!m) return;
    const st = standings(m.state);
    const winners = m.state.event.kind === 'game-over' ? m.state.event.winners : [];
    const youWon = winners.length === 1 && m.players[winners[0]].controller.kind === 'local' && m.players.filter((p) => p.controller.kind === 'local').length === 1;
    const draw = winners.length > 1;
    const mode = this.mode;
    let title = draw ? 'Draw' : `${m.players[winners[0]]?.name ?? ''} wins`;
    let quote = '';
    let actions = '';
    if (mode.kind === 'story') {
      const f = LADDER[mode.rung];
      const prog = loadProgress();
      if (youWon) {
        title = 'Victory';
        quote = `${f.name}: “${f.defeat}”`;
        const next = mode.rung + 1;
        saveProgress({ rung: next, best: Math.max(prog.best, next), champion: prog.champion || next >= LADDER.length });
        if (next >= LADDER.length) {
          title = 'Champion';
          quote = 'The crown rolls to you. Every ring, everywhere, is yours.';
          actions = '<button class="btn primary" data-tower>Back to the Tower</button>';
        } else {
          actions = `<button class="btn primary" data-next>Next: ${esc(LADDER[next].name)}</button><button class="btn" data-tower style="justify-content:center">Tower</button>`;
        }
      } else {
        title = draw ? 'Draw' : 'Defeat';
        quote = `${f.name}: “${f.victory}”`;
        actions = '<button class="btn primary" data-replay>Try again</button><button class="btn" data-tower style="justify-content:center">Tower</button>';
      }
    } else if (mode.kind === 'online') {
      if (youWon) title = 'You win';
      actions = '<button class="btn primary" data-room>Back to the ring</button>';
    } else {
      if (youWon) title = 'You win';
      actions = '<button class="btn primary" data-replay>Rematch</button><button class="btn" data-setup style="justify-content:center">Change setup</button>';
    }
    const overlay = document.createElement('div');
    overlay.className = 'screen result';
    overlay.innerHTML = `
      <div class="panel">
        <p class="big">${esc(title)}</p>
        ${quote ? `<p class="quote">${esc(quote)}</p>` : ''}
        <div class="scores">${st.map((s) => `<div class="row"><span class="orb" style="width:28px;height:28px;background:radial-gradient(circle at 32% 28%, #fff 0 6%, ${m.players[s.player].color} 30%, #111 100%)"></span><span>${esc(m.players[s.player].name)}</span><b>${s.score}</b></div>`).join('')}</div>
        <div class="menu" style="width:100%">${actions}<button class="btn" data-home style="justify-content:center">Main menu</button></div>
      </div>`;
    this.ui.querySelector('.hud')?.remove();
    this.ui.appendChild(overlay);
    const click = (sel: string, f: () => void) => overlay.querySelector(sel)?.addEventListener('click', f);
    click('[data-replay]', () => this.replay());
    click('[data-next]', () => mode.kind === 'story' && this.versus(mode.rung + 1));
    click('[data-tower]', () => {
      this.match?.dispose();
      this.match = null;
      this.mode = { kind: 'attract' };
      this.attract();
      this.storyTower();
    });
    click('[data-setup]', () => {
      this.match?.dispose();
      this.match = null;
      this.mode = { kind: 'attract' };
      this.attract();
      this.quickSetup();
    });
    click('[data-room]', () => {
      const s = this.session;
      this.match?.dispose();
      this.match = null;
      this.mode = { kind: 'attract' };
      this.attract();
      if (!s) return void this.online();
      // The host reopens the room; guests wait for its fresh roster.
      s.started = false;
      if (s.isHost) s.reopen();
      this.roomScreen();
    });
    click('[data-home]', () => {
      this.leaveSession(true);
      this.match?.dispose();
      this.match = null;
      this.home();
    });
  }
}
