import { describe, expect, it } from 'vitest';
import { isDispatchCode } from '../camera/QrScanner';
import { TEXTS, cameraErrorText, nameError } from './OnboardingScreen';

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

describe('cameraErrorText', () => {
  it('maps getUserMedia failures to actionable texts', () => {
    expect(cameraErrorText('NotAllowedError')).toBe(TEXTS.deniedText);
    expect(cameraErrorText('SecurityError')).toBe(TEXTS.deniedText);
    expect(cameraErrorText('NotReadableError')).toBe(TEXTS.busyCameraText);
    expect(cameraErrorText('NotFoundError')).toBe(TEXTS.noCameraText);
    expect(cameraErrorText('OverconstrainedError')).toBe(TEXTS.noCameraText);
  });
});
