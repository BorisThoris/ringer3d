import { beforeAll, describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../bots/bot';
import { deviceSeed } from '../net/session';
import { initPhysics } from '../sim/physics';
import { Match, NULL_VIEW, type MatchPlayer } from './match';

beforeAll(() => initPhysics());

/** Bots on both devices (autoplay, or a guest seat handed to a bot), lagging online. */
function lagOnline(hostSeed: number, clientSeed: number): { decided: boolean; lags: number } {
  const seats = (h: boolean): MatchPlayer[] => [
    { id: 'h', name: 'Host', color: '#fff', controller: h ? { kind: 'bot', profile: BOT_PROFILES.sharp } : { kind: 'remote' } },
    { id: 'c', name: 'Client', color: '#fff', controller: h ? { kind: 'remote' } : { kind: 'bot', profile: BOT_PROFILES.sharp } },
  ];
  const toClient: (() => void)[] = [];
  const toHost: (() => void)[] = [];
  let lags = 0;
  const host: Match = new Match(NULL_VIEW, { arena: 'schoolyard', players: seats(true), role: 'host', seed: hostSeed }, {
    onShot: (p, seq, shot) => toClient.push(() => client.receiveShot(p, seq, shot)),
    onOutcome: (m) => {
      if (m.kind === 'lag') lags++;
      toClient.push(() => client.receiveOutcome(m));
    },
  });
  const client: Match = new Match(NULL_VIEW, { arena: 'schoolyard', players: seats(false), role: 'client', seed: clientSeed }, {
    onShot: (p, seq, shot) => toHost.push(() => host.receiveShot(p, seq, shot)),
  });
  for (let t = 0; t < 6000 && !(host.state.order.length && client.state.order.length); t++) {
    host.update(1 / 30);
    client.update(1 / 30);
    toClient.splice(0).forEach((f) => f());
    toHost.splice(0).forEach((f) => f());
    if (lags > 12) break;
  }
  return { decided: host.state.order.length === 2 && client.state.order.length === 2, lags };
}

describe('online lagging with bots on both devices', () => {
  it('a shared seed makes both bots throw identical lags and tie forever (the bug)', () => {
    expect(lagOnline(42, 42).decided).toBe(false);
  }, 60000);

  it('per-device seeds settle the order', () => {
    const r = lagOnline(deviceSeed(42, 'p1abc'), deviceSeed(42, 'p2xyz'));
    expect(r.decided).toBe(true);
    expect(deviceSeed(42, 'p1abc')).not.toBe(deviceSeed(42, 'p2xyz'));
  }, 60000);
});
