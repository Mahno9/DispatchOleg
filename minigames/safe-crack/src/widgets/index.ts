import type { WidgetId } from '../engine.js';
import type { LockWidget, WidgetContext, WidgetFactory } from './common.js';
import { createCheckboxWall } from './checkboxWall.js';
import { createHaystackDropdown } from './haystackDropdown.js';
import { createHoldButton } from './holdButton.js';
import { createMegaSlider } from './megaSlider.js';
import { createNumberAsWords } from './numberAsWords.js';
import { createPlusMinus } from './plusMinus.js';
import { createRotaryDial } from './rotaryDial.js';
import { createSafeDrum } from './safeDrum.js';
import { createShuffleKeyboard } from './shuffleKeyboard.js';

export type { LockWidget, WidgetContext, WidgetFactory } from './common.js';

/** §5.1: обычный словарь, без классов и абстрактных фабрик. */
export const WIDGETS: Record<WidgetId, WidgetFactory> = {
  'mega-slider': createMegaSlider,
  'haystack-dropdown': createHaystackDropdown,
  'rotary-dial': createRotaryDial,
  'shuffle-keyboard': createShuffleKeyboard,
  'number-as-words': createNumberAsWords,
  'plus-minus': createPlusMinus,
  'safe-drum': createSafeDrum,
  'hold-button': createHoldButton,
  'checkbox-wall': createCheckboxWall,
};

/** §5.2: свойство виджета, а не конфига. */
export const SELF_SUBMIT: Set<WidgetId> = new Set<WidgetId>(['hold-button']);

/** §5.1: опечатка в админке не должна ронять игру. */
export function createWidget(id: WidgetId, ctx: WidgetContext): LockWidget {
  const factory = WIDGETS[id];
  if (!factory) {
    console.warn(`[safe-crack] неизвестный виджет «${id}», подставлен mega-slider`);
    return createMegaSlider(ctx);
  }
  return factory(ctx);
}
