import { WORLD } from '../core/constants';
import { Match } from '../core/match';
import { isOutsideRing, placementPoint, SHOOTER_ID } from '../core/physics';
import { hashString, Rng } from '../core/rng';
import type { MatchEvent, PlayerInfo, Shot } from '../core/types';
import { planBotShot } from '../ai/bot';
import { BOT_PROFILES } from '../ai/profiles';
import type { NetGame } from '../net/room';
import type { PeerMsg } from '../net/protocol';
import { haptic, sound } from '../render/audio';
import type { AimView, GameView } from '../render/GameView';
import { ARENAS, arenaId, type ArenaId } from './arenas';
import { generateMap, type Difficulty, type MapDef } from './maps';
import { lookFor } from './marbles';
import { capGuide, guideLength, settings, type GuideMode } from './settings';
import { hud, showBanner } from './store';

export type SessionMode = 'demo' | 'bot' | 'local' | 'story' | 'online';

export interface SessionResult {
  winners: number[];
  scores: number[];
  localSeats: number[];
  aborted?: string;
}

export interface SessionOptions {
  mode: SessionMode;
  arena: ArenaId;
  /** The map to play. Given whole by an online host; otherwise built from `level`. */
  map?: MapDef;
  /** How hard a generated map is and which one (defaults: medium, from `seed`). */
  level?: { difficulty: Difficulty; seed?: number };
  /** The most aim guide this match allows (a Tower floor); the player's own setting otherwise. */
  guideCap?: GuideMode;
  players: PlayerInfo[];
  seed: number;
  /** Seats whose input comes from this device. */
  localSeats: number[];
  net?: NetGame;
  onEnd?: (r: SessionResult) => void;
}

interface PreparedShot {
  shot: Shot;
  from: { placeAngle: number; aimAngle: number };
  t: number;
  duration: number;
}

const TAU = Math.PI * 2;
const MAX_STEPS_PER_FRAME = 12;
/** Capture slow motion: starts at SLOWMO_RATE of full speed and eases back over this long. */
const SLOWMO_SECONDS = 0.9;
const SLOWMO_RATE = 0.25;

export class GameSession {
  readonly match: Match;
  readonly opts: SessionOptions;
  /** The generated map in play. */
  readonly map: MapDef;
  private view: GameView;
  private aim: AimView;
  private acc = 0;
  private delay = 0;
  private speed = 1;
  private prepared: PreparedShot | null = null;
  private botBusy = false;
  private incoming = new Map<number, { seat: number; shot: Shot }>();
  private hashes = new Map<number, string>();
  private pendingPeerHashes: { seat: number; n: number; hash: string }[] = [];
  private pendingSync: { n: number; snapshot: ReturnType<Match['snapshot']> } | null = null;
  private lostSeats = new Set<number>();
  private offs: (() => void)[] = [];
  private lastAimSent = 0;
  private charging = false;
  private chargeT = 0;
  /** Real seconds of slow motion left after a capture (it eases back to full speed). */
  private slowmo = 0;
  /** Mibs that have rolled over the ring line during the shot in flight. */
  private crossed = new Set<number>();
  private ended = false;
  private disposed = false;

  constructor(view: GameView, opts: SessionOptions) {
    this.view = view;
    this.opts = opts;
    // Older peers may send a retired field id; every device maps it the same way.
    opts.arena = arenaId(opts.arena);
    const surface = ARENAS[opts.arena].surface;
    this.map =
      opts.map && opts.map.arena === opts.arena
        ? opts.map
        : generateMap({ arena: opts.arena, difficulty: opts.level?.difficulty ?? 'medium', seed: opts.level?.seed ?? opts.seed });
    this.match = new Match({ players: opts.players, seed: opts.seed, surface, pieces: this.map.pieces });
    this.aim = {
      placeAngle: 0,
      aimAngle: 0,
      power: 0,
      spin: 0,
      firstShot: true,
      guideLength: guideLength(capGuide(settings.get().guide, opts.guideCap)),
      canPlace: false,
    };
  }

  get isDemo() {
    return this.opts.mode === 'demo';
  }

