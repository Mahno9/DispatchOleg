// ---------------------------------------------------------------------------
// createScanner: camera → throttled decode loop that reads both normal and
// inverted QR codes. Native BarcodeDetector is only a fast path for normal
// codes — Safari does not have it and no native engine reads our inverted
// prints, so the jsQR pipeline (qrPipeline.ts) always stays behind it. Pixel
// work runs in a Web Worker (qrScanWorker.ts) when the browser allows it,
// inline otherwise. Framework-agnostic: callers pass a <video> plus callbacks;
// the app-level wrapper lives in QrScanner.ts (docs/qr-flow.md §3).
// ---------------------------------------------------------------------------

import type { ScanVariants, VariantId } from './qrPipeline';
import type { WorkerRequest, WorkerResponse } from './qrScanWorker';

/** ~10 decode attempts per second; decoding every rAF tick is wasted CPU. */
const DEFAULT_INTERVAL_MS = 100;

export interface ScanResult {
  text: string;
  /** Pipeline variant (or 'native') that produced the decode — for debugging and UI hints. */
  variant: VariantId | 'native';
  /** Time this attempt took, ms. */
  ms: number;
}

export interface ScanError {
  /** DOMException name (NotAllowedError, NotFoundError, …) or a scanner-specific name. */
  name: string;
  message: string;
}

export interface ScannerOptions {
  video: HTMLVideoElement;
  onResult: (result: ScanResult) => void;
  onError?: (error: ScanError) => void;
  /** 'auto' (default) tries everything cheap-first; 'normal'/'inverted' force one polarity. */
  variants?: ScanVariants;
  /** Concrete camera; otherwise the environment-facing one is preferred. */
  deviceId?: string;
  /**
   * External stream provider (e.g. the app-wide camera.ts singleton). When
   * given, the scanner never stops the tracks — it only owns the decode loop.
   */
  getStream?: () => Promise<MediaStream>;
  intervalMs?: number;
}

export interface Scanner {
  start(): Promise<void>;
  stop(): void;
  /** Re-opens the scanner-owned stream on another camera (see listCameras). */
  setCamera(deviceId: string): Promise<void>;
  /** Resolves false when the track has no torch; printed codes in bad light need it. */
  setTorch(on: boolean): Promise<boolean>;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
}

