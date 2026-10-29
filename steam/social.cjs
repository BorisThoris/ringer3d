// Leaderboards (ISteamUserStats), friends (ISteamFriends) and the game-recording timeline
// (ISteamTimeline) through Steam's flat API (flatlib.cjs). Asynchronous Steam calls return a
// SteamAPICall_t whose result the shared callback loop (pump.cjs) delivers. Structs are read from
// buffers at their offsets for 64-bit Windows (8-byte packing).
const { flat } = require('./flatlib.cjs');
const { callResult } = require('./pump.cjs');

const SORT = { asc: 1, desc: 2 };
const SCOPE = { global: 0, around: 1, friends: 2 };
// Callback ids of the call results we read.
const CB = { find: 1104, downloaded: 1105, uploaded: 1106 };
const STATE = ['offline', 'online', 'busy', 'away', 'snooze', 'trade', 'play'];

function createSocial() {
  const { f, tryF } = flat();
  const UserStats = f('void* SteamAPI_SteamUserStats_v012()')();
  const Friends = f('void* SteamAPI_SteamFriends_v017()')();
  const timelineSelf = tryF('void* SteamAPI_SteamTimeline_v001()');
  const Timeline = timelineSelf ? timelineSelf() : null;

  const FindOrCreateLeaderboard = f('uint64 SteamAPI_ISteamUserStats_FindOrCreateLeaderboard(void* self, const char* name, int sort, int display)');
  const FindLeaderboard = f('uint64 SteamAPI_ISteamUserStats_FindLeaderboard(void* self, const char* name)');
  const UploadLeaderboardScore = f('uint64 SteamAPI_ISteamUserStats_UploadLeaderboardScore(void* self, uint64 board, int method, int32 score, const int32* details, int n)');
  const DownloadLeaderboardEntries = f('uint64 SteamAPI_ISteamUserStats_DownloadLeaderboardEntries(void* self, uint64 board, int scope, int start, int end)');
  const GetDownloadedLeaderboardEntry = f('bool SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry(void* self, uint64 entries, int i, void* out, void* details, int maxDetails)');
  const GetFriendCount = f('int SteamAPI_ISteamFriends_GetFriendCount(void* self, int flags)');
  const GetFriendByIndex = f('uint64 SteamAPI_ISteamFriends_GetFriendByIndex(void* self, int i, int flags)');
  const GetFriendPersonaName = f('const char* SteamAPI_ISteamFriends_GetFriendPersonaName(void* self, uint64 id)');
  const GetFriendPersonaState = f('int SteamAPI_ISteamFriends_GetFriendPersonaState(void* self, uint64 id)');
  const GetFriendGamePlayed = f('bool SteamAPI_ISteamFriends_GetFriendGamePlayed(void* self, uint64 id, void* out)');
  const GetFriendRichPresence = f('const char* SteamAPI_ISteamFriends_GetFriendRichPresence(void* self, uint64 id, const char* key)');
  const ActivateGameOverlayToUser = f('void SteamAPI_ISteamFriends_ActivateGameOverlayToUser(void* self, const char* dialog, uint64 id)');
  const AddTimelineEvent = Timeline
    ? tryF('void SteamAPI_ISteamTimeline_AddTimelineEvent(void* self, const char* icon, const char* title, const char* desc, uint32 priority, float start, float duration, int clip)')
    : null;
  const SetTimelineGameMode = Timeline ? tryF('void SteamAPI_ISteamTimeline_SetTimelineGameMode(void* self, int mode)') : null;
  const SetTimelineStateDescription = Timeline ? tryF('void SteamAPI_ISteamTimeline_SetTimelineStateDescription(void* self, const char* desc, float offset)') : null;

  const u64 = (v) => BigInt.asUintN(64, BigInt(v));
  const boards = new Map(); // name -> handle (bigint)

  /** Wait for a Steam call result and return its bytes (delivered by the shared loop, pump.cjs). */
  const result = (call, size, expected, what) => callResult(call, size, expected, what);

  /** A leaderboard handle by name. `create` makes it when missing (descending, numeric). */
  async function board(name, create = true) {
    if (boards.has(name)) return boards.get(name);
    const call = create ? FindOrCreateLeaderboard(UserStats, name, SORT.desc, 1) : FindLeaderboard(UserStats, name);
    const buf = await result(call, 16, CB.find, 'leaderboard');
    if (!buf.readUInt8(8)) throw new Error(`no leaderboard "${name}"`);
    const h = buf.readBigUInt64LE(0);
    boards.set(name, h);
    return h;
  }

  return {
    /** Submit a score; keepBest leaves a better earlier score in place. */
    async submitScore(name, score, keepBest = true) {
      const h = await board(name);
      const buf = await result(UploadLeaderboardScore(UserStats, h, keepBest ? 1 : 2, Math.trunc(score), null, 0), 32, CB.uploaded, 'upload');
      return { ok: !!buf.readUInt8(0), score: buf.readInt32LE(16), changed: !!buf.readUInt8(20), rank: buf.readInt32LE(24), previousRank: buf.readInt32LE(28) };
    },
    /** Entries: scope global (ranks start..end), around (the player, start..end relative) or friends. */
    async scores(name, scope = 'global', start = 1, end = 10) {
      const h = await board(name, false);
      const buf = await result(DownloadLeaderboardEntries(UserStats, h, SCOPE[scope] ?? 0, start, end), 24, CB.downloaded, 'download');
      const entries = buf.readBigUInt64LE(8);
      const n = buf.readInt32LE(16);
      const out = [];
      const e = Buffer.alloc(32);
      for (let i = 0; i < n; i++) {
        if (!GetDownloadedLeaderboardEntry(UserStats, entries, i, e, null, 0)) continue;
        const id = e.readBigUInt64LE(0);
        out.push({ steamId: id.toString(), name: GetFriendPersonaName(Friends, id) || '', rank: e.readInt32LE(8), score: e.readInt32LE(12) });
      }
      return out;
    },
    /** Friends (flags 0x04 = regular friends) with their state and what they're playing. */
    friends() {
      const n = GetFriendCount(Friends, 0x04);
      const g = Buffer.alloc(24);
      const list = [];
      for (let i = 0; i < n; i++) {
        const id = u64(GetFriendByIndex(Friends, i, 0x04));
        const playing = GetFriendGamePlayed(Friends, id, g);
        list.push({
          steamId: id.toString(),
          name: GetFriendPersonaName(Friends, id) || '',
          state: STATE[GetFriendPersonaState(Friends, id)] ?? 'offline',
          appId: playing ? Number(g.readBigUInt64LE(0) & 0xffffffn) : 0,
          lobby: playing ? g.readBigUInt64LE(16).toString() : '0',
          status: GetFriendRichPresence(Friends, id, 'status') || '',
        });
      }
      return list;
    },
    /** The Steam overlay on a user: 'steamid' (profile), 'chat', 'friendadd', ... */
    showUser(steamId, dialog = 'steamid') {
      ActivateGameOverlayToUser(Friends, dialog, u64(steamId));
    },
    /** Game recording (Steam Timeline): a marker, the current state, the mode. False if unavailable. */
    timelineEvent(title, desc = '', icon = 'steam_marker', priority = 50) {
      if (!AddTimelineEvent) return false;
      AddTimelineEvent(Timeline, icon, title, desc, priority, 0, 0, 0);
      return true;
    },
    timelineState(desc) {
      if (!SetTimelineStateDescription) return false;
      SetTimelineStateDescription(Timeline, desc, 0);
      return true;
    },
    /** 1 playing, 2 staging (lobby), 3 menus, 4 loading. */
    timelineMode(mode) {
      if (!SetTimelineGameMode) return false;
      SetTimelineGameMode(Timeline, mode);
      return true;
    },
  };
}

module.exports = { createSocial };
