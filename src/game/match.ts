/**
 * One match: owns the rules state and the physics, drives bots, and tells
 * the UI what happened. Input arrives as ShotInputs regardless of who made
 * them (local thumb, bot, or a remote peer).
 *
 * Online, every peer runs a Match. Shots are broadcast as inputs and every
 * peer simulates them for the visuals, but only the host's settled outcome
 * counts: clients wait for it, snap to it and resolve the rules with it. So
 * physics drift between devices can never split the game state.
 */
import { sfx } from '../audio/sfx';
import { BOT_PROFILES, chooseLagPower, chooseShot, seededRng, type BotProfile, type Rng } from '../bots/bot';
import { beginShot, createMatch, currentPlayer, isInRing, recordLag, resolveShot, snapToEdge, standings, type RingerState, type TurnEvent } from '../core/rules';
import { DEFAULT_CONFIG, type PlayerInfo, type RingerConfig, type ShotInput, type ShotOutcome, type Vec2 } from '../core/types';
import type { GameMsg } from '../net/protocol';
import { arenaById, type ArenaDef } from '../render/arenas';
import type { MarbleLook } from '../render/marble';
import type { CameraMode } from '../render/scene';
import { MarbleSim, SHOOTER_ID, SURFACES, type BodyPose, type Surface } from '../sim/physics';

export type Controller = { kind: 'local' } | { kind: 'bot'; profile: BotProfile } | { kind: 'remote' };

export interface MatchPlayer extends PlayerInfo {
  controller: Controller;
  color: string;
  /** Their shooter's look; the scene default if absent. */
  look?: MarbleLook;
}

/** What a match needs from the renderer. Scene3D implements it; tests pass a no-op. */
export interface MatchView {
  loadArena(arena: ArenaDef): void;
  syncBodies(poses: BodyPose[]): void;
  setShooterLook(look: MarbleLook): void;
  showLagLine(x: number | null, z?: number): void;
  showAim(from: Vec2 | null, yaw?: number, power?: number, targets?: Record<string, Vec2>, guideLength?: number): void;
  frame(mode: CameraMode, subject?: Vec2, yaw?: number): void;
  setAimYaw(subject: Vec2, yaw: number): void;
  burst(x: number, z: number, color?: string): void;
  addShake(amount: number): void;
}

export type Role = 'solo' | 'host' | 'client';

export interface MatchOptions {
  arena: string;
  players: MatchPlayer[];
  config?: Partial<RingerConfig>;
  /** Decide order by lagging (default) or play in seat order. */
  lag?: boolean;
  seed?: number;
  role?: Role;
}

export type Stage =
  | { kind: 'lag-wait'; player: number }
  | { kind: 'lag-roll'; player: number }
  | { kind: 'aim'; player: number }
  | { kind: 'roll'; player: number }
  | { kind: 'banner' }
  | { kind: 'over' };

type OutcomeMsg = Extract<GameMsg, { k: 'outcome' }>;

export interface MatchEvents {
  /** Something the HUD should show: state changed. */
  onChange?: (m: Match) => void;
  /** A headline moment: "SHOOT AGAIN", "MISS", "+1". */
  onBanner?: (text: string, sub: string, tone: 'good' | 'bad' | 'neutral') => void;
  /** A marble crossed the ring line during play; x/z for a popup. */
  onKnock?: (player: number, x: number, z: number) => void;
  /** A shot by a player on this device (human or bot). The net layer forwards it. */
  onShot?: (player: number, seq: number, shot: ShotInput) => void;
  /** Host only: a settled result to broadcast. */
  onOutcome?: (msg: OutcomeMsg) => void;
  onOver?: (m: Match) => void;
}

const LAG_START: Vec2 = { x: -90, z: 96 };
const LAG_LINE_X = 90;
/** A client waits this long past its own settle for the host before showing "syncing". */
export const OUTCOME_GRACE = 0.6;