  start() {
    const v = this.view;
    v.loadArena(this.opts.arena);
    v.setMap(this.map.pieces);
    v.bindMatch(this.match, this.opts.players.map((p) => lookFor(p.marble)));
    v.aim = this.aim;
    if (this.isDemo) this.aim.guideLength = 0;
    v.camMode = this.isDemo ? 'attract' : 'overview';
    v.onTick = (dt) => this.tick(dt);
    this.offs.push(this.match.on((e) => this.onEvent(e)));

    const net = this.opts.net;
    if (net) {
      this.offs.push(net.onMessage((m, seat) => this.onNet(m, seat)));
      this.offs.push(
        net.onSeatLost((seat) => {
          this.lostSeats.add(seat);
          const p = this.opts.players[seat];
          showBanner(`${p.name} disconnected`, net.isHost ? 'A bot takes their seat.' : 'The host\'s bot takes their seat.', 'bad');
          this.refreshHud();
          if (net.isHost && this.match.current === seat) this.maybeAct();
        }),
      );
      this.offs.push(net.onHostLost(() => this.abort('The host left the match.')));
    }

    sound.setSurface(ARENAS[this.opts.arena].surfaceKind);
    if (!this.isDemo) {
      const mood = ({ desk: 'calm', culdesac: 'bright', grass: 'bright', sand: 'calm', ice: 'cold', gravel: 'bright', minigolf: 'bright' } as const)[this.opts.arena];
      sound.startPad(mood);
    }
    hud.set({
      active: !this.isDemo,
      winners: null,
      banner: null,
      fast: false,
      arenaName: `${this.map.name} · ${ARENAS[this.opts.arena].name}`,
      netStatus: null,
    });
    this.delay = this.isDemo ? 0.6 : 1.2;
    this.match.start();
  }

  // ---- Controllers --------------------------------------------------------------------
  private controllerFor(seat: number): 'local' | 'bot' | 'remote' {
    const p = this.opts.players[seat];
    const net = this.opts.net;
    if (this.opts.localSeats.includes(seat)) return 'local';
    if (net) {
      if (net.isHost && (p.kind === 'bot' || this.lostSeats.has(seat))) return 'bot';
      return 'remote';
    }
    return p.kind === 'bot' ? 'bot' : 'local';
  }

  get myTurn(): boolean {
    return (
      !this.isDemo &&
      this.match.phase === 'aim' &&
      this.delay <= 0 &&
      !this.prepared &&
      this.controllerFor(this.match.current) === 'local'
    );
  }

  private botProfileFor(seat: number) {
    const p = this.opts.players[seat];
    return BOT_PROFILES[p.botProfile ?? (this.lostSeats.has(seat) ? 'skilled' : 'casual')] ?? BOT_PROFILES.casual;
  }

