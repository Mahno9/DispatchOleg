// ---------------------------------------------------------------------------
// Renders QR matrices into raw RGBA buffers for qrPipeline tests: the node
// test environment has no canvas, so images are built by hand. The matrix
// comes from the same `qrcode` library the server uses for printing.
// ---------------------------------------------------------------------------

import QRCode from 'qrcode';
import type { ImageDataLike } from '../qrPipeline';

/** Matches the printed payload format dispatch:<gameId>:<hmac>. */
export const FIXTURE_TEXT = 'dispatch:1:5e2f18f6a8b2a6d8';

export type Rgb = [number, number, number];

export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [255, 255, 255];
/** The real print colors: light modules on a dark teal background. */
export const TEAL_DARK: Rgb = [10, 52, 53];
export const TEAL_LIGHT: Rgb = [93, 226, 208];

export interface RenderOptions {
  /** Pixels per module. */
  scale?: number;
  /** Quiet zone width in modules; printed codes have none, so the default is 0. */
  quietModules?: number;
  /** Color of the modules (matrix ones). */
  fg?: Rgb;
  /** Background color, also fills the quiet zone. */
  bg?: Rgb;
}

/** Version-3 (29×29) matrix for `text`; deterministic for a fixed input. */
export function qrMatrix(text: string): { size: number; data: Uint8Array } {
  const qr = QRCode.create(text, { version: 3, errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: qr.modules.data as Uint8Array };
}

export function renderQr(text: string, options: RenderOptions = {}): ImageDataLike {
  const scale = options.scale ?? 8;
  const quiet = options.quietModules ?? 0;
  const fg = options.fg ?? BLACK;
  const bg = options.bg ?? WHITE;
  const { size, data } = qrMatrix(text);
  const side = (size + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const inCode = my >= 0 && my < size && mx >= 0 && mx < size;
      const color = inCode && data[my * size + mx] ? fg : bg;
      const j = (y * side + x) * 4;
      rgba[j] = color[0];
      rgba[j + 1] = color[1];
      rgba[j + 2] = color[2];
      rgba[j + 3] = 255;
    }
  }
  return { data: rgba, width: side, height: side };
}
