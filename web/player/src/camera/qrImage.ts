// ---------------------------------------------------------------------------
// Camera-less fallback: decode a QR from an uploaded/dropped/pasted image via
// the same qrPipeline variants as the live scanner. One-shot work, so it runs
// on the main thread; the pipeline is still a dynamic import to keep jsQR out
// of the main chunk (docs/qr-flow.md §3.2).
// ---------------------------------------------------------------------------

import type { ScanVariants } from './qrPipeline';
import type { ScanError, ScanResult } from './scanner';

async function blobToImageData(blob: Blob): Promise<ImageData> {
  let source: ImageBitmap | HTMLImageElement;
  let release: () => void;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    release = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    release = () => URL.revokeObjectURL(url);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (err) {
      release();
      throw err;
    }
    source = img;
  }
  try {
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    // Photos can be 12 MP; the pipeline needs ≤640 px, but leave headroom for
    // codes that occupy a small part of the shot.
    const scale = Math.min(1, 1280 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new DOMException('2d context is unavailable', 'InvalidStateError');
    ctx.drawImage(source, 0, 0, cw, ch);
    return ctx.getImageData(0, 0, cw, ch);
  } finally {
    release();
  }
}

/** Decodes a single image (File/Blob) with the same variant pipeline as the camera path. */
export async function decodeImageBlob(
  blob: Blob,
  variants: ScanVariants = 'auto',
): Promise<ScanResult | null> {
  const image = await blobToImageData(blob);
  const { decodeFromImageData } = await import('./qrPipeline');
  const started = performance.now();
  const hit = decodeFromImageData(image, { variants });
  if (!hit) return null;
  return { text: hit.text, variant: hit.variant, ms: performance.now() - started };
}

export interface ImageInputOptions {
  onResult: (result: ScanResult) => void;
  onError?: (error: ScanError) => void;
  variants?: ScanVariants;
  /** <input type="file"> to listen on. */
  fileInput?: HTMLInputElement;
  /** Element accepting drag-and-drop of image files. */
  dropTarget?: HTMLElement;
  /** Target for clipboard paste; defaults to document when any other source is wired. */
  pasteTarget?: Document | HTMLElement;
}

export interface ImageInputHandle {
  detach(): void;
}

function firstImageFile(list: FileList | null | undefined): File | null {
  for (const file of Array.from(list ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/**
 * Wires file input, drag-and-drop and clipboard paste to decodeImageBlob.
 * 'NoQrFound' goes to onError: for the operator an unreadable photo is the
 * same kind of failure as a denied camera.
 */
export function attachImageInput(options: ImageInputOptions): ImageInputHandle {
  const variants = options.variants ?? 'auto';

  const handleBlob = (blob: Blob | null): void => {
    if (!blob) return;
    decodeImageBlob(blob, variants)
      .then((result) => {
        if (result) options.onResult(result);
        else options.onError?.({ name: 'NoQrFound', message: 'QR-код на изображении не найден' });
      })
      .catch((err: unknown) => {
        options.onError?.({
          name: err instanceof DOMException ? err.name : 'DecodeError',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const onChange = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    handleBlob(firstImageFile(input.files));
    input.value = ''; // allow re-selecting the same file
  };
  const onDragOver = (e: DragEvent): void => e.preventDefault();
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    handleBlob(firstImageFile(e.dataTransfer?.files));
  };
  const onPaste = (e: Event): void => {
    const items = (e as ClipboardEvent).clipboardData?.items;
    for (const item of Array.from(items ?? [])) {
      if (item.type.startsWith('image/')) {
        handleBlob(item.getAsFile());
        return;
      }
    }
  };

  const pasteTarget = options.pasteTarget ?? document;
  options.fileInput?.addEventListener('change', onChange);
  options.dropTarget?.addEventListener('dragover', onDragOver);
  options.dropTarget?.addEventListener('drop', onDrop);
  pasteTarget.addEventListener('paste', onPaste);

  return {
    detach() {
      options.fileInput?.removeEventListener('change', onChange);
      options.dropTarget?.removeEventListener('dragover', onDragOver);
      options.dropTarget?.removeEventListener('drop', onDrop);
      pasteTarget.removeEventListener('paste', onPaste);
    },
  };
}