export class Match {
  state: RingerState;
  readonly sim: MarbleSim;
  readonly arena: ArenaDef;
  readonly surface: Surface;
  readonly players: MatchPlayer[];
  readonly role: Role;
  stage: Stage;
  /** Current aim for the HUD and guide; local players edit it. */
  aim = { yaw: Math.PI, power: 0, spin: 0, english: 0, from: { x: 60, z: 0 } as Vec2 };
  /** Lag result per player, cm from the line (for the HUD). */
  lagResults: (number | null)[];
  history: { player: number; shot: ShotInput }[] = [];
  /** Client only: true while the local sim has settled and the host's result is pending. */
  syncing = false;
  paused = false;
  private rng: Rng;
  private bannerTimer = 0;
  private afterBanner: (() => void) | null = null;
  private botTimer = 0;
  private botPlan: ShotInput | null = null;
  private botStartFrom: Vec2 | null = null;
  private crossed = new Set<string>();
  private edgeAngle = 0;
  /** Lag shots taken so far (lag shots use negative sequence numbers). */
  private lagShots = 0;
  /** The sequence number of the shot in flight. */
  private rollingSeq = 0;
  private pendingShots: { player: number; seq: number; shot: ShotInput }[] = [];
  private pendingOutcomes = new Map<number, { msg: OutcomeMsg; at: number }>();
  private settledFor = 0;
  /** Seconds of match time, from update(). */
  private clock = 0;

  constructor(readonly scene: MatchView, opts: MatchOptions, readonly events: MatchEvents = {}) {
    const config = { ...DEFAULT_CONFIG, ...opts.config };
    this.players = opts.players;
    this.role = opts.role ?? 'solo';
    this.arena = arenaById(opts.arena);
    this.surface = SURFACES[this.arena.surface];
    this.rng = seededRng(opts.seed ?? Date.now());
    this.sim = new MarbleSim(config, this.surface);
    const lag = opts.lag ?? true;
    this.state = createMatch(opts.players, config, lag ? {} : { order: opts.players.map((_, i) => i) });
    this.lagResults = opts.players.map(() => null);
    this.sim.setup(this.state.targets, null);
    scene.loadArena(this.arena);
    scene.syncBodies(this.sim.poses());
    this.stage = { kind: 'banner' };
    if (lag) this.startLag(0);
    else this.startTurn();
  }

  get config(): RingerConfig {
    return this.state.config;
  }

  controllerOf(player: number): Controller {
    return this.players[player].controller;
  }

  /** Hand a seat to someone else (a bot taking over a player who left). */
  setController(player: number, c: Controller): void {
    this.players[player].controller = c;
    const s = this.stage;
    if ((s.kind === 'aim' || s.kind === 'lag-wait') && s.player === player && c.kind === 'bot') {
      if (s.kind === 'aim') this.planBot(player);
      else this.startLag(player);
    }
    this.emit();
  }

  /** Is a human on this device expected to act right now? */
  get awaitingLocal(): boolean {
    const s = this.stage;
    return (s.kind === 'aim' || s.kind === 'lag-wait') && this.controllerOf(s.player).kind === 'local';
  }

  get isLagging(): boolean {
    return this.stage.kind === 'lag-wait' || this.stage.kind === 'lag-roll';
  }

  /** May the shooter slide along the ring line (start of a turn)? */
  get canPlace(): boolean {
    return this.stage.kind === 'aim' && this.state.shooterStart.kind === 'edge';
  }

  /** The player whose move it is (lagging or shooting), or -1. */
  get activePlayer(): number {
    const s = this.stage;
    return 'player' in s ? s.player : -1;
  }

  // ---------------------------------------------------------------- lagging

  private useLook(player: number): void {
    const look = this.players[player].look;
    if (look) this.scene.setShooterLook(look);
  }

