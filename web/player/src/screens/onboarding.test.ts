import { describe, expect, it } from 'vitest';
import { isDispatchCode } from '../camera/QrScanner';
import { TEXTS, cameraErrorText, mergeTexts, nameError } from './OnboardingScreen';

describe('nameError', () => {
  it('accepts a normal name, spaces inside included', () => {
    expect(nameError('Олег')).toBeNull();
    expect(nameError('ОЛЕГ ДИСПЕТЧЕР')).toBeNull();
    expect(nameError('  Олег  ')).toBeNull();
  });

  it('rejects empty, whitespace-only and too short', () => {
    expect(nameError('')).toContain('МИНИМУМ');
    expect(nameError('   ')).toContain('МИНИМУМ');
    expect(nameError('О')).toContain('МИНИМУМ');
  });

  it('rejects too long and control characters', () => {
    expect(nameError('О'.repeat(TEXTS.nameMaxLength + 1))).toContain('МАКСИМУМ');
    expect(nameError('Олег')).toBe('НЕДОПУСТИМЫЕ СИМВОЛЫ');
  });
});

describe('isDispatchCode', () => {
  it('passes platform codes only', () => {
    expect(isDispatchCode('dispatch:12:abcdef')).toBe(true);
    expect(isDispatchCode('  dispatch:12:abcdef ')).toBe(true);
    expect(isDispatchCode('https://example.com')).toBe(false);
    expect(isDispatchCode('')).toBe(false);
  });
});

describe('mergeTexts', () => {
  it('falls back to the built-in defaults without a tutorial config', () => {
    expect(mergeTexts(undefined)).toEqual(TEXTS);
    expect(mergeTexts(null)).toEqual(TEXTS);
    expect(mergeTexts({})).toEqual(TEXTS);
  });

  it('overrides only the keys the admin actually set', () => {
    const merged = mergeTexts({ namePrompt: 'КТО ТЫ', successHoldMs: 300, allowSkipScan: true });
    expect(merged.namePrompt).toBe('КТО ТЫ');
    expect(merged.successHoldMs).toBe(300);
    expect(merged.allowSkipScan).toBe(true);
    expect(merged.bootText).toBe(TEXTS.bootText);
  });

  it('joins line lists into multi-line text', () => {
    expect(mergeTexts({ bootText: ['СТРОКА 1', 'СТРОКА 2'] }).bootText).toBe('СТРОКА 1\nСТРОКА 2');
  });

  it('ignores blanks, unknown keys and wrong types', () => {
    const merged = mergeTexts({
      namePrompt: '',
      qrHintText: [],
      bootHoldMs: 'скоро',
      successText: null,
      nope: 'x',
    });
    expect(merged).toEqual(TEXTS);
    expect(merged).not.toHaveProperty('nope');
  });

  it('keeps falsy-but-meaningful values', () => {
    expect(mergeTexts({ bootLineDelayMs: 0, allowSkipScan: false }).bootLineDelayMs).toBe(0);
  });

  it('does not mutate the defaults', () => {
    mergeTexts({ successText: 'ГОТОВО' });
    expect(TEXTS.successText).not.toBe('ГОТОВО');
  });
});

describe('cameraErrorText', () => {
  it('maps getUserMedia failures to actionable texts', () => {
    expect(cameraErrorText('NotAllowedError')).toBe(TEXTS.deniedText);
    expect(cameraErrorText('SecurityError')).toBe(TEXTS.deniedText);
    expect(cameraErrorText('NotReadableError')).toBe(TEXTS.busyCameraText);
    expect(cameraErrorText('NotFoundError')).toBe(TEXTS.noCameraText);
    expect(cameraErrorText('OverconstrainedError')).toBe(TEXTS.noCameraText);
  });
});
