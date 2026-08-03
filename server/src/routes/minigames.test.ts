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

  it('skips bundle dirs without index.js and keeps system dirs without one', () => {
    // The built bundles may or may not be present in a given checkout; whatever is
    // listed from static/ must have an entryUrl, everything from system/ must not.
    for (const m of scanMinigames()) {
      if (m.system) expect(m.entryUrl).toBeNull();
      else expect(m.entryUrl).toBe(`/minigames/${m.id}/index.js`);
    }
  });
});