  private startLag(player: number): void {
    this.stage = { kind: 'lag-wait', player };
    this.useLook(player);
    this.aim = { ...this.aim, from: { ...LAG_START }, yaw: 0, power: 0, spin: 0, english: 0 };
    this.sim.placeShooter(LAG_START);
    this.scene.showLagLine(LAG_LINE_X, LAG_START.z);
    this.scene.frame('lag', { x: 0, z: LAG_START.z });
    this.events.onBanner?.('LAG FOR ORDER', `${this.players[player].name}: roll closest to the line`, 'neutral');
    const c = this.controllerOf(player);
    this.botPlan = null;
    if (c.kind === 'bot') {
      this.botTimer = 1.1;
      this.botPlan = {
        from: LAG_START,
        yaw: 0,
        power: chooseLagPower(LAG_LINE_X - LAG_START.x, this.surface, c.profile, this.rng),
        spin: 0,
        english: 0,
      };
    }
    this.emit();
  }

  private finishLag(player: number, authoritative?: Extract<OutcomeMsg, { kind: 'lag' }>): void {
    let dist: number;
    if (authoritative) {
      dist = authoritative.distance;
      if (authoritative.rest) this.sim.applyRest({ [SHOOTER_ID]: authoritative.rest });
    } else {
      const p = this.sim.pos(SHOOTER_ID);
      const d = p ? Math.abs(p.x - LAG_LINE_X) + Math.abs(p.z - LAG_START.z) * 0.25 : 999;
      dist = Math.round(d * 10) / 10;
      if (this.role === 'host') this.events.onOutcome?.({ k: 'outcome', seq: this.rollingSeq, kind: 'lag', player, distance: dist, rest: p });
    }
    this.lagResults[player] = dist;
    const before = this.state.event;
    this.state = recordLag(this.state, player, dist);
    // Only a tie produced by *this* lag counts; the old event lingers until everyone re-lags.
    const tie = this.state.event !== before && this.state.event.kind === 'lag-tie' ? this.state.event : null;
    this.banner(dist >= 999 ? 'OFF THE PITCH' : `${dist.toFixed(1)} cm`, `${this.players[player].name} from the line`, 'neutral', 1.3, () => {
      this.sim.removeShooter();
      const ev = tie;
      if (ev) {
        for (const i of ev.players) this.lagResults[i] = null;
        this.banner('TIE!', 'Lag again', 'neutral', 1.2, () => this.startLag(ev.players[0]));
        return;
      }
      if (this.state.phase === 'lag') {
        const next = this.state.lag.findIndex((l) => l === null);
        this.startLag(next);
        return;
      }
      this.scene.showLagLine(null);
      const first = this.players[currentPlayer(this.state)].name;
      this.banner(`${first.toUpperCase()} BREAKS`, 'Closest to the line goes first', 'good', 1.6, () => this.startTurn());
    });
  }

  // ---------------------------------------------------------------- turns

  private startTurn(): void {
    const player = currentPlayer(this.state);
    this.stage = { kind: 'aim', player };
    this.useLook(player);
    this.crossed.clear();
    const start = this.state.shooterStart;
    const from = start.kind === 'spot' ? start.pos : snapToEdge(this.config, { x: Math.cos(this.edgeAngle), z: Math.sin(this.edgeAngle) });
    const yaw = Math.atan2(-from.z, -from.x);
    this.aim = { ...this.aim, from, yaw, power: 0 };
    this.sim.placeShooter(from);
    this.scene.frame('aim', from, yaw);
    this.botPlan = null;
    if (this.controllerOf(player).kind === 'bot') this.planBot(player);
    this.emit();
  }

  private planBot(player: number): void {
    const c = this.controllerOf(player);
    if (c.kind !== 'bot') return;
    const plan = chooseShot(this.state, this.surface, c.profile, this.rng);
    this.botPlan = plan.shot;
    this.botStartFrom = this.aim.from;
    this.botTimer = 1.5 + this.rng() * 0.8;
  }

  /** Slide the shooter along the ring line (start-of-turn placement). */
  placeOnEdge(p: Vec2): void {
    if (!this.canPlace) return;
    const from = snapToEdge(this.config, p);
    this.edgeAngle = Math.atan2(from.z, from.x);
    this.aim.from = from;
    this.sim.placeShooter(from);
    this.emit();
  }

