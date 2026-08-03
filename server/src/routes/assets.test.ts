import { describe, expect, it } from 'vitest';
import { svgLooksDangerous } from './assets.js';

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
      svgLooksDangerous('<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject></svg>'),
    ).toBe(true);
  });

  it('rejects data:text/html payloads', () => {
    expect(
      svgLooksDangerous('<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>'),
    ).toBe(true);
  });
});
