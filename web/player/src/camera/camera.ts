// ---------------------------------------------------------------------------
// Single webcam stream for the whole app: the camera panel and the QR scanner
// share it, so the player is prompted for permission exactly once per session.
// The stream outlives screen switches — only releaseStream() tears it down.
// ---------------------------------------------------------------------------

export type CameraState =
  | { status: 'off' }
  | { status: 'requesting' }
  | { status: 'live'; stream: MediaStream }
  /** `error.name` is a DOMException name (NotAllowedError, NotFoundError, …) or 'SignalLost'. */
  | { status: 'error'; error: string };

let state: CameraState = { status: 'off' };
let pending: Promise<MediaStream> | null = null;
const listeners = new Set<() => void>();

function setState(next: CameraState): void {
  state = next;
  for (const l of listeners) l();
}

/** useSyncExternalStore contract. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): CameraState {
  return state;
}

function watchForLoss(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      // Device unplugged / taken by another app — surface it, drop the cache.
      if (state.status === 'live' && state.stream === stream) {
        for (const t of stream.getTracks()) t.stop();
        setState({ status: 'error', error: 'SignalLost' });
      }
    });
  }
}

/**
 * Returns the shared stream, starting it on first call. Concurrent callers
 * share one getUserMedia prompt. Must be called from a user gesture the first
 * time so browsers don't auto-deny.
 */
export async function getStream(): Promise<MediaStream> {
  if (state.status === 'live') return state.stream;
  if (pending) return pending;

  setState({ status: 'requesting' });
  pending = navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'user' }, audio: false })
    .then((stream) => {
      watchForLoss(stream);
      setState({ status: 'live', stream });
      return stream;
    })
    .catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : 'UnknownError';
      setState({ status: 'error', error: name });
      throw err;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** Stops the stream and resets to 'off'. Next getStream() starts a fresh one. */
export function releaseStream(): void {
  if (state.status === 'live') {
    for (const track of state.stream.getTracks()) track.stop();
  }
  setState({ status: 'off' });
}