  setAim(yaw: number, power: number): void {
    this.aim.yaw = yaw;
    this.aim.power = Math.max(0, Math.min(1, power));
  }

  setSpin(spin: number, english: number): void {
    this.aim.spin = Math.max(-1, Math.min(1, spin));
    this.aim.english = Math.max(-1, Math.min(1, english));
    this.emit();
  }

  /** A remote player's live aim, so everyone watches them line up. */
  showRemoteAim(player: number, from: Vec2, yaw: number, power: number): void {
    const s = this.stage;
    if (!(s.kind === 'aim' || s.kind === 'lag-wait') || s.player !== player || this.controllerOf(player).kind !== 'remote') return;
    if (s.kind === 'aim' && this.canPlace) {
      const snapped = snapToEdge(this.config, from);
      this.aim.from = snapped;
      this.sim.placeShooter(snapped);
    }
    this.aim.yaw = yaw;
    this.aim.power = power;
  }

  /** A local player released the flick. */
  fireLocal(): void {
    if (!this.awaitingLocal || this.aim.power < 0.02) return;
    const shot: ShotInput = { from: this.aim.from, yaw: this.aim.yaw, power: this.aim.power, spin: this.aim.spin, english: this.aim.english };
    this.takeShot(shot);
  }

  /** The sequence number the next shot will carry. */
  get nextSeq(): number {
    return this.isLagging ? -(this.lagShots + 1) : this.state.shots;
  }

  /** A shot from another device. Queued until this match is ready for it. */
  receiveShot(player: number, seq: number, shot: ShotInput): void {
    if (this.controllerOf(player).kind !== 'remote') return;
    this.pendingShots.push({ player, seq, shot });
    this.drainShots();
  }

  /** Client: the host's final word on a shot or lag. */
  receiveOutcome(msg: OutcomeMsg): void {
    this.pendingOutcomes.set(msg.seq, { msg, at: this.clock });
  }

  private drainShots(): void {
    const s = this.stage;
    if (!(s.kind === 'aim' || s.kind === 'lag-wait')) return;
    const i = this.pendingShots.findIndex((p) => p.player === s.player && p.seq === this.nextSeq);
    if (i < 0) return;
    const [p] = this.pendingShots.splice(i, 1);
    this.takeShot(p.shot, true);
  }

  /** Any shot from the current player. `remote` = it came over the network. */
  takeShot(shot: ShotInput, remote = false): void {
    const s = this.stage;
    const seq = this.nextSeq;
    if (s.kind === 'lag-wait') {
      if (!remote) this.events.onShot?.(s.player, seq, shot);
      this.rollingSeq = seq;
      this.lagShots++;
      this.stage = { kind: 'lag-roll', player: s.player };
      this.sim.shoot({ ...shot, from: LAG_START, yaw: 0 });
      this.settledFor = 0;
      this.emit();
      return;
    }
    if (s.kind !== 'aim') return;
    this.state = beginShot(this.state, shot);
    this.history.push({ player: s.player, shot });
    if (!remote) this.events.onShot?.(s.player, seq, shot);
    this.rollingSeq = seq;
    this.sim.shoot(shot);
    this.settledFor = 0;
    this.stage = { kind: 'roll', player: s.player };
    this.aim.power = 0;
    this.scene.frame('follow', shot.from);
    this.scene.addShake(0.4 + shot.power);
    sfx.clack(80 + shot.power * 200, true);
    this.emit();
  }

  private finishShot(authoritative?: ShotOutcome): void {
    const before = Object.keys(this.state.targets);
    let outcome: ShotOutcome;
    if (authoritative) {
      outcome = authoritative;
      const rest: Record<string, Vec2> = {};
      const gone: string[] = [];
      for (const id of before) {
        const p = outcome.targets[id];
        if (p) rest[id] = p;
        else if (id in outcome.targets) gone.push(id);
      }
      if (outcome.shooterPos) rest[SHOOTER_ID] = outcome.shooterPos;
      else this.sim.removeShooter();
      this.sim.removeMarbles(gone);
      this.sim.applyRest(rest);
    } else {
      outcome = this.sim.outcome(before);
      if (this.role === 'host') this.events.onOutcome?.({ k: 'outcome', seq: this.rollingSeq, kind: 'shot', outcome });
    }
    this.state = resolveShot(this.state, outcome);
    const knocked = before.filter((id) => !(id in this.state.targets));
    // Knocked-out marbles are picked up.
    this.sim.removeMarbles(knocked);
    this.describe(this.state.event);
  }

