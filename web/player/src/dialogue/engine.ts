// ---------------------------------------------------------------------------
// Dialogue traversal + post-dialogue selection. Pure logic, no React — this is
// the part worth unit-testing (see engine.test.ts).
// Node format: docs/dialogue-system.md §1.
// ---------------------------------------------------------------------------

/** Speaker id of the player-dispatcher; never present in `characters`. */
export const OLEG = 'oleg';

export interface DialogueChoice {
  text: string;
  next: string;
}

export interface DialogueNode {
  /** 'oleg' or a character id (stringified, as JSON keys are strings). */
  speaker: string;
  side: 'left' | 'right';
  text: string;
  next: string | null;
  /** Normalised to an array — empty means "plain `next` transition". */
  choices: DialogueChoice[];
}

export interface DialogueDoc {
  start: string;
  nodes: Record<string, DialogueNode>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseChoices(raw: unknown): DialogueChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: DialogueChoice[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    if (c && typeof c.text === 'string' && typeof c.next === 'string') {
      out.push({ text: c.text, next: c.next });
    }
  }
  return out;
}

/**
 * Validates `dialogues.nodes_json` as it comes from the API. Returns null for
 * anything the player cannot show (empty, malformed, missing `start` node) —
 * the caller then skips the screen instead of blocking the game.
 */
export function parseDialogue(raw: unknown): DialogueDoc | null {
  const doc = asRecord(raw);
  const rawNodes = doc && asRecord(doc.nodes);
  if (!doc || !rawNodes) return null;

  const nodes: Record<string, DialogueNode> = {};
  for (const [id, value] of Object.entries(rawNodes)) {
    const n = asRecord(value);
    if (!n || typeof n.text !== 'string') continue;
    nodes[id] = {
      speaker: typeof n.speaker === 'string' ? n.speaker : OLEG,
      side: n.side === 'right' ? 'right' : 'left',
      text: n.text,
      next: typeof n.next === 'string' ? n.next : null,
      choices: parseChoices(n.choices),
    };
  }

  const start = doc.start;
  if (typeof start !== 'string' || !nodes[start]) return null;
  return { start, nodes };
}

/**
 * Next node id, or null when the dialogue ends here. Broken links end the
 * dialogue too — a typo in the admin must not strand the player mid-chain.
 * `choiceIndex` is required for nodes that have choices and ignored otherwise.
 */
export function advance(doc: DialogueDoc, nodeId: string, choiceIndex?: number): string | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  const target =
    node.choices.length > 0
      ? choiceIndex === undefined
        ? null
        : (node.choices[choiceIndex]?.next ?? null)
      : node.next;
  return target !== null && doc.nodes[target] ? target : null;
}

/**
 * Post-minigame dialogue per docs/platform.md §3.3: a win with a known
 * `details.styleTag` takes the style branch, otherwise the plain win/lose
 * dialogue. Null means "no post dialogue" — go straight back to meta.
 */
export function pickPostDialogue(
  game: {
    postWinDialogueId: number | null;
    postLoseDialogueId: number | null;
    styleDialogues: Record<string, number>;
  },
  result: { won: boolean; details?: Record<string, number | string> },
): number | null {
  if (!result.won) return game.postLoseDialogueId;
  const tag = result.details?.styleTag;
  const styled = typeof tag === 'string' ? game.styleDialogues?.[tag] : undefined;
  return styled ?? game.postWinDialogueId;
}