  // ---- Events -------------------------------------------------------------------------
  private onEvent(e: MatchEvent) {
    const demo = this.isDemo;
    const name = (i: number) => this.opts.players[i]?.name ?? '';
    switch (e.type) {
      case 'turnStart':
      case 'shootAgain': {
        this.afterShotResolved();
        const p = e.player;
        const m = this.match;
        if (e.type === 'turnStart') {
          this.aim.placeAngle = m.seatAngle(p);
          this.aim.aimAngle = this.aim.placeAngle + Math.PI;
          this.delay = demo ? 0.8 : 1.1;
          if (!demo) {
            const local = this.controllerFor(p) === 'local';
            const multiLocal = this.opts.localSeats.length > 1;
            showBanner(local && !multiLocal ? 'Your turn' : `${name(p)}'s turn`, `${m.remaining} marbles in the ring`, local ? 'good' : 'neutral');
            sound.chime('turn');
          }
        } else {
          // The aim stays where the last shot went: finding the next mark is the player's job.
          this.delay = demo ? 0.5 : 0.7;
          if (!demo) showBanner('Shoot again', 'Your shooter stayed in the ring', 'gold');
        }
        this.aim.power = 0;
        this.aim.spin = 0;
        this.aim.firstShot = m.firstShotOfTurn;
        this.view.camMode = demo ? 'attract' : this.controllerFor(p) === 'local' ? (hud.get().camTop ? 'top' : 'aim') : 'aim';
        this.refreshHud();
        break;
      }
      case 'shot':
        this.view.camMode = this.isDemo ? 'attract' : 'follow';
        this.crossed.clear();
        if (!demo) {
          this.view.launchFeedback(e.shot.power);
          sound.launch(e.shot.power);
          if (settings.get().haptics) haptic(12);
        }
        this.refreshHud();
        break;
      case 'impact':
        if (!demo || e.strength > 200) sound.clack(demo ? e.strength * 0.15 : e.strength, e.kind);
        // The ground answers every collision: sand spray, frost, dust.
        if (e.strength > 30) this.view.surfaceImpact(e.pos, e.strength);
        if (!demo) this.view.hitFeedback(e.pos, e.strength, e.kind);
        if (!demo && e.strength > 400 && settings.get().haptics) haptic(8);
        break;
      case 'break':
        this.view.smash(e.piece, e.pos);
        if (!demo) {
          sound.clack(900, 'kerb');
          if (settings.get().haptics) haptic(18);
        }
        break;
      case 'capture': {
        const look = lookFor(this.opts.players[e.player].marble);
        this.view.burst(e.pos, look?.accent ?? '#ffffff');
        if (!demo) {
          sound.chime('capture');
          if (settings.get().haptics) haptic(25);
        }
        break;
      }
      case 'shooterOut':
        if (!demo && this.match.phase !== 'gameOver') {
          // banner is shown with the next turn
        }
        break;
      case 'gameOver': {
        this.afterShotResolved();
        this.view.camMode = demo ? 'attract' : 'overview';
        const w = e.winners;
        if (!demo) {
          const localWin = w.some((i) => this.opts.localSeats.includes(i));
          const single = this.opts.localSeats.length === 1;
          const title = w.length > 1 ? 'Draw' : single ? (localWin ? 'You win' : `${name(w[0])} wins`) : `${name(w[0])} wins`;
          showBanner(title, this.match.scores.join(' – '), localWin || !single ? 'gold' : 'bad');
          sound.chime(localWin || !single ? 'win' : 'lose');
        }
        this.refreshHud();
        hud.set({ winners: w });
        setTimeout(() => this.finish(), demo ? 2500 : 2200);
        break;
      }
    }
  }

  private afterShotResolved() {
    const m = this.match;
    const n = m.shotsTaken;
    if (n === 0) return;
    const h = m.hash();
    this.hashes.set(n, h);
    const net = this.opts.net;
    if (!net) return;
    if (!net.isHost) net.send({ t: 'hash', n, hash: h });
    else {
      const still: typeof this.pendingPeerHashes = [];
      for (const ph of this.pendingPeerHashes) {
        if (ph.n === n) this.checkPeerHash(ph.seat, ph.n, ph.hash);
        else if (ph.n > n) still.push(ph);
      }
      this.pendingPeerHashes = still;
    }
  }

  private checkPeerHash(seat: number, n: number, hash: string) {
    const mine = this.hashes.get(n);
    if (mine === undefined) {
      this.pendingPeerHashes.push({ seat, n, hash });
      return;
    }
    if (mine !== hash && n === this.match.shotsTaken && this.match.phase !== 'rolling') {
      this.opts.net!.sendToSeat(seat, { t: 'sync', n, snapshot: this.match.snapshot() });
    }
  }

  // ---- Networking ---------------------------------------------------------------------
  private onNet(m: PeerMsg, seat: number) {
    const net = this.opts.net!;
    switch (m.t) {
      case 'shot': {
        if (net.isHost) {
          // Validate: right seat, right moment.
          if (m.seat !== seat || m.seat !== this.match.current) return;
          if (m.n < this.match.shotsTaken) return;
          net.broadcast(m, seat);
        }
        this.incoming.set(m.n, { seat: m.seat, shot: m.shot });
        break;
      }
      case 'aim':
        if (m.seat === this.match.current && this.controllerFor(m.seat) === 'remote' && !this.prepared && this.match.phase === 'aim') {
          this.aim.placeAngle = m.aim.placeAngle;
          this.aim.aimAngle = m.aim.aimAngle;
          this.aim.power = m.aim.power;
          this.aim.spin = m.aim.spin;
        }
        break;
      case 'hash':
        if (net.isHost) this.checkPeerHash(seat, m.n, m.hash);
        break;
      case 'sync':
        if (!net.isHost) this.pendingSync = { n: m.n, snapshot: m.snapshot };
        break;
      case 'emote':
        showBanner(this.opts.players[m.seat]?.name ?? '', m.id, 'neutral');
        break;
      default:
        break;
    }
  }