  private describe(ev: TurnEvent): void {
    const shooterPos = this.sim.pos(SHOOTER_ID);
    if (shooterPos) this.edgeAngle = Math.atan2(shooterPos.z, shooterPos.x);
    if (ev.kind === 'game-over') {
      this.stage = { kind: 'over' };
      const w = ev.winners.map((i) => this.players[i].name).join(' & ');
      this.banner(ev.winners.length > 1 ? 'DRAW' : `${w.toUpperCase()} WINS`, standings(this.state).map((s) => `${this.players[s.player].name} ${s.score}`).join('  ·  '), 'good', 2.2, () => {
        this.emit();
        this.events.onOver?.(this);
      });
      this.scene.frame('showcase');
      return;
    }
    if (ev.kind === 'shoot-again') {
      const n = ev.knocked.length;
      sfx.chime(n);
      this.banner(n > 1 ? `${n} OUT!` : 'KNOCKED OUT!', 'Shoot again from where you stopped', 'good', 1.3, () => this.startTurn());
      return;
    }
    if (ev.kind === 'turn-over') {
      this.sim.removeShooter();
      const n = ev.knocked.length;
      const next = this.players[ev.next].name;
      if (n > 0) {
        sfx.chime(n);
        this.banner(`+${n} · SHOOTER OUT`, `${next}'s turn`, 'neutral', 1.6, () => this.startTurn());
      } else {
        sfx.whomp();
        this.banner(ev.reason === 'miss' ? 'MISS' : 'SHOOTER OUT', `${next}'s turn`, 'bad', 1.4, () => this.startTurn());
      }
      return;
    }
    this.startTurn();
  }

  private banner(text: string, sub: string, tone: 'good' | 'bad' | 'neutral', seconds: number, then: () => void): void {
    this.stage = this.stage.kind === 'over' ? this.stage : { kind: 'banner' };
    this.bannerTimer = seconds;
    this.afterBanner = then;
    this.events.onBanner?.(text, sub, tone);
    this.emit();
  }

  // ---------------------------------------------------------------- loop

