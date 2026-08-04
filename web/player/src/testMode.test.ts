import { describe, expect, it } from 'vitest';
import { parseTestTarget } from './testMode';

describe('parseTestTarget', () => {
  it('parses every target', () => {
    expect(parseTestTarget('?test=onboarding')).toEqual({ kind: 'onboarding' });
    expect(parseTestTarget('?test=meta')).toEqual({ kind: 'meta', stageId: null });
    expect(parseTestTarget('?test=meta:7')).toEqual({ kind: 'meta', stageId: 7 });
    expect(parseTestTarget('?test=game:12')).toEqual({ kind: 'game', gameId: 12 });
    expect(parseTestTarget('?test=dialogue:3')).toEqual({ kind: 'dialogue', dialogueId: 3 });
  });

  it('ignores absent or malformed values', () => {
    expect(parseTestTarget('')).toBeNull();
    expect(parseTestTarget('?foo=bar')).toBeNull();
    expect(parseTestTarget('?test=')).toBeNull();
    expect(parseTestTarget('?test=game:')).toBeNull();
    expect(parseTestTarget('?test=game:abc')).toBeNull();
    expect(parseTestTarget('?test=victory')).toBeNull();
    expect(parseTestTarget('?test=dialogue:x')).toBeNull();
  });
});
