// ---------------------------------------------------------------------------
// QR decoding loop shared by onboarding and the qr-scan screen.
// Native BarcodeDetector when available (Chromium), jsQR via dynamic import()
// otherwise — the fallback stays out of the main chunk.
// The camera stream comes from camera.ts and is never stopped here: the bottom
// bar keeps showing it after the scanner is gone (docs/qr-flow.md §3.3).
// ---------------------------------------------------------------------------

import { getStream } from './camera';

/** How often a frame is actually decoded — decoding every rAF tick is wasted CPU. */
const THROTTLE_MS = 200;
/** Same code is re-sent for verification only after this long (docs/qr-flow.md §5.1). */
const DEDUPE_MS = 2000;

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** Decodes one video frame, or null when no code is in view. */
type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

function nativeDecoder(): FrameDecoder | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  const detector = new ctor({ formats: ['qr_code'] });
  return async (video) => {
    const codes = await detector.detect(video);
    return codes[0]?.rawValue ?? null;
  };
}

async function jsqrDecoder(): Promise<FrameDecoder> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    return jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

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
  let stopped = false;
  let frame = 0;
  let lastText = '';
  let lastAt = 0;
  let lastDecodeAt = 0;
  let busy = false;

  void (async () => {
    let decode: FrameDecoder;
    try {
      const stream = await getStream();
      if (stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      decode = nativeDecoder() ?? (await jsqrDecoder());
    } catch (err) {
      if (!stopped) {
        onError?.(err instanceof DOMException ? err.name : 'DecoderUnavailable');
      }
      return;
    }
    if (stopped) return;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = Date.now();
      if (busy || now - lastDecodeAt < THROTTLE_MS) return;
      lastDecodeAt = now;
      busy = true;
      decode(video)
        .then((text) => {
          if (stopped || !text) return;
          if (text === lastText && now - lastAt < DEDUPE_MS) return;
          lastText = text;
          lastAt = now;
          onDecode(text);
        })
        .catch(() => {
          // A single bad frame (detector hiccup) is not worth killing the loop.
        })
        .finally(() => {
          busy = false;
        });
    };
    frame = requestAnimationFrame(tick);
  })();

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      video.srcObject = null;
    },
  };
}