  private applySync() {
    const s = this.pendingSync;
    if (!s || this.match.phase === 'rolling' || this.prepared) return;
    this.pendingSync = null;
    this.match.restore(s.snapshot);
    this.incoming.forEach((_, n) => {
      if (n < this.match.shotsTaken) this.incoming.delete(n);
    });
    this.view.bindMatch(this.match, this.opts.players.map((p) => lookFor(p.marble)));
    this.view.aim = this.aim;
    this.aim.firstShot = this.match.firstShotOfTurn;
    this.aim.placeAngle = this.match.seatAngle(this.match.current);
    this.aim.aimAngle = this.aim.placeAngle + Math.PI;
    hud.set({ netStatus: 'Resynced with host' });
    setTimeout(() => hud.set({ netStatus: null }), 2000);
    this.refreshHud();
  }

  // ---- Frame --------------------------------------------------------------------------
  private tick(dt: number) {
    if (this.disposed) return;
    const m = this.match;
    if (this.pendingSync) this.applySync();

    if (m.phase === 'rolling') {
      const behind = this.incoming.has(m.shotsTaken);
      // Slow motion only changes how quickly fixed steps are consumed, never the steps.
      let slow = 1;
      if (this.slowmo > 0 && !behind) {
        const k = 1 - this.slowmo / SLOWMO_SECONDS;
        slow = SLOWMO_RATE + (1 - SLOWMO_RATE) * k * k;
        this.slowmo -= dt;
      }
      const speed = behind ? 6 : this.speed * (hud.get().fast ? 3 : 1) * slow;
      this.view.timeScale = behind ? 1 : slow;
      this.acc += dt * speed;
      let steps = 0;
      while (this.acc >= WORLD.dt && steps < MAX_STEPS_PER_FRAME * speed && m.phase === 'rolling') {
        m.step();
        this.acc -= WORLD.dt;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME * speed) this.acc = 0;
      if (!this.isDemo && !behind) this.watchRingLine();
      this.updateRollSound();
    } else {
      this.acc = 0;
      this.slowmo = 0;
      this.view.timeScale = 1;
      sound.setRolling(0);
      if (this.delay > 0) {
        this.delay -= dt;
        if (this.delay <= 0) {
          this.refreshHud();
          this.maybeAct();
        }
      } else if (m.phase === 'aim') {
        this.maybeAct();
      }
    }

    // Animate a bot's / remote player's shot preparation, then fire.
    if (this.prepared && m.phase === 'aim') {
      const p = this.prepared;
      p.t += dt * (hud.get().fast ? 3 : 1);
      const k = Math.min(1, p.t / p.duration);
      const e = k < 0.7 ? easeInOut(k / 0.7) : 1;
      this.aim.placeAngle = lerpAngle(p.from.placeAngle, p.shot.placeAngle, e);
      this.aim.aimAngle = lerpAngle(p.from.aimAngle, p.shot.aimAngle, e);
      this.aim.power = k > 0.7 ? p.shot.power * ((k - 0.7) / 0.3) : 0;
      this.aim.spin = p.shot.spin;
      if (k >= 1) {
        this.prepared = null;
        this.fire(p.shot);
      }
    }

    // Keyboard charge.
    if (this.charging && this.myTurn) {
      this.chargeT += dt;
      const ph = (this.chargeT / 1.6) % 2;
      this.setPower(ph < 1 ? ph : 2 - ph);
    }
  }

