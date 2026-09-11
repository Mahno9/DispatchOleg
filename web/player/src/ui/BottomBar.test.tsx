import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BottomBar } from './BottomBar';

// В плеере нет DOM-окружения (vitest в node, без jsdom): проверяем разметку через SSR.
function html(locked = false): string {
  return renderToStaticMarkup(
    <BottomBar cameraOn={false} locked={locked} action={<button type="button">Выйти</button>} />,
  );
}

describe('BottomBar под инструктажем', () => {
  // Игрок жал «Выйти» вместо крестика инструктажа: панель должна его не пускать.
  it('накрыта скримом, а слоты инертны — и для мыши, и для клавиатуры', () => {
    const out = html(true);
    expect(out).toContain('class="bottombar bottombar-locked"');
    expect(out).toContain('class="bottombar-scrim"');
    expect(out).toContain('<div class="slot-action" inert=""><button');
    expect(out.match(/inert=""/g)?.length).toBe(3);
  });

  it('без инструктажа — обычная панель, «Выйти» живой', () => {
    const out = html();
    expect(out).not.toContain('bottombar-locked');
    expect(out).not.toContain('bottombar-scrim');
    expect(out).not.toContain('inert');
  });
});
