import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Invite links: https://ringer3d.modaxxx009.workers.dev/join?room=ABCD. On the web the link opens the
 * game, which joins room ABCD; on Android it opens the installed app instead (an Android App
 * Link, verified by /.well-known/assetlinks.json on the same host). Rooms are the peer-to-peer
 * ones (src/net/p2pMatchmaker.ts), so a phone and a browser can meet in the same room.
 */
export const INVITE_ORIGIN = 'https://ringer3d.modaxxx009.workers.dev';

/** The native side (android/app AppLinksPlugin): the share sheet and the links that opened the app. */
interface AppLinksPlugin {
  share(o: { title: string; text: string; url: string }): Promise<void>;
  /** The link the app was started with, if any (read once). */
  launchUrl(): Promise<{ url: string | null }>;
  addListener(event: 'link', cb: (e: { url: string }) => void): Promise<PluginListenerHandle>;
}
const native = Capacitor.isPluginAvailable('AppLinks') ? registerPlugin<AppLinksPlugin>('AppLinks') : null;

// /join?room=ABCD, not /join/ABCD: the build uses relative asset paths, which only resolve from a
// page that sits at the site root (or the root of whatever path it's served under).
export const inviteLink = (code: string) => `${INVITE_ORIGIN}/join?room=${code.toUpperCase()}`;

/** The room code in an invite link (?room=ABCD, or /join/ABCD), or null. */
export function codeFromUrl(url: string): string | null {
  try {
    const u = new URL(url, INVITE_ORIGIN);
    const m = /\/join\/([a-z]{4})\/?$/i.exec(u.pathname) ?? /^([a-z]{4})$/i.exec(u.searchParams.get('room') ?? '');
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Share an invite to a room: the share sheet where there is one, else the clipboard. */
export async function shareInvite(code: string, host: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = inviteLink(code);
  const text = `${host} wants a game of Ringer. Room ${code.toUpperCase()}:`;
  try {
    if (native) {
      await native.share({ title: 'Play Ringer with me', text, url });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title: 'Play Ringer with me', text, url });
      return 'shared';
    }
  } catch (e) {
    // Closing the share sheet isn't a failure worth a message.
    if ((e as Error).name === 'AbortError') return 'shared';
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Calls back with the room code of every invite link that opens the game, the first one included. */
export function onInviteLink(cb: (code: string) => void): () => void {
  let live = true;
  const take = (url: string | null | undefined) => {
    const code = url ? codeFromUrl(url) : null;
    if (code && live) cb(code);
  };
  if (native) {
    let handle: PluginListenerHandle | null = null;
    void native.addListener('link', (e) => take(e.url)).then((h) => (live ? (handle = h) : void h.remove()));
    void native.launchUrl().then((r) => take(r.url));
    return () => {
      live = false;
      void handle?.remove();
    };
  }
  if (typeof location !== 'undefined') {
    const code = codeFromUrl(location.href);
    if (code) {
      // Leave /join?room=ABCD (under whatever path the build is served from) so a reload doesn't join again.
      history.replaceState(null, '', import.meta.env.BASE_URL);
      queueMicrotask(() => take(`/join?room=${code}`));
    }
  }
  return () => {
    live = false;
  };
}
