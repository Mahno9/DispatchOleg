import { describe, expect, it } from 'vitest';
import { ASSET_HEADERS, contentMatchesMime, MIME_MAP, svgLooksDangerous } from './assets.js';

describe('svgLooksDangerous', () => {
  it('allows a plain, script-free SVG', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <circle cx="5" cy="5" r="4" fill="red" />
    </svg>`;
    expect(svgLooksDangerous(svg)).toBe(false);
  });

  it('rejects an inline <script> element', () => {
    expect(svgLooksDangerous('<svg><script>alert(1)</script></svg>')).toBe(true);
  });

  it('rejects a self-closing/uppercase-tolerant <script> tag', () => {
    expect(svgLooksDangerous('<svg><SCRIPT>alert(1)</SCRIPT></svg>')).toBe(true);
  });

  it('rejects event handler attributes', () => {
    expect(svgLooksDangerous('<svg onload="alert(1)"></svg>')).toBe(true);
    expect(svgLooksDangerous('<svg><rect onclick="alert(1)"/></svg>')).toBe(true);
  });

  it('rejects javascript: URIs', () => {
    expect(svgLooksDangerous('<svg><a href="javascript:alert(1)"></a></svg>')).toBe(true);
  });

  it('rejects <foreignObject> embedding', () => {
    expect(
      svgLooksDangerous(
        '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject></svg>',
      ),
    ).toBe(true);
  });

  it('rejects data:text/html payloads', () => {
    expect(svgLooksDangerous('<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>')).toBe(
      true,
    );
  });
});

describe('contentMatchesMime', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]);

  it('passes real files of the type they claim', () => {
    expect(contentMatchesMime('image/png', png)).toBe(true);
    expect(contentMatchesMime('audio/ogg', ogg)).toBe(true);
    expect(contentMatchesMime('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(contentMatchesMime('image/gif', Buffer.from('GIF89a....'))).toBe(true);
    expect(
      contentMatchesMime(
        'image/webp',
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
      ),
    ).toBe(true);
    expect(contentMatchesMime('audio/flac', Buffer.from('fLaC0000'))).toBe(true);
    expect(
      contentMatchesMime('image/svg+xml', Buffer.from('<?xml version="1.0"?><svg xmlns=""/>')),
    ).toBe(true);
  });

  it('rejects a payload wearing someone else’s mime type', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(contentMatchesMime('image/png', html)).toBe(false);
    expect(contentMatchesMime('audio/ogg', html)).toBe(false);
    // Настоящий png, заявленный как ogg, — тоже подлог.
    expect(contentMatchesMime('audio/ogg', png)).toBe(false);
    expect(contentMatchesMime('image/png', ogg)).toBe(false);
    expect(contentMatchesMime('image/svg+xml', Buffer.from('<html>nope</html>'))).toBe(false);
  });

  it('survives an empty or truncated buffer instead of throwing', () => {
    expect(contentMatchesMime('image/png', Buffer.alloc(0))).toBe(false);
    expect(contentMatchesMime('audio/mp4', Buffer.from('ft'))).toBe(false);
  });

  // Иначе новый принимаемый формат тихо остался бы без проверки содержимого.
  it('has a signature for every accepted mime type', () => {
    for (const mime of Object.keys(MIME_MAP)) {
      expect(contentMatchesMime(mime, Buffer.from('definitely not a media file')), mime).toBe(
        false,
      );
    }
  });
});

describe('ASSET_HEADERS', () => {
  // Регексп-фильтр обходится XML-сущностями, поэтому запрет скриптов на отдаче —
  // не украшение, а единственный настоящий рубеж.
  it('forbids scripts in a directly opened asset', () => {
    const csp = ASSET_HEADERS['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(csp).not.toContain('allow-scripts');
    expect(ASSET_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
