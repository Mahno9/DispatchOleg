// ---------------------------------------------------------------------------
// Pure QR decode pipeline: grayscale → (contrast stretch) → Otsu → both
// polarities with a synthetic quiet zone. Part of the printed codes is
// inverted — light modules on a dark teal background with no light quiet zone
// around, so finder patterns read backwards and stock decoders never even
// locate the code. jsQR's own `inversionAttempts` flips the image only after
// its built-in binarization, which is not enough on low-contrast colored
// prints — hence the explicit preprocessing here (docs/qr-flow.md §3.2).
//
// No DOM in this module: it works on plain {data,width,height} objects so the
// same code runs in the Web Worker, on the main thread and in node tests.
// ---------------------------------------------------------------------------

import jsQR from 'jsqr';

/** Structural ImageData — node tests and workers have no ImageData constructor. */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Forced polarity mode: 'auto' tries everything, cheap variants first. */
export type ScanVariants = 'auto' | 'normal' | 'inverted';

export type VariantId = 'raw' | 'raw-inverted' | 'otsu' | 'otsu-inverted' | 'stretch-inverted';

export interface DecodeHit {
  text: string;
  /** Which preprocessing variant produced the decode — surfaced to the UI/debugging. */
  variant: VariantId;
}

export interface DecodeOptions {
  variants?: ScanVariants;
  /** Last variant that worked — tried first, so a steady inverted code costs one attempt per frame. */
  preferredVariant?: VariantId | null;
}

/** Frames are downscaled to this long side: enough for version-3 codes, much cheaper. */
export const MAX_SIDE = 640;

/** Cheap→expensive order; decoding stops at the first hit. */
export const VARIANT_ORDER: readonly VariantId[] = [
  'raw',
  'raw-inverted',
  'otsu',
  'otsu-inverted',
  'stretch-inverted',
];

const NORMAL_VARIANTS: ReadonlySet<VariantId> = new Set(['raw', 'otsu']);

export function toGray(image: ImageDataLike): GrayImage {
  const { data, width, height } = image;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    // Integer luma: 0.299R + 0.587G + 0.114B.
    out[i] = (data[j]! * 299 + data[j + 1]! * 587 + data[j + 2]! * 114 + 500) / 1000;
  }
  return { data: out, width, height };
}

/** Nearest-neighbour downscale; a no-op when the image already fits. */
export function downscale(img: GrayImage, maxSide = MAX_SIDE): GrayImage {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return img;
  const scale = long / maxSide;
  const width = Math.max(1, Math.round(img.width / scale));
  const height = Math.max(1, Math.round(img.height / scale));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * scale));
      out[y * width + x] = img.data[sy * img.width + sx]!;
    }
  }
  return { data: out, width, height };
}

function percentileValue(hist: Uint32Array, total: number, pct: number): number {
  const target = (total * pct) / 100;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Linear stretch between the 2nd and 98th percentiles: clips print glare and
 * shadows that squeeze the real module/background contrast into a narrow band.
 */
export function stretchContrast(img: GrayImage, lowPct = 2, highPct = 98): GrayImage {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]!]!++;
  const lo = percentileValue(hist, img.data.length, lowPct);
  const hi = percentileValue(hist, img.data.length, highPct);
  if (hi - lo < 8) return img; // near-flat frame, stretching would only amplify noise
  const out = new Uint8Array(img.data.length);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < img.data.length; i++) {
    const v = (img.data[i]! - lo) * scale;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Otsu's global threshold over the gray histogram. */
export function otsuThreshold(data: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]!]!++;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;
  let sumB = 0;
  let wB = 0;
  let best = 127;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = data.length - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Hard 0/255 binarization; `invert` swaps polarity so light modules become dark. */
export function binarize(img: GrayImage, threshold: number, invert: boolean): GrayImage {
  const out = new Uint8Array(img.data.length);
  const dark = invert ? 255 : 0;
  const light = invert ? 0 : 255;
  for (let i = 0; i < img.data.length; i++) {
    out[i] = img.data[i]! <= threshold ? dark : light;
  }
  return { data: out, width: img.width, height: img.height };
}

/**
 * Pads the image with a white frame. Printed codes have no light quiet zone at
 * all (dark margins right up to the modules) — without this frame the locator
 * cannot find the code boundary even in the correct polarity.
 */
