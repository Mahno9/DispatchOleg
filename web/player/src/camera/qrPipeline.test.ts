import { describe, it, expect } from 'vitest';
import {
  addQuietZone,
  binarize,
  decodeFromImageData,
  downscale,
  otsuThreshold,
  stretchContrast,
  toGray,
  variantOrder,
} from './qrPipeline';
import {
  FIXTURE_TEXT,
  renderQr,
  qrMatrix,
  TEAL_DARK,
  TEAL_LIGHT,
  WHITE,
  BLACK,
} from './__fixtures__/qrFixtures';

describe('фикстуры', () => {
  it('матрица версии 3 — 29×29', () => {
    expect(qrMatrix(FIXTURE_TEXT).size).toBe(29);
  });
});

describe('decodeFromImageData — полярности', () => {
  it('обычный код с quiet zone читается сырым вариантом', () => {
    const image = renderQr(FIXTURE_TEXT, { quietModules: 4 });
    const hit = decodeFromImageData(image);
    expect(hit).not.toBeNull();
    expect(hit!.text).toBe(FIXTURE_TEXT);
    expect(hit!.variant).toBe('raw');
  });

  it('обычный код без quiet zone читается через синтетическую рамку', () => {
    const image = renderQr(FIXTURE_TEXT);
    const hit = decodeFromImageData(image);
    expect(hit).not.toBeNull();
    expect(hit!.text).toBe(FIXTURE_TEXT);
  });

  it('инвертированный код на тёмно-бирюзовом фоне без quiet zone читается', () => {
    const image = renderQr(FIXTURE_TEXT, { fg: TEAL_LIGHT, bg: TEAL_DARK });
    const hit = decodeFromImageData(image);
    expect(hit).not.toBeNull();
    expect(hit!.text).toBe(FIXTURE_TEXT);
    expect(['raw-inverted', 'otsu-inverted', 'stretch-inverted']).toContain(hit!.variant);
  });

  it('обе фикстуры из одной матрицы дают одну и ту же строку', () => {
    const normal = decodeFromImageData(renderQr(FIXTURE_TEXT));
    const inverted = decodeFromImageData(renderQr(FIXTURE_TEXT, { fg: WHITE, bg: BLACK }));
    expect(normal!.text).toBe(FIXTURE_TEXT);
    expect(inverted!.text).toBe(FIXTURE_TEXT);
    expect(inverted!.text).toBe(normal!.text);
  });

  it('пустой кадр и шум дают null', () => {
    const blank = {
      data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
      width: 64,
      height: 64,
    };
    expect(decodeFromImageData(blank)).toBeNull();

    // Детерминированный «шум» без Math.random — важна лишь нерегулярность.
    const noise = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < noise.length; i += 4) {
      const v = (i * 2654435761) % 256;
      noise[i] = v;
      noise[i + 1] = (v * 7) % 256;
      noise[i + 2] = (v * 13) % 256;
      noise[i + 3] = 255;
    }
    expect(decodeFromImageData({ data: noise, width: 64, height: 64 })).toBeNull();
  });
});

describe('decodeFromImageData — принудительные режимы', () => {
  it("режим 'normal' не читает инвертированный код", () => {
    const image = renderQr(FIXTURE_TEXT, { fg: TEAL_LIGHT, bg: TEAL_DARK });
    expect(decodeFromImageData(image, { variants: 'normal' })).toBeNull();
  });

  it("режим 'inverted' читает инвертированный и не читает обычный", () => {
    const inverted = renderQr(FIXTURE_TEXT, { fg: TEAL_LIGHT, bg: TEAL_DARK });
    expect(decodeFromImageData(inverted, { variants: 'inverted' })!.text).toBe(FIXTURE_TEXT);

    const normal = renderQr(FIXTURE_TEXT, { quietModules: 4 });
    expect(decodeFromImageData(normal, { variants: 'inverted' })).toBeNull();
  });

  it('preferredVariant ставит сработавший вариант в начало конвейера', () => {
    expect(variantOrder('auto', 'otsu-inverted')).toEqual([
      'otsu-inverted',
      'raw',
      'raw-inverted',
      'otsu',
      'stretch-inverted',
    ]);
    // Кеш от «инвертированного» кадра не тащит лишние варианты в режим normal.
    expect(variantOrder('normal', 'otsu-inverted')).toEqual(['raw', 'otsu']);
  });
});

describe('шаги конвейера', () => {
  it('toGray считает luma по коэффициентам 0.299/0.587/0.114', () => {
    const image = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
      width: 3,
      height: 1,
    };
    const gray = toGray(image);
    expect(Array.from(gray.data)).toEqual([76, 150, 29]);
  });

  it('downscale уменьшает длинную сторону до предела и не трогает мелкое', () => {
    const big = { data: new Uint8Array(1280 * 720), width: 1280, height: 720 };
    const small = downscale(big, 640);
    expect(small.width).toBe(640);
    expect(small.height).toBe(360);

    const tiny = { data: new Uint8Array(100 * 50), width: 100, height: 50 };
    expect(downscale(tiny, 640)).toBe(tiny);
  });

  it('otsuThreshold разделяет бимодальную картинку', () => {
    const data = new Uint8Array(200);
    data.fill(40, 0, 100);
    data.fill(210, 100);
    const t = otsuThreshold(data);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(210);
  });

  it('binarize даёт 0/255 и умеет инвертировать', () => {
    const img = { data: new Uint8Array([10, 200]), width: 2, height: 1 };
    expect(Array.from(binarize(img, 100, false).data)).toEqual([0, 255]);
    expect(Array.from(binarize(img, 100, true).data)).toEqual([255, 0]);
  });

  it('stretchContrast растягивает узкий диапазон до полного', () => {
    // Половина «фон» 100, половина «модули» 140 — узкий диапазон печати.
    const data = new Uint8Array(1000);
    data.fill(100, 0, 500);
    data.fill(140, 500);
    const out = stretchContrast({ data, width: 100, height: 10 });
    expect(out.data[0]).toBe(0);
    expect(out.data[999]).toBe(255);
  });

  it('stretchContrast не трогает почти плоский кадр', () => {
    const img = { data: new Uint8Array(100).fill(128), width: 10, height: 10 };
    expect(stretchContrast(img)).toBe(img);
  });

  it('addQuietZone добавляет белую рамку заданной ширины', () => {
    const img = { data: new Uint8Array(4).fill(0), width: 2, height: 2 };
    const padded = addQuietZone(img, 3);
    expect(padded.width).toBe(8);
    expect(padded.height).toBe(8);
    expect(padded.data[0]).toBe(255); // угол рамки
    expect(padded.data[3 * 8 + 3]).toBe(0); // исходный пиксель
  });
});
