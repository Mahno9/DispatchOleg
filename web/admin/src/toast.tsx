import { useSyncExternalStore } from 'react';

// ponytail: minimal toast — module-level pub/sub + one host. Swap for a lib if
// we ever need queueing/variants/positions.

export type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showToast(message: string, kind: ToastKind = 'success') {
  const id = ++seq;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2500);
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
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
