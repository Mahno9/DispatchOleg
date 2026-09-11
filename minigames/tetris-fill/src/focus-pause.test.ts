import { describe, expect, it, vi } from 'vitest';
import { bindFocusPause } from './index.js';

describe('focus pause', () => {
  it('pauses on blur/hidden, resumes on focus/visible, and cleans up', () => {
    const win = new EventTarget();
    const doc = new EventTarget();
    const setPaused = vi.fn();
    let hidden = false;
    const unbind = bindFocusPause(win, doc, () => hidden, setPaused);

    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('focus'));
    hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(setPaused.mock.calls).toEqual([[true], [false], [true], [true], [false]]);

    unbind();
    win.dispatchEvent(new Event('blur'));
    expect(setPaused).toHaveBeenCalledTimes(5);
  });
});
