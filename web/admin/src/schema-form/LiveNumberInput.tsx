import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// LiveNumberInput — a number field that does NOT validate while you type:
// you can clear it completely, leave partial values like "0.000", etc. It only
// commits on blur (Enter blurs too). If the buffer isn't a valid number, it
// reverts to the previous value. This lets you retype from scratch and edit the
// significant digits of very small numbers without auto-coercion mid-edit.
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

function display(value: number | undefined, fallback: number | undefined): string {
  const v = value !== undefined ? value : fallback;
  return v === undefined || v === null ? '' : String(v);
}

export function LiveNumberInput({ value, fallback, integer, min, max, className, onCommit }: Props) {
  const [text, setText] = useState(() => display(value, fallback));
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

  function commitValue(final: number) {
    if (final === lastCommittedRef.current) return;
    lastCommittedRef.current = final;
    onCommit(final);
  }

  function commit() {
    focusedRef.current = false;
    const final = parse(text);
    if (final === null) {
      setText(display(value, fallback)); // invalid → revert
      return;
    }
    commitValue(final);
    setText(String(final));
  }

  return (
    <input
      type='text'
      inputMode={integer ? 'numeric' : 'decimal'}
      className={className}
      value={text}
      min={min}
      max={max}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const final = parse(next);
        if (final !== null) commitValue(final);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
