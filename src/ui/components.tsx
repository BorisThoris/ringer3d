import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ARENA_LIST, type ArenaId } from '../game/arenas';
import { MARBLES, type MarbleLook } from '../game/marbles';
import { sound } from '../render/audio';
import { MarblePreview } from '../render/preview';
import { settings } from '../game/settings';

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
  const look = MARBLES[id] ?? MARBLES.ember;
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
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className={`sheet screen${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
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
                background: `linear-gradient(180deg, ${a.sky.top}, ${a.sky.bottom})`,
                '--ringc': a.ring.color,
                '--glow': a.ring.glow,
                '--groundc': a.ground.base,
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
          {MARBLES[id]?.name ?? id}
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
  const look = MARBLES[id] ?? MARBLES.ember;

  useEffect(() => {
    if (quality === 'low' || !ref.current) return;
    preview.current = new MarblePreview(ref.current, look, accent ?? look.accent, quality === 'high' ? 'high' : 'low');
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, accent]);

  useEffect(() => {
    preview.current?.setLook(look);
  }, [look]);

  if (quality === 'low') return <MarbleChip id={id} size={size * 0.7} style={style} />;
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
