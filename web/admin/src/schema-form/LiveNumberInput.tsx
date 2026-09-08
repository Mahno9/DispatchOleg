import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// LiveNumberInput — a number field that does NOT validate while you type:
// you can clear it completely, leave partial values like "0.000", etc. It only
// commits on blur (Enter blurs too). If the buffer isn't a valid number, it
// reverts to the previous value. This lets you retype from scratch and edit the
// significant digits of very small numbers without auto-coercion mid-edit.
//
// Range: the input is type='text', so the browser enforces nothing — min/max
// from the schema are applied here, on commit. Out-of-range values used to be
// stored as typed and only got fixed by the game's own normalizeConfig, so the
// saved config disagreed with what the player actually got.
// ---------------------------------------------------------------------------

interface Props {
  value: number | undefined;
  /** shown when value is undefined (e.g. a schema default) */
  fallback?: number | undefined;
  integer?: boolean;
  min?: number | undefined;
  max?: number | undefined;
  className?: string | undefined;
  onCommit: (n: number) => void;
}

/** Pulls a number into the schema's [min, max]; either bound may be absent. */
export function clampToRange(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/** Range hint for the title tooltip, e.g. "от 1 до 10" / "не меньше 0.1". */
export function rangeHint(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `от ${min} до ${max}`;
  if (min !== undefined) return `не меньше ${min}`;
  if (max !== undefined) return `не больше ${max}`;
  return '';
}

function display(value: number | undefined, fallback: number | undefined): string {
  const v = value !== undefined ? value : fallback;
  return v === undefined || v === null ? '' : String(v);
}

export function LiveNumberInput({ value, fallback, integer, min, max, className, onCommit }: Props) {
  const [text, setText] = useState(() => display(value, fallback));
  /** Last commit hit a bound — the field stays highlighted until the next edit. */
  const [clamped, setClamped] = useState(false);
  const focusedRef = useRef(false);
  const lastCommittedRef = useRef<number | undefined>(value);

  // Sync from the outside only while not being edited.
  useEffect(() => {
    lastCommittedRef.current = value;
    if (!focusedRef.current) setText(display(value, fallback));
  }, [value, fallback]);

  function parse(raw: string): number | null {
    const t = raw.trim();
    const n = Number(t);
    if (t === '' || !Number.isFinite(n)) return null;
    return integer ? Math.trunc(n) : n;
  }

  function commitValue(parsed: number) {
    const final = clampToRange(parsed, min, max);
    if (final === lastCommittedRef.current) return;
    lastCommittedRef.current = final;
    onCommit(final);
  }

  function commit() {
    focusedRef.current = false;
    const parsed = parse(text);
    if (parsed === null) {
      setText(display(value, fallback)); // invalid → revert
      return;
    }
    const final = clampToRange(parsed, min, max);
    setClamped(final !== parsed);
    commitValue(parsed);
    setText(String(final));
  }

  const hint = rangeHint(min, max);
  return (
    <input
      type='text'
      inputMode={integer ? 'numeric' : 'decimal'}
      className={clamped ? `${className ?? ''} sf-num--clamped`.trim() : className}
      value={text}
      title={
        clamped
          ? `Значение приведено к допустимому диапазону: ${hint}`
          : hint === ''
            ? undefined
            : `Допустимо ${hint}`
      }
      onFocus={() => {
        focusedRef.current = true;
        setClamped(false);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parse(next);
        if (parsed !== null) commitValue(parsed);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
