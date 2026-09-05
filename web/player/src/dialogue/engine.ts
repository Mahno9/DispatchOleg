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
  /**
   * External link the player must open before the node lets the scene advance
   * (used by the finale to hand out a real-world contact). http(s) only.
   */
  link: string | null;
}

export interface DialogueDoc {
  start: string;
  nodes: Record<string, DialogueNode>;
  /**
   * The scene is a call, not a meeting: both portraits are shown as comms
   * panels — framed screens that crop to fill — instead of figures standing on
   * the stage. Default false, i.e. face to face.
   */
  remote: boolean;
  /**
   * Фоновая петля сцены — URL ассета (`/assets-store/<id>.ogg`). null — тишина.
   */
  music: string | null;
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
      link: typeof n.link === 'string' && /^https?:\/\//.test(n.link) ? n.link : null,
    };
  }

  const start = doc.start;
  if (typeof start !== 'string' || !nodes[start]) return null;
  return {
    start,
    nodes,
    remote: doc.remote === true,
    // Пустая строка — это «музыки нет», а не ассет по адресу страницы.
    music: typeof doc.music === 'string' && doc.music !== '' ? doc.music : null,
  };
}

/**
 * Who occupies each side before the first line: the first speaker declared for
 * that side anywhere in the document. Falls back to Oleg on the left and the
 * game's character on the right — so a plain Oleg↔NPC scene keeps both
 * portraits from frame one, and an NPC↔NPC scene shows no phantom Oleg.
 */
export function initialSides(
  doc: DialogueDoc,
  partner: string | null,
): { left: string | null; right: string | null } {
  const nodes = Object.values(doc.nodes);
  return {
    left: nodes.find((n) => n.side === 'left')?.speaker ?? OLEG,
    right: nodes.find((n) => n.side === 'right')?.speaker ?? partner,
  };
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
