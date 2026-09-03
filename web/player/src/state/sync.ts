import { api, type ServerState } from '../api';
import { localState, type ClientState } from './localState';

// ---------------------------------------------------------------------------
// Connectivity store
// ---------------------------------------------------------------------------

const connectivityListeners = new Set<() => void>();

/** True when we believe we have a working server connection. */
let _isConnected: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;

function emitConnectivity(): void {
  for (const l of connectivityListeners) l();
}

/** Called after each sync attempt: ok=true → connected, ok=false → disconnected. */
export function notifySyncResult(ok: boolean): void {
  if (ok === _isConnected) return;
  _isConnected = ok;
  emitConnectivity();
}

/** Subscribe to connectivity changes (useSyncExternalStore-compatible). */
export function subscribeConnectivity(listener: () => void): () => void {
  connectivityListeners.add(listener);
  return () => connectivityListeners.delete(listener);
}

export function getConnectivitySnapshot(): boolean {
  return _isConnected;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Flip indicator optimistically; the sync result confirms or reverts it.
    if (!_isConnected) {
      _isConnected = true;
      emitConnectivity();
    }
    void syncNow();
  });

  window.addEventListener('offline', () => {
    if (_isConnected) {
      _isConnected = false;
      emitConnectivity();
    }
  });
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

/** True if a server payload is a usable ClientState we should adopt. */
function isAdoptableState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.updatedAt === 'number';
}

/**
 * Pushes the current local state to the server once. On a 'server-newer' or
 * 'merged' outcome the server's payload wins — adopt and persist it locally.
 * Network/server errors are swallowed for offline tolerance.
 */
export async function syncNow(): Promise<void> {
  const state = localState.getSnapshot();
  if (!state.profile.userId) return;
  try {
    const res = await api.postSync({ userId: state.profile.userId, state });
    notifySyncResult(true);
    if (res.outcome === 'server-newer' || res.outcome === 'merged') {
      // За время запроса игрок мог что-то поменять — например, увести ползунок
      // громкости. Ответ построен на устаревшем снимке, и принять его значило
      // бы молча откатить свежую правку вместе с её updatedAt.
      if (localState.getSnapshot() !== state) return;
      const incoming: ServerState = res.state;
      if (isAdoptableState(incoming)) localState.replace(incoming);
    }
  } catch {
    // Offline / server down — try again on the next interval.
    notifySyncResult(false);
  }
}

/**
 * Starts periodic background sync. Returns a stop function. Does not sync
 * immediately — callers fire syncNow() explicitly on session start.
 */
export function startSync(intervalSeconds: number): () => void {
  const timer = setInterval(
    () => {
      void syncNow();
    },
    Math.max(1, intervalSeconds) * 1000,
  );
  return () => clearInterval(timer);
}
