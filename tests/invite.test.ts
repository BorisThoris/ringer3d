import { describe, expect, it } from 'vitest';
import { codeFromUrl, inviteLink } from '../src/invite';

describe('invite links', () => {
  it('round-trip a room code', () => {
    expect(inviteLink('abcd')).toBe('https://ringer3d.modaxxx009.workers.dev/join?room=ABCD');
    expect(codeFromUrl(inviteLink('wxyz'))).toBe('WXYZ');
  });

  it('read the other forms a link can arrive in', () => {
    expect(codeFromUrl('https://ringer3d.modaxxx009.workers.dev/join/qrst')).toBe('QRST');
    expect(codeFromUrl('https://pc.local/ringer3d/join?room=EFGH')).toBe('EFGH');
    expect(codeFromUrl('/?room=mnop')).toBe('MNOP');
  });

  it('ignore anything that is not a room', () => {
    expect(codeFromUrl('https://ringer3d.modaxxx009.workers.dev/')).toBeNull();
    expect(codeFromUrl('https://ringer3d.modaxxx009.workers.dev/join?room=ABC')).toBeNull();
    expect(codeFromUrl('https://ringer3d.modaxxx009.workers.dev/join?room=AB12')).toBeNull();
    expect(codeFromUrl('not a url at all ::')).toBeNull();
  });
});
