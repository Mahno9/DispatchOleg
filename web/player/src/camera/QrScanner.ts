// ---------------------------------------------------------------------------
// App-level QR decode loop shared by onboarding and the qr-scan screen: a thin
// wrapper over createScanner (scanner.ts) that plugs in the shared camera
// stream and dedupes repeated decodes. Part of the printed codes is inverted
// (light modules on dark teal, no quiet zone) — the underlying pipeline reads
// both polarities (docs/qr-flow.md §3.2).
// The camera stream comes from camera.ts and is never stopped here: the bottom
// bar keeps showing it after the scanner is gone (docs/qr-flow.md §3.3).
// ---------------------------------------------------------------------------

import { getStream } from './camera';
import { createScanner } from './scanner';

/** Same code is re-sent for verification only after this long (docs/qr-flow.md §5.1). */
const DEDUPE_MS = 2000;

/** Cheap local filter: foreign QRs (business cards, packaging) never reach the server. */
export function isDispatchCode(text: string): boolean {
  return text.trim().startsWith('dispatch:');
}

export interface ScanHandle {
  /** Stops the decode loop. The camera track keeps running. */
  stop: () => void;
}

/**
 * Attaches the shared camera stream to `video` and calls `onDecode` with the raw
 * QR text (format/signature checks belong to the server). `onError` fires with a
 * DOMException-ish name when the stream or the decoder cannot be obtained.
 */
export function startScan(
  video: HTMLVideoElement,
  onDecode: (text: string) => void,
  onError?: (name: string) => void,
): ScanHandle {
  let lastText = '';
  let lastAt = 0;

  const scanner = createScanner({
    video,
    getStream,
    onResult: ({ text }) => {
      const now = Date.now();
      if (text === lastText && now - lastAt < DEDUPE_MS) return;
      lastText = text;
      lastAt = now;
      onDecode(text);
    },
    onError: (err) => onError?.(err.name),
  });
  void scanner.start();

  return {
    stop() {
      scanner.stop();
    },
  };
}
