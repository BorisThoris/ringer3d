import { useEffect, useRef, useState } from 'react';
import { TARGET_COUNT } from '../core/constants';
import { hud } from '../game/store';
import { engine } from './engine';
import { MarbleChip, tap } from './components';

const EMOTES = ['Nice shot', 'So close', 'Oops', 'GG'];

export function Hud({ onQuit, online }: { onQuit: () => void; online: boolean }) {
  const s = hud.use((x) => x);
  const [paused, setPaused] = useState(false);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('ringer3d.hinted'));

  useEffect(() => {
    if (s.myTurn && s.power > 0.05 && showHint) {
      setShowHint(false);
      try {
        localStorage.setItem('ringer3d.hinted', '1');
      } catch {
        /* ignore */
      }
    }
  }, [s.myTurn, s.power, showHint]);

  if (!s.active) return null;
  const session = engine.session;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="scoreboard" aria-label="Scores">
          {s.players.map((p, i) => (
            <div key={i} className={`score-pill${i === s.current ? ' active' : ''}${p.connected ? '' : ' off'}`}>
              <MarbleChip id={p.marble} size={30} />
              <span className="name">
                {p.name}
                {p.kind === 'bot' && !p.local ? ' · bot' : ''}
              </span>
              <span className="score">{p.score}</span>
            </div>
          ))}
        </div>
        <button
          className="btn icon"
          aria-label="Pause"
          onClick={() => {
            tap();
            setPaused(true);
          }}
        >
          ❚❚
        </button>
      </div>

      <div className="remaining" aria-label={`${s.remaining} marbles left in the ring`}>
        {Array.from({ length: TARGET_COUNT }, (_, i) => (
          <i key={i} className={i < s.remaining ? '' : 'gone'} />
        ))}
      </div>

      {s.banner && (
        <div key={s.banner.id} className={`banner ${s.banner.tone}${s.winners ? ' sticky' : ''}`}>
          <h1>{s.banner.title}</h1>
          {s.banner.sub && <p>{s.banner.sub}</p>}
        </div>
      )}

      {s.netStatus && <div className="toast sheet">{s.netStatus}</div>}

      <PowerSlider enabled={s.myTurn} power={s.power} />

      <div className="hud-bottom">
        {s.myTurn ? (
          <div>
            <SpinPad spin={s.spin} />
            <div className="spin-label">{s.spin < -0.15 ? 'Backspin · stick' : s.spin > 0.15 ? 'Topspin · follow' : 'Spin'}</div>
          </div>
        ) : null}
        {s.myTurn && showHint && (
          <div className="sheet hint-card">
            {s.firstShot ? 'Drag your shooter to slide along the ring. ' : ''}Drag anywhere to aim, then pull the slider down and let go to flick.
          </div>
        )}
        <div className="spacer" />
        {online && !s.myTurn && (
          <div className="emotes">
            {EMOTES.slice(0, 2).map((e) => (
              <button key={e} className="btn small" onClick={() => session?.sendEmote(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {!s.myTurn && !online && (
          <button
            className="btn small"
            aria-pressed={s.fast}
            onClick={() => {
              tap();
              session?.toggleFast();
            }}
          >
            {s.fast ? '1×' : '3× speed'}
          </button>
        )}
        <button
          className="btn icon"
          aria-label={s.camTop ? 'Shooter view' : 'Top view'}
          title="Camera (T)"
          onClick={() => {
            tap();
            session?.toggleCam();
          }}
        >
          {s.camTop ? '◎' : '⌖'}
        </button>
      </div>

      {s.thinking && (
        <div className="thinking sheet" aria-live="polite">
          {s.players[s.current]?.name} is lining up <i />
          <i />
          <i />
        </div>
      )}

      {paused && (
        <div className="overlay" style={{ background: 'rgba(8,12,26,0.45)' }}>
          <div className="sheet screen" style={{ width: 'min(380px, 100%)' }}>
            <div className="screen-head">
              <h2>Paused</h2>
            </div>
            {online && <p className="lede">The match keeps going while this menu is open.</p>}
            <button
              className="btn primary"
              onClick={() => {
                tap();
                setPaused(false);
              }}
            >
              Resume
            </button>
            {online && (
              <div className="row">
                {EMOTES.map((e) => (
                  <button key={e} className="btn small" onClick={() => session?.sendEmote(e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn danger"
              onClick={() => {
                tap();
                setPaused(false);
                onQuit();
              }}
            >
              {online ? 'Leave match' : 'Quit to menu'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pull down to set power, release to flick. Drag back to the top to cancel. */
function PowerSlider({ enabled, power }: { enabled: boolean; power: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const pad = 30;
    return Math.min(1, Math.max(0, (e.clientY - r.top - pad) / (r.height - pad * 2)));
  };

  return (
    <div
      ref={ref}
      className={`power${enabled ? '' : ' disabled'}`}
      role="slider"
      aria-label="Shot power. Pull down and release to shoot."
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
      onPointerDown={(e) => {
        if (!enabled) return;
        active.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        engine.session?.setPower(0);
      }}
      onPointerMove={(e) => {
        if (!active.current) return;
        engine.session?.setPower(fromEvent(e));
      }}
      onPointerUp={() => {
        if (!active.current) return;
        active.current = false;
        engine.session?.release();
      }}
      onPointerCancel={() => {
        active.current = false;
        engine.session?.cancelShot();
      }}
    >
      <div className="fill" style={{ height: `${power * 100}%` }} />
      <div className="thumb" style={{ top: `calc((100% - 62px) * ${power} + 4px)` }}>
        {power > 0.02 ? `${Math.round(power * 100)}` : '↓'}
      </div>
      <div className="label">{power > 0.02 ? 'Let go' : 'Pull'}</div>
    </div>
  );
}

function SpinPad({ spin }: { spin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const v = ((e.clientY - r.top) / r.height) * 2 - 1; // top = -1
    // Top of the pad = topspin (+1), bottom = backspin (-1), like striking a ball.
    engine.session?.setSpin(Math.round(-v * 10) / 10);
  };
  return (
    <div
      ref={ref}
      className="spin-pad"
      role="slider"
      aria-label="Spin: top of the marble for topspin, bottom for backspin"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(spin * 100)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) set(e);
      }}
      onDoubleClick={() => engine.session?.setSpin(0)}
    >
      <div className="dot" style={{ top: `${50 - spin * 38}%` }} />
    </div>
  );
}
