import { describe, expect, it } from 'vitest';
import { scanMinigames } from './minigames.js';

describe('scanMinigames', () => {
  it('reports onboarding as a bundle-less system type', () => {
    const onboarding = scanMinigames().find((m) => m.id === 'onboarding');
    expect(onboarding).toMatchObject({
      id: 'onboarding',
      system: true,
      entryUrl: null,
      schemaUrl: '/minigames/onboarding/schema.json',
    });
    // The title comes from schema.json, not the folder name — that is what the
    // admin's type list shows.
    expect(onboarding?.title).not.toBe('onboarding');
  });

  it('extracts top-level schema defaults as the base config layer', () => {
    // onboarding/schema.json is always present and carries rich defaults — an
    // empty schemaDefaults here would mean games launch on an empty config again.
    const onboarding = scanMinigames().find((m) => m.id === 'onboarding');
    expect(onboarding?.schemaDefaults).toMatchObject({ allowSkipScan: expect.anything() });
    expect(Object.keys(onboarding?.schemaDefaults ?? {}).length).toBeGreaterThan(3);
    // Every scanned type gets the field, even if a schema declares no defaults.
    for (const m of scanMinigames()) expect(m.schemaDefaults).toBeTypeOf('object');
  });

  it('skips bundle dirs without index.js and keeps system dirs without one', () => {
    // The built bundles may or may not be present in a given checkout; whatever is
    // listed from static/ must have an entryUrl, everything from system/ must not.
    for (const m of scanMinigames()) {
      if (m.system) expect(m.entryUrl).toBeNull();
      else expect(m.entryUrl).toBe(`/minigames/${m.id}/index.js`);
    }
  });
});
