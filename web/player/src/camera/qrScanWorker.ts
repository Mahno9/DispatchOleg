// ---------------------------------------------------------------------------
// Web Worker around qrPipeline: on weak Android phones the full pixel pipeline
// on the main thread drops the preview fps, so scanner.ts ships frames here.
// Two input forms: a transferred ImageBitmap (drawn into a reused
// OffscreenCanvas at ≤ MAX_SIDE) or an already-captured RGBA buffer for
// browsers where OffscreenCanvas 2d is unavailable inside workers.
// ---------------------------------------------------------------------------

import {
  decodeFromImageData,
  MAX_SIDE,
  type DecodeHit,
  type ImageDataLike,
  type ScanVariants,
  type VariantId,
} from './qrPipeline';

export interface WorkerRequest {
  id: number;
  variants: ScanVariants;
  preferred: VariantId | null;
  bitmap?: ImageBitmap;
  rgba?: ArrayBuffer;
  width?: number;
  height?: number;
}

export interface WorkerResponse {
  id: number;
  hit: DecodeHit | null;
  ms: number;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
}

// One canvas for the whole worker lifetime — a fresh canvas per frame leaks
// GPU-backed surfaces on long sessions.
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function bitmapToImageData(bitmap: ImageBitmap): ImageDataLike | null {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    if (!canvas) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return null;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const req = e.data;
  const started = performance.now();
  let image: ImageDataLike | null = null;
  if (req.bitmap) {
    image = bitmapToImageData(req.bitmap);
  } else if (req.rgba && req.width && req.height) {
    image = { data: new Uint8ClampedArray(req.rgba), width: req.width, height: req.height };
  }
  const hit = image
    ? decodeFromImageData(image, { variants: req.variants, preferredVariant: req.preferred })
    : null;
  scope.postMessage({ id: req.id, hit, ms: performance.now() - started });
};