export function addQuietZone(img: GrayImage, margin: number): GrayImage {
  const width = img.width + margin * 2;
  const height = img.height + margin * 2;
  const out = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < img.height; y++) {
    out.set(img.data.subarray(y * img.width, (y + 1) * img.width), (y + margin) * width + margin);
  }
  return { data: out, width, height };
}

/** ≥ 4 modules of a version-3 code on a MAX_SIDE frame; 32 px at 640 px. */
function quietMargin(img: GrayImage): number {
  return Math.max(32, Math.round(Math.max(img.width, img.height) / 20));
}

export function variantOrder(mode: ScanVariants, preferred: VariantId | null): VariantId[] {
  let ids = VARIANT_ORDER.filter((id) =>
    mode === 'auto' ? true : mode === 'normal' ? NORMAL_VARIANTS.has(id) : !NORMAL_VARIANTS.has(id),
  );
  if (preferred && ids.includes(preferred)) {
    ids = [preferred, ...ids.filter((id) => id !== preferred)];
  }
  return ids;
}

// Reused RGBA scratch buffers: the pipeline runs up to 5 variants per frame at
// ~10 fps, allocating a fresh 1–2 MB buffer per variant would churn GC on long
// sessions. 'raw' (frame-sized) is separate from 'bin' (frame + quiet zone) so
// the buffers stay at their own stable sizes.
const rgbaScratch = new Map<string, Uint8ClampedArray>();

function grayToRgba(img: GrayImage, key: 'raw' | 'bin'): ImageDataLike {
  const need = img.width * img.height * 4;
  let buf = rgbaScratch.get(key);
  if (!buf || buf.length < need) {
    buf = new Uint8ClampedArray(need);
    rgbaScratch.set(key, buf);
  }
  for (let i = 0, j = 0; i < img.data.length; i++, j += 4) {
    const v = img.data[i]!;
    buf[j] = v;
    buf[j + 1] = v;
    buf[j + 2] = v;
    buf[j + 3] = 255;
  }
  // jsQR insists on data.length === width*height*4 — hand out an exact view.
  const data = buf.length === need ? buf : buf.subarray(0, need);
  return { data, width: img.width, height: img.height };
}

function tryJsqr(image: ImageDataLike): string | null {
  // Always 'dontInvert': polarity is our job (jsQR's 'onlyInvert' crashes —
  // it never builds the inverted matrix it then scans), and its own inversion
  // happens after its binarization anyway, too late for low-contrast prints.
  const res = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
  return res && res.data ? res.data : null;
}

function invertGray(img: GrayImage): GrayImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) out[i] = 255 - img.data[i]!;
  return { data: out, width: img.width, height: img.height };
}

/**
 * Runs the variant pipeline over one frame. Pure and synchronous — callers
 * decide about workers and throttling. Returns the decoded text plus the
 * variant that worked, or null when no code is found.
 */
export function decodeFromImageData(image: ImageDataLike, opts: DecodeOptions = {}): DecodeHit | null {
  const gray = downscale(toGray(image));
  const margin = quietMargin(gray);

  // Intermediate results are lazy: the common case (normal code, 'raw' hit)
  // must not pay for binarization at all.
  let threshold = -1;
  const binarized = (invert: boolean): ImageDataLike => {
    if (threshold < 0) threshold = otsuThreshold(gray.data);
    return grayToRgba(addQuietZone(binarize(gray, threshold, invert), margin), 'bin');
  };

  for (const id of variantOrder(opts.variants ?? 'auto', opts.preferredVariant ?? null)) {
    let text: string | null = null;
    switch (id) {
      case 'raw':
        text = tryJsqr(grayToRgba(gray, 'raw'));
        break;
      case 'raw-inverted':
        text = tryJsqr(grayToRgba(invertGray(gray), 'raw'));
        break;
      case 'otsu':
        text = tryJsqr(binarized(false));
        break;
      case 'otsu-inverted':
        text = tryJsqr(binarized(true));
        break;
      case 'stretch-inverted': {
        const stretched = stretchContrast(gray);
        if (stretched === gray) break; // flat frame — identical to 'otsu-inverted', skip
        const t = otsuThreshold(stretched.data);
        text = tryJsqr(grayToRgba(addQuietZone(binarize(stretched, t, true), margin), 'bin'));
        break;
      }
    }
    if (text) return { text, variant: id };
  }
  return null;
}
