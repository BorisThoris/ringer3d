import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WORLD } from '../core/constants';
import { ARENA_LIST, ARENAS, type ArenaId } from '../game/arenas';
import { DIFFICULTIES, generateMap, randomSeed, type Difficulty, type MapDef } from '../game/maps';
import { lookFor, type MarbleLook } from '../game/marbles';
import { sound } from '../render/audio';
import { groundSwatch } from '../render/groundArt';
import { MarblePreview } from '../render/preview';
import { settings } from '../game/settings';
import { useBack } from './nav';

export function marbleGradient(look: MarbleLook): string {
  switch (look.core) {
    case 'steelie':
      return `radial-gradient(circle at 35% 30%, #ffffff 0%, ${look.base} 30%, ${look.accent} 65%, #3b4048 100%)`;
    case 'solid':
      return `radial-gradient(circle at 35% 30%, ${look.accent2} 0%, ${look.base} 45%, ${look.accent} 100%)`;
    case 'galaxy':
    case 'onyx':
    case 'neon':
      return `radial-gradient(circle at 60% 60%, ${look.accent} 0%, transparent 28%), radial-gradient(circle at 35% 35%, ${look.accent2} 0%, transparent 18%), radial-gradient(circle at 40% 35%, ${look.base} 0%, #000 100%)`;
    case 'onionskin':
      return `repeating-conic-gradient(from 10deg, ${look.accent} 0 12deg, ${look.accent2} 12deg 24deg, #fff6ea 24deg 36deg)`;
    case 'clearie':
      return `radial-gradient(circle at 40% 35%, #ffffff, ${look.base} 75%)`;
    case 'opal':
      return `conic-gradient(from 40deg, ${look.accent}, ${look.accent2}, ${look.base}, ${look.accent})`;
    case 'swirl':
      return `conic-gradient(from 0deg, ${look.accent} 0 18%, ${look.base} 18% 34%, ${look.accent2} 34% 50%, ${look.accent} 50% 68%, ${look.base} 68% 84%, ${look.accent2} 84%)`;
    default:
      return `linear-gradient(115deg, transparent 38%, ${look.accent} 40% 46%, ${look.accent2} 48% 52%, ${look.accent} 54% 60%, transparent 62%), radial-gradient(circle at 40% 35%, #ffffff, ${look.base} 70%)`;
  }
}

export function MarbleChip({ id, size = 36, style }: { id: string; size?: number; style?: CSSProperties }) {
  const look = lookFor(id);
  return <span className="marble" aria-hidden style={{ width: size, height: size, background: marbleGradient(look), ...style }} />;
}

export function tap() {
  sound.unlock();
  sound.chime('tap');
}

export function Screen({
  title,
  onBack,
  children,
  wide,
  actions,
  footer,
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
  /** The screen's main action (Play, Fight): pinned to the bottom, so it never hides below the fold. */
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // On a phone most screens scroll: say so while there is more below, since the scrollbar is hidden.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 24);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={`sheet screen${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
      <div className="screen-head">
        {onBack && (
          <button
            className="btn icon ghost"
            aria-label="Back"
            onClick={() => {
              tap();
              onBack();
            }}
          >
            ‹
          </button>
        )}
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
      <div className={`screen-foot${footer ? ' has-action' : ''}${more ? ' more' : ''}`}>
        <button
          className="more-hint"
          tabIndex={-1}
          aria-hidden
          onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.7, behavior: 'smooth' })}
        >
          More ▾
        </button>
        {footer}
      </div>
    </div>
  );
}