  update(dt: number): void {
    // Online matches cannot pause: the others are still playing.
    if (this.paused && this.role === 'solo') return;
    this.clock += dt;
    const s = this.stage;
    if (this.afterBanner) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        const f = this.afterBanner;
        this.afterBanner = null;
        f();
      }
    }

    this.drainShots();

    if ((s.kind === 'aim' || s.kind === 'lag-wait') && this.controllerOf(s.player).kind === 'bot' && this.botPlan) {
      this.animateBot(dt, s.kind === 'lag-wait');
    }

    if (s.kind === 'roll' || s.kind === 'lag-roll') {
      const hits = this.sim.advance(dt);
      for (const h of hits) {
        sfx.clack(h.speed, h.b === 'ground');
        if (h.b !== 'ground' && h.speed > 120) this.scene.addShake(h.speed / 600);
      }
      if (s.kind === 'roll') this.watchCrossings(s.player);
      sfx.roll(this.sim.settled() ? 0 : this.sim.totalSpeed());
      const sp = this.sim.pos(SHOOTER_ID);
      if (s.kind === 'lag-roll' && sp) this.scene.frame('lag', { x: Math.max(LAG_START.x + 40, Math.min(LAG_LINE_X, sp.x)), z: LAG_START.z });
      this.settleIfReady(s.kind, s.player, dt);
    }

    this.scene.syncBodies(this.sim.poses());
    const showAim = this.stage.kind === 'aim' || this.stage.kind === 'lag-wait';
    this.scene.showAim(
      showAim ? this.aim.from : null,
      this.aim.yaw,
      this.aim.power,
      this.stage.kind === 'lag-wait' ? {} : this.state.targets,
      this.stage.kind === 'lag-wait' ? 0.6 : 1,
    );
  }

  private settleIfReady(kind: 'roll' | 'lag-roll', player: number, dt: number): void {
    const settled = this.sim.settled();
    if (this.role !== 'client') {
      if (!settled) return;
      sfx.roll(0);
      if (kind === 'lag-roll') this.finishLag(player);
      else this.finishShot();
      return;
    }
    // Client: the host decides. Use its result once we have settled too, or
    // if it arrived a while ago and our replay is still rolling, snap to it.
    const pending = this.pendingOutcomes.get(this.rollingSeq);
    if (settled) this.settledFor += dt;
    this.syncing = settled && !pending && this.settledFor > OUTCOME_GRACE;
    if (!pending) return;
    if (!settled && this.clock - pending.at < 2.5) return;
    const out = pending.msg;
    this.pendingOutcomes.delete(this.rollingSeq);
    this.syncing = false;
    sfx.roll(0);
    if (out.kind === 'lag' && kind === 'lag-roll') this.finishLag(player, out);
    else if (out.kind === 'shot' && kind === 'roll') this.finishShot(out.outcome);
  }

  /** Bots "think", slide to their spot, swing the aim round and pull back, so the shot reads. */
  private animateBot(dt: number, lagging: boolean): void {
    const plan = this.botPlan!;
    this.botTimer -= dt;
    const t = Math.max(0, this.botTimer);
    if (!lagging && this.canPlace && this.botStartFrom) {
      // Glide along the ring line to the chosen spot during the first part of the think time.
      const a0 = Math.atan2(this.botStartFrom.z, this.botStartFrom.x);
      const a1 = Math.atan2(plan.from.z, plan.from.x);
      let da = a1 - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const k = Math.min(1, Math.max(0, 1 - (t - 0.9) / 0.6));
      const a = a0 + da * easeInOut(k);
      const p = { x: Math.cos(a) * this.config.ringRadius, z: Math.sin(a) * this.config.ringRadius };
      this.aim.from = p;
      this.sim.placeShooter(p);
      const lookYaw = this.aim.yaw + angleDelta(this.aim.yaw, plan.yaw) * Math.min(1, dt * 4);
      this.aim.yaw = lookYaw;
      this.scene.setAimYaw(p, lookYaw);
    } else if (!lagging) {
      this.aim.yaw += angleDelta(this.aim.yaw, plan.yaw) * Math.min(1, dt * 4);
      this.scene.setAimYaw(this.aim.from, this.aim.yaw);
    }
    // Pull back over the last half second.
    this.aim.power = t < 0.5 ? plan.power * easeInOut(1 - t / 0.5) : 0;
    if (this.botTimer <= 0) {
      this.botPlan = null;
      this.botStartFrom = null;
      this.aim.from = plan.from;
      this.takeShot(plan);
    }
  }

  private watchCrossings(player: number): void {
    for (const id of Object.keys(this.state.targets)) {
      if (this.crossed.has(id)) continue;
      const p = this.sim.pos(id);
      if (!p || !isInRing(this.config, p)) {
        this.crossed.add(id);
        const at = p ?? this.state.targets[id];
        this.scene.burst(at.x, at.z, this.players[player].color);
        sfx.chime(this.crossed.size);
        this.events.onKnock?.(player, at.x, at.z);
      }
    }
  }

  private emit(): void {
    this.events.onChange?.(this);
  }

  dispose(): void {
    this.sim.dispose();
  }
}

function angleDelta(from: number, to: number): number {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** A view that draws nothing: headless matches, tests, a dedicated host. */
export const NULL_VIEW: MatchView = {
  loadArena() {},
  syncBodies() {},
  setShooterLook() {},
  showLagLine() {},
  showAim() {},
  frame() {},
  setAimYaw() {},
  burst() {},
  addShake() {},
};

export { BOT_PROFILES };