  /**
   * The moment a mib rolls over the ring line, not when the shot is scored: a jolt, a
   * shockwave in the shooter's colour, and for the first one a beat of slow motion.
   */
  private watchRingLine() {
    const sim = this.match.sim;
    if (!sim) return;
    for (const b of sim.bodies) {
      if (b.id === SHOOTER_ID || this.crossed.has(b.id)) continue;
      const t = b.body.translation();
      if (!isOutsideRing(t.x, t.z)) continue;
      this.crossed.add(b.id);
      const look = lookFor(this.opts.players[this.match.current].marble);
      this.view.captureFeedback(t, look?.accent ?? '#ffffff');
      if (this.crossed.size === 1) this.slowmo = SLOWMO_SECONDS;
    }
  }

  private updateRollSound() {
    const sim = this.match.sim;
    if (!sim || this.isDemo) return;
    let total = 0;
    for (const b of sim.bodies) {
      const v = b.body.linvel();
      total += Math.hypot(v.x, v.z);
    }
    sound.setRolling(total);
  }

  /** Decide what the current seat's controller should do now. */
  private maybeAct() {
    const m = this.match;
    if (m.phase !== 'aim' || this.delay > 0 || this.prepared || this.ended) return;
    const seat = m.current;
    const ctl = this.isDemo ? 'bot' : this.controllerFor(seat);
    if (ctl === 'bot' && !this.botBusy) void this.runBot(seat);
    if (ctl === 'remote') {
      const next = this.incoming.get(m.shotsTaken);
      if (next) {
        this.incoming.delete(m.shotsTaken);
        this.prepare(next.shot, 0.45);
      }
    }
  }