export function ArenaPicker({ value, onChange, allowed }: { value: ArenaId; onChange: (a: ArenaId) => void; allowed?: ArenaId[] }) {
  return (
    <div className="arena-grid" role="radiogroup" aria-label="Playing field">
      {ARENA_LIST.filter((a) => !allowed || allowed.includes(a.id)).map((a) => (
        <button
          key={a.id}
          className="arena-card"
          aria-pressed={value === a.id}
          onClick={() => {
            tap();
            onChange(a.id);
          }}
        >
          <div
            className="sky"
            style={
              {
                // A swatch of the field's own hand-painted ground.
                background: `center / cover url(${groundSwatch(a.id)}), ${a.groundColor}`,
                '--ringc': a.ring.color,
                '--glow': 0,
                '--groundc': a.groundColor,
              } as CSSProperties
            }
          />
          <div className="meta">
            <b>{a.name}</b>
            <span>{a.surfaceLabel}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export interface MapChoice {
  arena: ArenaId;
  difficulty: Difficulty;
  seed: number;
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Words for what is on a map, by skin: [one, many]. */
const SKIN_WORDS: Record<string, [string, string]> = {
  book: ['book', 'books'], eraser: ['eraser', 'erasers'], ruler: ['ruler', 'rulers'], mug: ['mug', 'mugs'], pot: ['pencil pot', 'pencil pots'],
  coin: ['coin', 'coins'], 'coin-silver': ['coin', 'coins'], paperclip: ['paperclip', 'paperclips'], pencil: ['pencil', 'pencils'], paper: ['sheet of paper', 'sheets of paper'], coffee: ['coffee ring', 'coffee rings'],
  brick: ['brick', 'bricks'], kerbstone: ['kerbstone', 'kerbstones'], cone: ['cone', 'cones'], crack: ['crack', 'cracks'], puddle: ['puddle', 'puddles'], stone: ['stone', 'stones'], cap: ['bottle cap', 'bottle caps'],
  molehill: ['molehill', 'molehills'], mud: ['mud patch', 'mud patches'], twig: ['twig', 'twigs'], rock: ['rock', 'rocks'], log: ['log', 'logs'], flowerpot: ['flowerpot', 'flowerpots'],
  wetsand: ['patch of wet sand', 'patches of wet sand'], shell: ['shell', 'shells'], pebble: ['pebble', 'pebbles'], driftwood: ['piece of driftwood', 'driftwood'], sandcastle: ['sandcastle', 'sandcastles'],
  icecrack: ['crack', 'cracks'], blackice: ['patch of black ice', 'black ice'], snow: ['snow drift', 'snow drifts'], iceblock: ['ice block', 'ice blocks'], slab: ['slab', 'slabs'],
  rail: ['rail', 'rails'], railpost: ['post', 'posts'], bumper: ['bumper', 'bumpers'], cup: ['cup', 'cups'], pad: ['speed pad', 'speed pads'],
};

/** What a map holds, in a few words: "3 books · 4 pencils · 2 coffee rings". */
function mapSummary(map: MapDef): string {
  const counts = new Map<string, number>();
  for (const p of map.pieces) {
    const w = SKIN_WORDS[p.skin ?? p.kind];
    if (w) counts.set(w[1], (counts.get(w[1]) ?? 0) + 1);
  }
  const words = Object.values(SKIN_WORDS);
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([many, n]) => (n > 12 ? `lots of ${many}` : `${n} ${n === 1 ? words.find((w) => w[1] === many)![0] : many}`));
  return parts.length ? parts.join(' · ') : 'An open ring';
}

/** Plan colours for patches, by skin. */
const PATCH_FILL: Record<string, string> = { paper: '#fbfaf5', coffee: '#6e3e1c', puddle: '#2b5f8f', mud: '#5b3f26', wetsand: '#9c8763', blackice: '#14222f', snow: '#f6f9fc', pad: '#ffd23f' };

/** A top-down plan of a map, drawn from its pieces. */
export function MapPreview({ map, size = 180 }: { map: MapDef; size?: number }) {
  const a = ARENAS[map.arena];
  const B = WORLD.boundaryRadius + 0.6;
  const cross: [number, number][] = [[0, 0]];
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k <= 3; k++) cross.push([x * 0.5 * k, z * 0.5 * k]);
  return (
    <svg className="map-preview" viewBox={`${-B} ${-B} ${B * 2} ${B * 2}`} width={size} height={size} aria-hidden>
      <circle r={B} fill={a.groundColor} />
      <circle r={WORLD.boundaryRadius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={0.35} />
      <circle r={WORLD.ringRadius} fill="none" stroke={a.ring.color} strokeWidth={0.14} strokeDasharray={a.ring.style === 'string' ? undefined : '0.5 0.25'} />
      {map.pieces.map((p, i) => {
        switch (p.kind) {
          case 'zone':
            return <circle key={i} cx={p.x} cy={p.z} r={p.r} fill={PATCH_FILL[p.skin ?? ''] ?? (p.effect === 'sticky' ? '#5b3f26' : p.effect === 'slick' ? '#2b5f8f' : '#ffd23f')} opacity={0.8} />;
          case 'ridge':
            return <line key={i} x1={p.x1} y1={p.z1} x2={p.x2} y2={p.z2} stroke={p.skin === 'icecrack' ? '#ffffff' : p.skin === 'pencil' ? '#ffcc33' : p.skin === 'paperclip' ? '#c8ccd2' : p.skin === 'twig' ? '#7a5638' : '#1a1410'} strokeWidth={Math.max(0.09, p.r * 1.6)} strokeLinecap="round" />;
          case 'bump':
            return <circle key={i} cx={p.x} cy={p.z} r={Math.max(0.09, p.r * (p.sink > 0.9 ? 0.4 : 0.9))} fill={p.skin === 'coin' ? '#d9ae3f' : p.skin === 'molehill' ? '#5a3e28' : p.skin === 'shell' ? '#f0cdbb' : '#cfc7b8'} />;
          case 'hole':
            return <circle key={i} cx={p.x} cy={p.z} r={p.r} fill="#07060a" stroke="#fff" strokeWidth={0.07} />;
          case 'post':
            return <circle key={i} cx={p.x} cy={p.z} r={p.r} fill={p.skin === 'cone' ? '#ff6a1a' : p.skin === 'rock' ? '#7c776f' : p.skin === 'sandcastle' ? '#d8c39b' : '#f4efe4'} />;
          case 'bumper':
            return <circle key={i} cx={p.x} cy={p.z} r={p.r} fill="#ffd23f" stroke="#ff3d55" strokeWidth={0.12} />;
          case 'wall':
            return (
              <rect
                key={i}
                x={-p.len / 2}
                y={-p.thick / 2}
                width={p.len}
                height={p.thick}
                rx={0.05}
                fill="#f4efe4"
                transform={`translate(${p.x} ${p.z}) rotate(${(p.a * 180) / Math.PI})`}
              />
            );
        }
        return null;
      })}
      {cross.map(([x, z], i) => (
        <circle key={`m${i}`} cx={x} cy={z} r={0.17} fill="#9fe8ff" />
      ))}
    </svg>
  );
}

/** Field, difficulty and a generated map to go with them (shuffle for another). */
export function MapPicker({ value, onChange }: { value: MapChoice; onChange: (v: MapChoice) => void }) {
  const map = useMemo(() => generateMap(value), [value]);
  return (
    <div className="map-picker">
      <ArenaPicker value={value.arena} onChange={(arena) => onChange({ ...value, arena })} />
      <div className="map-card">
        <MapPreview map={map} />
        <div className="map-meta">
          <div className="chips" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className={`chip diff-${d}`}
                aria-pressed={value.difficulty === d}
                onClick={() => {
                  tap();
                  onChange({ ...value, difficulty: d });
                }}
              >
                {DIFF_LABEL[d]}
              </button>
            ))}
          </div>
          <b className="map-name">{map.name}</b>
          <span className="map-sum">{mapSummary(map)}</span>
          <button
            className="btn small"
            onClick={() => {
              tap();
              onChange({ ...value, seed: randomSeed() });
            }}
          >
            ⟳ Shuffle map
          </button>
        </div>
      </div>
    </div>
  );
}

export function MarblePicker({ value, onChange, options, locked = [] }: { value: string; onChange: (m: string) => void; options: string[]; locked?: string[] }) {
  return (
    <div className="marble-grid" role="radiogroup" aria-label="Shooter marble">
      {options.map((id) => (
        <button
          key={id}
          className="marble-pick"
          aria-pressed={value === id}
          disabled={locked.includes(id)}
          onClick={() => {
            tap();
            onChange(id);
          }}
        >
          <MarbleChip id={id} size={44} />
          {lookFor(id).name}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          className="chip"
          aria-pressed={value === o.id}
          onClick={() => {
            tap();
            onChange(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A live 3D close-up of one marble (drag to spin). Falls back to the flat swatch on
 * "Battery saver" graphics to keep extra WebGL contexts off low-end phones.
 */
export function Marble3D({ id, size = 120, accent, style }: { id: string; size?: number; accent?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useRef<MarblePreview | null>(null);
  const quality = settings.use((s) => s.quality);
  const look = lookFor(id);
  // A phenomenon is the point of its marble: its close-up is live even on low quality.
  const live = quality !== 'low' || (!!look.effect && look.effect !== 'none');

  useEffect(() => {
    if (!live || !ref.current) return;
    preview.current = new MarblePreview(ref.current, look, accent ?? look.accent, quality === 'high' ? 'high' : 'low');
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, accent, live]);

  useEffect(() => {
    preview.current?.setLook(look);
  }, [look]);

  if (!live) return <MarbleChip id={id} size={size * 0.7} style={style} />;
  // The preview canvas is opaque (glass must refract something); feather it into the panel.
  const feather = 'radial-gradient(circle at 50% 46%, #000 50%, transparent 70%)';
  return (
    <canvas
      ref={ref}
      aria-label={`${look.name} marble`}
      style={{ width: size, height: size, flex: 'none', maskImage: feather, WebkitMaskImage: feather, ...style }}
    />
  );
}

/**
 * A modal sheet: slides up from the bottom on a phone, a centred card on a big screen. Back
 * (button, gesture, Esc), the scrim and the handle all close it.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useBack(true, onClose);
  // On the body: a blurred panel would otherwise trap a fixed child inside itself.
  return createPortal(
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <button className="grab" aria-label="Close" onClick={onClose} />
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn icon ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Are you sure? The safe choice is the big one; back means no. */
export function Confirm({ title, text, yes, danger, onYes, onNo }: { title: string; text?: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet
      title={title}
      onClose={onNo}
      footer={
        <>
          <button
            className="btn primary"
            onClick={() => {
              tap();
              onNo();
            }}
          >
            Cancel
          </button>
          <button
            className={danger ? 'btn danger' : 'btn'}
            onClick={() => {
              tap();
              onYes();
            }}
          >
            {yes}
          </button>
        </>
      }
    >
      {text && <p className="lede">{text}</p>}
    </Sheet>
  );
}

/** One line of a setup screen: what is chosen, and a tap to change it in a sheet. */
export function PickRow({ label, value, icon, onClick }: { label: string; value: ReactNode; icon?: ReactNode; onClick: () => void }) {
  return (
    <button
      className="pick-row"
      onClick={() => {
        tap();
        onClick();
      }}
    >
      {icon && <span className="pick-icon">{icon}</span>}
      <span className="pick-text">
        <small>{label}</small>
        <b>{value}</b>
      </span>
      <span className="chev" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** The map choice in a few words: "Cul-de-sac · Medium · Kerbside Run". */
export function mapLabel(v: MapChoice): string {
  return `${ARENAS[v.arena].name} · ${DIFF_LABEL[v.difficulty]}`;
}
