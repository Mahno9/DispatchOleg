import type { Schema } from './SchemaForm';

// ---------------------------------------------------------------------------
// OpacitySlider — a native range slider bound to a 0..1 alpha, paired with a
// schematic preview of the result screen: a stand-in "level" backdrop, the dark
// veil at the current alpha, and a bottom-anchored "Победа!" card. Shows both
// what the slider does (veil transparency) and the new bottom placement.
// ---------------------------------------------------------------------------

interface Props {
  schema: Schema;
  value: unknown;
  onChange: (n: number) => void;
}

export function OpacitySlider({ schema, value, onChange }: Props) {
  const min = schema.minimum ?? 0;
  const max = schema.maximum ?? 1;
  const def = typeof schema.default === 'number' ? schema.default : max;
  const v = typeof value === 'number' ? value : def; // ?? default, so 0 is honored

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160, flex: 1 }}>
        <input
          type='range'
          min={min}
          max={max}
          step={0.01}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        <span style={{ fontSize: 12, color: '#9aa0c0' }}>Непрозрачность: {Math.round(v * 100)}%</span>
      </div>

      {/* schematic preview: level backdrop → veil(alpha) → bottom result card */}
      <div style={{
        position: 'relative', width: 180, height: 120, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden', border: '1px solid #3a3a6a',
        background: 'linear-gradient(135deg, #2b6cb0 0%, #6b46c1 55%, #d53f8c 100%)',
      }}>
        {/* fake level blocks so transparency is legible against detail, not flat color */}
        <div style={{ position: 'absolute', top: 12, left: 16, right: 16, height: 34, display: 'flex', gap: 4 }}>
          {['#f6ad55', '#68d391', '#63b3ed', '#f687b3', '#fc8181'].map((c, i) => (
            <div key={i} style={{ flex: 1, background: c, borderRadius: 2, opacity: 0.9 }} />
          ))}
        </div>
        <div style={{ position: 'absolute', inset: 0, background: `rgba(8, 8, 24, ${v})` }} />
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 8, display: 'flex',
          flexDirection: 'column', alignItems: 'center', gap: 3,
          textShadow: '0 1px 4px rgba(0,0,0,0.85)', pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#a0c4ff' }}>Победа!</span>
          <span style={{ fontSize: 10, color: '#d0d0e8' }}>Счёт: 1234</span>
          <span style={{ fontSize: 9, color: '#fff', background: '#3a3a6a', borderRadius: 3, padding: '2px 8px' }}>Завершить</span>
        </div>
      </div>
    </div>
  );
}