/** Cameras for a switcher UI — on laptops the front camera is often the default. */
export async function listCameras(): Promise<CameraInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Камера ${i + 1}` }));
}

// --- BarcodeDetector fast path ---------------------------------------------

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function nativeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

// --- helpers ----------------------------------------------------------------

function buildConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
  };
}

function toScanError(err: unknown): ScanError {
  if (err instanceof DOMException) return { name: err.name, message: err.message };
  if (err instanceof Error) return { name: err.name || 'Error', message: err.message };
  return { name: 'UnknownError', message: String(err) };
}

type Backend = 'bitmap' | 'rgba' | 'inline';

function createDecodeWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./qrScanWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export function createScanner(options: ScannerOptions): Scanner {
  const video = options.video;
  const variants = options.variants ?? 'auto';
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let stopped = true;
  let stream: MediaStream | null = null;
  let ownsStream = false;
  let rafId = 0;
  let busy = false;
  let lastAttemptAt = 0;
  let preferredVariant: VariantId | null = null;
  let detector: BarcodeDetectorLike | null = null;

  let worker: Worker | null = null;
  let backend: Backend = 'inline';
  let nextRequestId = 1;
  const pending = new Map<number, (res: WorkerResponse | null) => void>();

  // Reused capture canvas for the 'rgba' and 'inline' backends.
  let captureCanvas: HTMLCanvasElement | null = null;
  let captureCtx: CanvasRenderingContext2D | null = null;

  function emitError(err: unknown): void {
    options.onError?.(toScanError(err));
  }

  function dropToInline(): void {
    worker?.terminate();
    worker = null;
    backend = 'inline';
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  }

  function setupBackend(): void {
    worker = createDecodeWorker();
    if (worker) {
      backend =
        typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
          ? 'bitmap'
          : 'rgba';
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resolve = pending.get(e.data.id);
        pending.delete(e.data.id);
        resolve?.(e.data);
      };
      // A worker that failed to load (CSP, bundling) must not stall the loop forever.
      worker.onerror = () => dropToInline();
    } else {
      backend = 'inline';
    }
  }

  function postToWorker(req: WorkerRequest, transfer: Transferable[]): Promise<WorkerResponse | null> {
    return new Promise((resolve) => {
      if (!worker) {
        resolve(null);
        return;
      }
      pending.set(req.id, resolve);
      worker.postMessage(req, transfer);
    });
  }

  function captureFrame(): ImageData | null {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    if (!captureCanvas) {
      captureCanvas = document.createElement('canvas');
      captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!captureCtx) return null;
    // The pipeline downscales to MAX_SIDE anyway; capturing at half resolution
    // already saves the expensive getImageData readback.
    const scale = Math.min(1, 640 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    if (captureCanvas.width !== cw || captureCanvas.height !== ch) {
      captureCanvas.width = cw;
      captureCanvas.height = ch;
    }
    captureCtx.drawImage(video, 0, 0, cw, ch);
    return captureCtx.getImageData(0, 0, cw, ch);
  }

  async function decodeFrame(): Promise<WorkerResponse | null> {
    const id = nextRequestId++;
    if (backend === 'bitmap') {
      if (!video.videoWidth) return null;
      const bitmap = await createImageBitmap(video);
      return postToWorker({ id, variants, preferred: preferredVariant, bitmap }, [bitmap]);
    }
    const image = captureFrame();
    if (!image) return null;
    if (backend === 'rgba') {
      return postToWorker(
        {
          id,
          variants,
          preferred: preferredVariant,
          rgba: image.data.buffer,
          width: image.width,
          height: image.height,
        },
        [image.data.buffer],
      );
    }
    const { decodeFromImageData } = await import('./qrPipeline');
    const started = performance.now();
    const hit = decodeFromImageData(image, { variants, preferredVariant });
    return { id, hit, ms: performance.now() - started };
  }

  async function attempt(): Promise<void> {
    const started = performance.now();
    if (detector && video.videoWidth) {
      try {
        const codes = await detector.detect(video);
        const text = codes[0]?.rawValue;
        if (text) {
          options.onResult({ text, variant: 'native', ms: performance.now() - started });
          return;
        }
      } catch {
        // A native detector hiccup on one frame is not worth reporting.
      }
    }
    const res = await decodeFrame();
    if (res?.hit) {
      preferredVariant = res.hit.variant;
      options.onResult({
        text: res.hit.text,
        variant: res.hit.variant,
        ms: performance.now() - started,
      });
    }
  }

  function tick(): void {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);
    const now = Date.now();
    if (busy || now - lastAttemptAt < intervalMs) return;
    lastAttemptAt = now;
    busy = true;
    attempt()
      .catch(() => {
        // One bad frame (transfer race, detached buffer) must not kill the loop.
      })
      .finally(() => {
        busy = false;
      });
  }

  function releaseStream(): void {
    if (stream && ownsStream) {
      for (const track of stream.getTracks()) track.stop();
    }
    stream = null;
  }

  async function attach(nextStream: MediaStream): Promise<void> {
    stream = nextStream;
    // iOS Safari: without playsinline+muted the video goes fullscreen on play().
    video.playsInline = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.srcObject = nextStream;
    await video.play().catch(() => {});
  }

  return {
    async start() {
      if (!stopped) return;
      stopped = false;
      let acquired: MediaStream;
      try {
        if (options.getStream) {
          acquired = await options.getStream();
          ownsStream = false;
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new DOMException('camera API is unavailable', 'NotSupportedError');
          }
          acquired = await navigator.mediaDevices.getUserMedia(buildConstraints(options.deviceId));
          ownsStream = true;
        }
      } catch (err) {
        stopped = true;
        emitError(err);
        return;
      }
      if (stopped) {
        // stop() raced the permission prompt.
        if (ownsStream) for (const track of acquired.getTracks()) track.stop();
        return;
      }
      await attach(acquired);
      detector = nativeDetector();
      setupBackend();
      rafId = requestAnimationFrame(tick);
    },

    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      worker?.terminate();
      worker = null;
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
      releaseStream();
      video.srcObject = null;
    },

    async setCamera(deviceId: string) {
      if (options.getStream) {
        emitError(new DOMException('the stream is owned by the app', 'InvalidStateError'));
        return;
      }
      if (stopped) return;
      try {
        const next = await navigator.mediaDevices.getUserMedia(buildConstraints(deviceId));
        releaseStream();
        ownsStream = true;
        await attach(next);
      } catch (err) {
        emitError(err);
      }
    },

    async setTorch(on: boolean) {
      const track = stream?.getVideoTracks()[0];
      if (!track) return false;
      const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      if (!caps?.torch) return false;
      try {
        await track.applyConstraints({
          advanced: [{ torch: on } as MediaTrackConstraintSet],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
