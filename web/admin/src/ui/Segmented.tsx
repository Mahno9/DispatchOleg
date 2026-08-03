import { useId } from 'react';

// Radio-group styled as a segmented control. Real <input type="radio"> inside a
// <label> → keyboard/AT support comes from the platform, not from JS.

export interface SegmentedProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  /** Radio group name; auto-generated when omitted. */
  name?: string;
}

export function Segmented({ options, value, onChange, name }: SegmentedProps) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <div className='segmented'>
      {options.map((o) => (
        <label
          key={o.value}
          className={`segmented-opt${o.value === value ? ' segmented-opt--active' : ''}`}
        >
          <input
            type='radio'
            name={group}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
