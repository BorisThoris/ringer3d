import { beforeAll, describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../bots/bot';
import { initPhysics } from '../sim/physics';
import { Match, NULL_VIEW, type MatchPlayer } from './match';

beforeAll(() => initPhysics());

/** A one-way pipe that delivers after `delay` ticks. */
function pipe<T>(delay: number) {
  const q: { at: number; v: T }[] = [];
  let now = 0;
  return {
    push: (v: T) => q.push({ at: now + delay, v }),
    tick: (deliver: (v: T) => void) => {
      now++;
      while (q.length && q[0].at <= now) deliver(q.shift()!.v);
    },
  };
}

function seats(hostSide: boolean): MatchPlayer[] {
  // Seat 0 is the host's bot, seat 1 the client's bot. Each side runs its own
  // bot locally and sees the other as remote, exactly like two humans online.
  return [
    { id: 'h', name: 'Host', color: '#5ad1ff', controller: hostSide ? { kind: 'bot', profile: BOT_PROFILES.sharp } : { kind: 'remote' } },
    { id: 'c', name: 'Client', color: '#ff5a7a', controller: hostSide ? { kind: 'remote' } : { kind: 'bot', profile: BOT_PROFILES.regular } },
  ];
}

function playOnline(opts: { sabotageClient: boolean; delay: number; arena: string }) {
  const toClient = pipe<(m: Match) => void>(opts.delay);
  const toHost = pipe<(m: Match) => void>(opts.delay);
  const host: Match = new Match(
    NULL_VIEW,
    { arena: opts.arena, players: seats(true), role: 'host', seed: 7 },
    {
      onShot: (p, seq, shot) => toClient.push((m) => m.receiveShot(p, seq, shot)),
      onOutcome: (msg) => toClient.push((m) => m.receiveOutcome(msg)),
    },
  );
  const client: Match = new Match(
    NULL_VIEW,
    { arena: opts.arena, players: seats(false), role: 'client', seed: 99 },
    { onShot: (p, seq, shot) => toHost.push((m) => m.receiveShot(p, seq, shot)) },
  );
  if (opts.sabotageClient) {
    // The client's physics disagrees with the host's on every shot.
    const shoot = client.sim.shoot.bind(client.sim);
    client.sim.shoot = (s) => shoot({ ...s, power: Math.min(1, s.power * 1.15), yaw: s.yaw + 0.02 });
  }
  const dt = 1 / 30;
  let t = 0;
  while (t < 3600 && !(host.stage.kind === 'over' && client.stage.kind === 'over')) {
    host.update(dt);
    client.update(dt);
    toClient.tick((f) => f(client));
    toHost.tick((f) => f(host));
    t += dt;
  }
  return { host, client, t };
}

describe('online play (host-authoritative)', () => {
  it('host and client end with the same game, even when the client simulates differently', () => {
    const { host, client, t } = playOnline({ sabotageClient: true, delay: 4, arena: 'rooftop' });
    expect(host.stage.kind).toBe('over');
    expect(client.stage.kind).toBe('over');
    expect(t).toBeLessThan(3600);
    expect(client.state.order).toEqual(host.state.order);
    expect(client.lagResults).toEqual(host.lagResults);
    expect(client.state.captured).toEqual(host.state.captured);
    expect(client.state.shots).toBe(host.state.shots);
    expect(client.state.event).toEqual(host.state.event);
    expect(host.state.captured.flat().length).toBe(13);
  }, 120000);

  it('after a lag tie, each tied player lags once more, in turn', () => {
    const players: MatchPlayer[] = [
      { id: 'a', name: 'A', color: '#fff', controller: { kind: 'remote' } },
      { id: 'b', name: 'B', color: '#fff', controller: { kind: 'remote' } },
    ];
    const m = new Match(NULL_VIEW, { arena: 'schoolyard', players }, {});
    const lagged: number[] = [];
    const run = (until: () => boolean) => {
      for (let i = 0; i < 3000 && !until(); i++) m.update(1 / 30);
    };
    const lag = (player: number, power: number) => {
      run(() => m.stage.kind === 'lag-wait');
      expect(m.activePlayer).toBe(player);
      lagged.push(player);
      m.receiveShot(player, m.nextSeq, { from: { x: -90, z: 96 }, yaw: 0, power, spin: 0, english: 0 });
      run(() => m.stage.kind !== 'lag-roll');
    };
    lag(0, 1); // full power: off the pitch
    lag(1, 1); // same: a tie
    expect(m.state.lag).toEqual([null, null]);
    lag(0, 0.55);
    lag(1, 0.6);
    run(() => m.stage.kind === 'aim');
    expect(lagged).toEqual([0, 1, 0, 1]);
    expect(m.state.order.length).toBe(2);
  }, 60000);

  it('a seat handed to a bot mid-match keeps the game going', () => {
    const toClient = pipe<(m: Match) => void>(2);
    const host = new Match(NULL_VIEW, { arena: 'schoolyard', players: seats(true), role: 'host', seed: 3, lag: false }, {
      onShot: (p, seq, shot) => toClient.push((m) => m.receiveShot(p, seq, shot)),
    });
    // The client never connects: after a moment the host gives its seat to a bot.
    let t = 0;
    const dt = 1 / 30;
    let handed = false;
    while (t < 1800 && host.stage.kind !== 'over') {
      host.update(dt);
      t += dt;
      if (!handed && host.activePlayer === 1) {
        host.setController(1, { kind: 'bot', profile: BOT_PROFILES.rookie });
        handed = true;
      }
    }
    expect(handed).toBe(true);
    expect(host.stage.kind).toBe('over');
  }, 120000);
});
