import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOT_PROFILES } from '../ai/profiles';
import { ARENAS, type ArenaId } from '../game/arenas';
import { settings } from '../game/settings';
import { FIGHTERS } from '../game/story';
import { P2PMatchmaker } from '../net/p2pMatchmaker';
import type { RoomInfo } from '../net/protocol';
import { OnlineRoom } from '../net/room';
import { ServerMatchmaker } from '../net/serverMatchmaker';
import type { Matchmaker } from '../net/transport';
import { ArenaPicker, Chips, MapPicker, MapPreview, MarbleChip, Screen, tap } from './components';
import { generateMap, type Difficulty } from '../game/maps';

let shared: { key: string; mm: Matchmaker } | null = null;
/** One matchmaker per connection mode; switching mode in Settings swaps it. */
function matchmakerFor(mode: 'p2p' | 'server', url: string): Matchmaker {
  const key = mode === 'p2p' ? 'p2p' : `server:${url}`;
  if (!shared || shared.key !== key) {
    shared?.mm.close();
    shared = { key, mm: mode === 'p2p' ? new P2PMatchmaker() : new ServerMatchmaker(url) };
  }
  return shared.mm;
}

export function OnlineHub({ onBack, onRoom }: { onBack: () => void; onRoom: (r: OnlineRoom) => void }) {
  const st = settings.use((s) => s);
  const [tab, setTab] = useState<'browse' | 'host'>('browse');
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [roomName, setRoomName] = useState(`${st.playerName}'s ring`);
  const [arena, setArena] = useState<ArenaId>('culdesac');
  const [maxPlayers, setMaxPlayers] = useState<'2' | '3' | '4'>('2');
  const [priv, setPriv] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const mm = matchmakerFor(st.netMode, st.lobbyUrl);
      await mm.connect();
      setRooms(await mm.listRooms());
    } catch (e) {
      setRooms(null);
      setError(
        st.netMode === 'p2p'
          ? `Couldn't reach the public relays used to find games (${(e as Error).message}). Check your connection; joining by code may still work.`
          : `${(e as Error).message} Check the lobby server address in Settings, or switch the connection to peer to peer.`,
      );
    }
  }, [st.lobbyUrl, st.netMode]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const join = async (opts: { roomId?: string; code?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const room = await OnlineRoom.join(matchmakerFor(st.netMode, st.lobbyUrl), { ...opts, name: st.playerName, marble: st.marble });
      onRoom(room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const host = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await OnlineRoom.host(matchmakerFor(st.netMode, st.lobbyUrl), {
        roomName: roomName.trim() || `${st.playerName}'s ring`,
        arena,
        maxPlayers: +maxPlayers,
        private: priv,
        name: st.playerName,
        marble: st.marble,
      });
      onRoom(room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = rooms?.filter((r) => !r.started && r.players < r.maxPlayers) ?? [];
  const full = rooms?.filter((r) => r.started || r.players >= r.maxPlayers) ?? [];

  return (
    <Screen title="Online" onBack={onBack}>
      <Chips
        label="Online mode"
        value={tab}
        options={[
          { id: 'browse', label: 'Find a room' },
          { id: 'host', label: 'Host a room' },
        ]}
        onChange={setTab}
      />
      {error && <div className="notice">{error}</div>}

      {tab === 'browse' ? (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) void join({ code });
            }}
          >
            <label className="field" style={{ flex: 2 }}>
              Room code
              <input className="code-input" value={code} maxLength={4} placeholder="ABCD" onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())} />
            </label>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={code.length !== 4 || busy}>
              Join
            </button>
          </form>
          <div className="screen-head">
            <div className="section-title" style={{ flex: 1, margin: 0 }}>
              Open rooms
            </div>
            <button
              className="btn small ghost"
              onClick={() => {
                tap();
                void refresh();
              }}
            >
              Refresh
            </button>
          </div>
          <div className="list">
            {rooms === null && !error && <div className="list-item">Looking for rooms…</div>}
            {rooms !== null && open.length === 0 && (
              <div className="list-item">
                <span className="grow">
                  <b>No open rooms right now</b>
                  <small>Host one and share the code with a friend.</small>
                </span>
              </div>
            )}
            {open.map((r) => (
              <button key={r.id} className="list-item clickable" disabled={busy} onClick={() => void join({ roomId: r.id, code: r.code })}>
                <span className="grow">
                  <b>{r.name}</b>
                  <small>
                    {ARENAS[r.arena]?.name ?? r.arena} · hosted by {r.hostName}
                  </small>
                </span>
                <span className="pill ok">
                  {r.players}/{r.maxPlayers}
                </span>
              </button>
            ))}
            {full.map((r) => (
              <div key={r.id} className="list-item" style={{ opacity: 0.5 }}>
                <span className="grow">
                  <b>{r.name}</b>
                  <small>{r.started ? 'Match in progress' : 'Full'}</small>
                </span>
                <span className="pill">
                  {r.players}/{r.maxPlayers}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="field">
            Room name
            <input value={roomName} maxLength={28} onChange={(e) => setRoomName(e.target.value)} />
          </label>
          <div className="section-title">Players</div>
          <Chips
            label="Max players"
            value={maxPlayers}
            options={[
              { id: '2', label: '2' },
              { id: '3', label: '3' },
              { id: '4', label: '4' },
            ]}
            onChange={setMaxPlayers}
          />
          <div className="chips">
            <button className="chip" aria-pressed={priv} onClick={() => setPriv(!priv)}>
              {priv ? 'Private · code only' : 'Public · listed in the browser'}
            </button>
          </div>
          <div className="section-title">Field</div>
          <ArenaPicker value={arena} onChange={setArena} />
          <button className="btn primary" disabled={busy} onClick={() => void host()}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </>
      )}
    </Screen>
  );
}

const BOT_NAMES = FIGHTERS.filter((f) => f.id !== 'obsidian');

/** What a guest sees of the host's chosen map. */
function GuestMapView({ arena, difficulty, seed }: { arena: ArenaId; difficulty: Difficulty; seed: number }) {
  const map = useMemo(() => generateMap({ arena, difficulty, seed }), [arena, difficulty, seed]);
  return (
    <div className="map-card">
      <MapPreview map={map} size={150} />
      <div className="map-meta">
        <b className="map-name">{map.name}</b>
        <span className="map-sum">
          {ARENAS[arena].name} · {difficulty}
        </span>
      </div>
    </div>
  );
}

export function RoomLobby({ room, onLeave }: { room: OnlineRoom; onLeave: () => void }) {
  const s = room.state.use((x) => x);
  const [ready, setReady] = useState(false);
  const [botSkill, setBotSkill] = useState<'casual' | 'skilled' | 'expert'>('skilled');
  const myId = room.myId;

  return (
    <Screen
      title={s.room?.name ?? 'Room'}
      onBack={() => {
        room.leave();
        onLeave();
      }}
    >
      {s.room && (
        <div className="list-item">
          <span className="grow">
            <small>Room code</small>
            <b className="code-input" style={{ fontSize: 'var(--t-2xl)', letterSpacing: '0.25em' }}>
              {s.room.code}
            </b>
          </span>
          <button
            className="btn small"
            onClick={() => {
              tap();
              void navigator.clipboard?.writeText(s.room!.code);
            }}
          >
            Copy
          </button>
        </div>
      )}
      {s.error && <div className="notice">{s.error}</div>}

      <div className="section-title">Players</div>
      <div className="list">
        {s.roster.map((r) => (
          <div key={r.peerId} className="list-item">
            <MarbleChip id={r.marble} size={36} />
            <span className="grow">
              <b>
                {r.name}
                {r.peerId === myId ? ' (you)' : ''}
              </b>
              <small>
                {r.isHost ? 'Host' : r.isBot ? `Bot · ${BOT_PROFILES[r.botProfile ?? 'skilled'].label}` : s.links[r.peerId] === 'relay' ? 'Connected via relay' : s.links[r.peerId] === 'direct' ? 'Connected peer to peer' : room.isHost ? 'Connecting…' : 'Player'}
              </small>
            </span>
            <span className={`pill ${r.ready ? 'ok' : 'wait'}`}>{r.ready ? 'Ready' : 'Not ready'}</span>
            {room.isHost && !r.isHost && (
              <button className="btn icon ghost" aria-label={`Remove ${r.name}`} onClick={() => room.removeEntry(r.peerId)}>
                ✕
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: Math.max(0, (s.room?.maxPlayers ?? 2) - s.roster.length) }, (_, i) => (
          <div key={`empty-${i}`} className="list-item" style={{ opacity: 0.5 }}>
            <span className="grow">
              <small>Waiting for a player — share the code</small>
            </span>
          </div>
        ))}
      </div>

      {room.isHost ? (
        <>
          {s.roster.length < (s.room?.maxPlayers ?? 2) && (
            <div className="row" style={{ alignItems: 'center' }}>
              <Chips
                label="Bot skill"
                value={botSkill}
                options={[
                  { id: 'casual', label: 'Casual' },
                  { id: 'skilled', label: 'Skilled' },
                  { id: 'expert', label: 'Expert' },
                ]}
                onChange={setBotSkill}
              />
              <button
                className="btn small"
                onClick={() => {
                  tap();
                  const f = BOT_NAMES[(s.roster.length * 3) % BOT_NAMES.length];
                  room.addBot(botSkill, f.name, f.marble);
                }}
              >
                Add bot
              </button>
            </div>
          )}
          <div className="section-title">Field &amp; map</div>
          <MapPicker
            value={{ arena: s.arena, difficulty: s.difficulty, seed: s.mapSeed }}
            onChange={(v) => {
              if (v.arena !== s.arena) room.setArena(v.arena);
              room.setLevel(v.difficulty, v.seed);
            }}
          />
          <button
            className="btn primary"
            disabled={!room.canStart}
            onClick={() => {
              tap();
              room.start();
            }}
          >
            {s.roster.length < 2 ? 'Waiting for players' : room.canStart ? 'Start match' : 'Waiting for everyone to be ready'}
          </button>
        </>
      ) : (
        <>
          <GuestMapView arena={s.arena} difficulty={s.difficulty} seed={s.mapSeed} />
          <p className="lede" style={{ margin: 0 }}>
            The host picks the map and starts the match once everyone is ready.
          </p>
          <button
            className={`btn ${ready ? '' : 'primary'}`}
            onClick={() => {
              tap();
              const r = !ready;
              setReady(r);
              room.setReady(r);
            }}
          >
            {ready ? 'Not ready' : "I'm ready"}
          </button>
        </>
      )}
    </Screen>
  );
}
