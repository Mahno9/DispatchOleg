import { useSyncExternalStore } from 'react';

// ponytail: minimal toast — module-level pub/sub + one host. Swap for a lib if
// we ever need queueing/variants/positions.

export type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Errors carry a server message worth reading, so they linger; success is a blink. */
const TTL_MS: Record<ToastKind, number> = { success: 2500, error: 10000 };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(message: string, kind: ToastKind = 'success') {
  const id = ++seq;
  toasts = [...toasts, { id, message, kind }];
  emit();
  timers.set(
    id,
    setTimeout(() => dismiss(id), TTL_MS[kind]),
  );
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div className='toast-host'>
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          title='Закрыть'
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
