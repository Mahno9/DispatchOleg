// ---------------------------------------------------------------------------
// Admin test mode — the player opened with `?test=…` from the admin panel.
// State is then kept in memory only (no localStorage, no server sync), so a
// test run neither pollutes the terminal's real progress nor creates players.
// ---------------------------------------------------------------------------

export type TestTarget =
  | { kind: 'onboarding' }
  | { kind: 'meta'; stageId: number | null }
  | { kind: 'game'; gameId: number }
  | { kind: 'dialogue'; dialogueId: number };

/** `test` query param → target. Unknown/absent values mean the normal mode. */
export function parseTestTarget(search: string): TestTarget | null {
  const raw = new URLSearchParams(search).get('test');
  if (!raw) return null;
  if (raw === 'onboarding') return { kind: 'onboarding' };
  if (raw === 'meta') return { kind: 'meta', stageId: null };
  const meta = /^meta:(\d+)$/.exec(raw);
  if (meta) return { kind: 'meta', stageId: Number(meta[1]) };
  const game = /^game:(\d+)$/.exec(raw);
  if (game) return { kind: 'game', gameId: Number(game[1]) };
  const dialogue = /^dialogue:(\d+)$/.exec(raw);
  if (dialogue) return { kind: 'dialogue', dialogueId: Number(dialogue[1]) };
  return null;
}

export const testTarget: TestTarget | null =
  typeof window === 'undefined' ? null : parseTestTarget(window.location.search);