  private async runBot(seat: number) {
    this.botBusy = true;
    hud.set({ thinking: true });
    const m = this.match;
    const profile = this.botProfileFor(seat);
    const rng = new Rng(hashString(`${this.opts.seed}:${m.shotsTaken}:${seat}`));
    const started = performance.now();
    const shot = await planBotShot(
      { layout: m.layout, firstShotOfTurn: m.firstShotOfTurn, seatAngle: m.seatAngle(seat), surface: m.config.surface, pieces: m.config.pieces },
      profile,
      rng,
    );
    if (this.disposed || m.current !== seat || m.phase !== 'aim') {
      this.botBusy = false;
      return;
    }
    const think = this.isDemo ? 300 : rng.range(profile.thinkMs[0], profile.thinkMs[1]);
    const wait = Math.max(0, think - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait / (hud.get().fast ? 3 : 1)));
    this.botBusy = false;
    hud.set({ thinking: false });
    if (this.disposed || m.current !== seat || m.phase !== 'aim') return;
    const net = this.opts.net;
    if (net?.isHost) net.broadcast({ t: 'shot', seat, n: m.shotsTaken, shot });
    this.prepare(shot, this.isDemo ? 0.9 : 1.4);
  }

  private prepare(shot: Shot, duration: number) {
    this.prepared = {
      shot,
      from: { placeAngle: this.aim.placeAngle, aimAngle: this.aim.aimAngle },
      t: 0,
      duration,
    };
    this.refreshHud();
  }

  private fire(shot: Shot) {
    this.aim.power = 0;
    this.match.shoot(shot);
  }

  // ---- Local input API (called by Controls and the HUD) ----------------------------------
  get spinValue() {
    return this.aim.spin;
  }

  get canPlace() {
    return this.myTurn && this.match.firstShotOfTurn;
  }

  rotateAim(delta: number) {
    if (!this.myTurn) return;
    this.aim.aimAngle = wrap(this.aim.aimAngle + delta);
    this.sendAim();
  }

  setPlaceAngle(a: number) {
    if (!this.canPlace) return;
    // Keep the aim's offset from "straight in" as the player slides around the ring.
    const offset = wrap(this.aim.aimAngle - (this.aim.placeAngle + Math.PI));
    this.aim.placeAngle = wrap(a);
    this.aim.aimAngle = wrap(this.aim.placeAngle + Math.PI + offset);
    this.sendAim();
  }

  nudgePlace(delta: number) {
    this.setPlaceAngle(this.aim.placeAngle + delta);
  }

  setPower(p: number) {
    if (!this.myTurn) return;
    this.aim.power = Math.max(0, Math.min(1, p));
    hud.set({ power: this.aim.power });
    this.sendAim();
  }

  setSpin(s: number) {
    if (!this.myTurn) return;
    this.aim.spin = Math.max(-1, Math.min(1, s));
    hud.set({ spin: this.aim.spin });
    this.sendAim();
  }

  /** Release the flick. */
  release() {
    if (!this.myTurn) return;
    const power = this.aim.power;
    this.charging = false;
    if (power < 0.03) {
      this.setPower(0);
      return;
    }
    const shot: Shot = { placeAngle: this.aim.placeAngle, aimAngle: this.aim.aimAngle, power, spin: this.aim.spin };
    const net = this.opts.net;
    if (net) net.send({ t: 'shot', seat: this.match.current, n: this.match.shotsTaken, shot });
    hud.set({ power: 0 });
    this.fire(shot);
  }

  startCharge() {
    if (!this.myTurn || this.charging) return;
    this.charging = true;
    this.chargeT = 0;
  }

  cancelShot() {
    this.charging = false;
    this.setPower(0);
  }

  toggleCam() {
    const top = !hud.get().camTop;
    hud.set({ camTop: top });
    if (this.match.phase === 'aim') this.view.camMode = top ? 'top' : 'aim';
  }

  toggleFast() {
    hud.set({ fast: !hud.get().fast });
  }

  sendEmote(id: string) {
    const net = this.opts.net;
    const seat = this.opts.localSeats[0];
    if (net && seat !== undefined) net.send({ t: 'emote', seat, id });
    showBanner(this.opts.players[seat]?.name ?? '', id, 'neutral');
  }

  private sendAim() {
    const net = this.opts.net;
    if (!net) return;
    const now = performance.now();
    if (now - this.lastAimSent < 90) return;
    this.lastAimSent = now;
    const { placeAngle, aimAngle, power, spin } = this.aim;
    net.send({ t: 'aim', seat: this.match.current, aim: { placeAngle, aimAngle, power, spin } });
  }

  // ---- HUD ----------------------------------------------------------------------------
  refreshHud() {
    if (this.isDemo) return;
    const m = this.match;
    this.aim.canPlace = this.canPlace;
    this.aim.guideLength = this.controllerFor(m.current) === 'local' ? guideLength(capGuide(settings.get().guide, this.opts.guideCap)) : 0;
    hud.set({
      players: this.opts.players.map((p, i) => ({
        name: p.name,
        marble: p.marble,
        score: m.scores[i],
        kind: this.lostSeats.has(i) ? 'bot' : p.kind === 'bot' ? 'bot' : this.opts.localSeats.includes(i) ? 'human' : 'remote',
        local: this.opts.localSeats.includes(i),
        connected: !this.lostSeats.has(i),
      })),
      current: m.current,
      remaining: m.remaining,
      myTurn: this.myTurn,
      firstShot: m.firstShotOfTurn,
      rolling: m.phase === 'rolling',
      power: this.aim.power,
      spin: this.aim.spin,
    });
  }

  /** Where the shooter currently sits (for HUD hints). */
  shooterPos() {
    return this.match.firstShotOfTurn ? placementPoint(this.aim.placeAngle) : this.match.layout.shooter;
  }

  private finish() {
    if (this.ended || this.disposed) return;
    this.ended = true;
    this.opts.onEnd?.({ winners: this.match.winners, scores: [...this.match.scores], localSeats: this.opts.localSeats });
  }

  abort(reason: string) {
    if (this.ended || this.disposed) return;
    this.ended = true;
    this.opts.onEnd?.({ winners: [], scores: [...this.match.scores], localSeats: this.opts.localSeats, aborted: reason });
  }

  dispose() {
    this.disposed = true;
    this.offs.forEach((f) => f());
    this.offs = [];
    this.view.onTick = null;
    this.view.unbindMatch();
    this.match.dispose();
    sound.setRolling(0);
    if (!this.isDemo) sound.stopPad();
    hud.set({ active: false, banner: null, thinking: false });
  }
}

function wrap(a: number) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

function lerpAngle(a: number, b: number, t: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
