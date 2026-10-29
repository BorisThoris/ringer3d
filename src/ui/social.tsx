import { useEffect, useState } from 'react';
import { services, LEADERBOARDS, type BoardId, type Friend, type LeaderboardEntry } from '../services';
import { Chips, Screen, tap } from './components';

type Scope = 'global' | 'friends' | 'around';

/** The leaderboards, from whichever platform this build is on (personal bests off-platform). */
export function Leaderboards({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<BoardId>('wins');
  const [scope, setScope] = useState<Scope>('global');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const local = services.platform === 'local';

  useEffect(() => {
    void services.identity().then((i) => setMe(i?.id ?? null));
  }, []);
  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    services
      .scores(board, scope, 10)
      .then((r) => live && setRows(r))
      .catch((e: Error) => live && (setError(e.message), setRows([])));
    return () => {
      live = false;
    };
  }, [board, scope]);

  return (
    <Screen title="Leaderboards" onBack={onBack}>
      <Chips label="Board" value={board} options={(Object.keys(LEADERBOARDS) as BoardId[]).map((id) => ({ id, label: LEADERBOARDS[id].title }))} onChange={setBoard} />
      {!local && (
        <Chips
          label="Who"
          value={scope}
          options={[
            { id: 'global', label: 'Everyone' },
            { id: 'friends', label: 'Friends' },
            { id: 'around', label: 'Around me' },
          ]}
          onChange={setScope}
        />
      )}
      {local && <p className="fine">Your personal best on this device. Steam and Google Play builds rank you against everyone.</p>}
      {error && <div className="notice">{error.includes('no leaderboard') ? 'No scores on this board yet: be the first.' : error}</div>}
      {rows === null ? (
        <p className="fine">Loading…</p>
      ) : rows.length === 0 && !error ? (
        <p className="fine">No scores yet: play a match.</p>
      ) : (
        <ol className="board-list">
          {rows.map((r) => (
            <li key={`${r.playerId}-${r.rank}`} className={r.playerId === me ? 'me' : ''}>
              <span className={`rank r${Math.min(r.rank, 4)}`}>{r.rank}</span>
              <b>{r.name || 'Player'}</b>
              <span className="score">{r.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </Screen>
  );
}

/** Friends on the platform: who's in a game you can join, who's online. Nothing off-platform. */
export function FriendsPanel({ onJoin }: { onJoin: (lobby: string) => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  useEffect(() => {
    if (services.platform === 'local') return;
    const load = () =>
      void services
        .friends()
        .then(setFriends)
        .catch(() => setFriends([]));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!friends) return null;
  // Everyone in a game you can join; only a few of the merely-online, so rooms stay in view.
  const inGame = friends.filter((f) => f.inGame);
  const online = friends.filter((f) => !f.inGame && f.online);
  const shown = [...inGame, ...online.slice(0, 3)];
  const more = online.length - Math.min(3, online.length);
  if (shown.length === 0) return null;
  return (
    <section className="friends">
      <div className="section-title">Friends</div>
      <div className="list">
        {shown.map((f) => (
          <div key={f.id} className={`list-item friend${f.inGame ? ' in-game' : ''}`}>
            <span className={`dot ${f.inGame ? 'game' : 'on'}`} aria-hidden />
            <span className="grow">
              <b>{f.name}</b>
              <small>{f.inGame ? f.status || 'Playing Ringer' : 'Online'}</small>
            </span>
            {f.lobby ? (
              <button
                className="btn small primary"
                onClick={() => {
                  tap();
                  onJoin(f.lobby!);
                }}
              >
                Join
              </button>
            ) : (
              services.showProfile && (
                <button className="btn small ghost" onClick={() => services.showProfile!(f.id)}>
                  Profile
                </button>
              )
            )}
          </div>
        ))}
      </div>
      {more > 0 && <p className="fine">+{more} more online</p>}
    </section>
  );
}
