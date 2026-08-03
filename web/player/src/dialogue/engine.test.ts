import { describe, expect, it } from 'vitest';
import { advance, parseDialogue, pickPostDialogue, type DialogueDoc } from './engine';

const RAW = {
  start: 'n1',
  nodes: {
    n1: { speaker: 'oleg', side: 'left', text: 'Слушаю.', next: 'n2', choices: null },
    n2: {
      speaker: '7',
      side: 'right',
      text: 'Кот на тополе.',
      next: null,
      choices: [
        { text: 'Присылаю бригаду.', next: 'n3' },
        { text: 'Сам слезет.', next: 'nowhere' },
      ],
    },
    n3: { speaker: 'oleg', side: 'left', text: 'Принято.', next: null },
  },
};

describe('parseDialogue', () => {
  it('normalises a well-formed document', () => {
    const doc = parseDialogue(RAW)!;
    expect(doc.start).toBe('n1');
    expect(doc.nodes.n1).toEqual({
      speaker: 'oleg',
      side: 'left',
      text: 'Слушаю.',
      next: 'n2',
      choices: [],
    });
    expect(doc.nodes.n2?.choices).toHaveLength(2);
    expect(doc.nodes.n2?.side).toBe('right');
  });

  it('rejects everything the player cannot show', () => {
    expect(parseDialogue(null)).toBeNull();
    expect(parseDialogue({})).toBeNull();
    expect(parseDialogue({ start: 'n1', nodes: {} })).toBeNull();
    expect(parseDialogue({ start: 'gone', nodes: { n1: { text: 'a' } } })).toBeNull();
    expect(parseDialogue({ nodes: { n1: { text: 'a' } } })).toBeNull();
    expect(parseDialogue('[]')).toBeNull();
  });

  it('drops junk nodes and fills defaults', () => {
    const doc = parseDialogue({
      start: 'n1',
      nodes: { n1: { text: 'a' }, bad: { speaker: 'oleg' }, worse: 42 },
    })!;
    expect(Object.keys(doc.nodes)).toEqual(['n1']);
    expect(doc.nodes.n1).toMatchObject({ speaker: 'oleg', side: 'left', next: null, choices: [] });
  });
});

describe('advance', () => {
  const doc = parseDialogue(RAW) as DialogueDoc;

  it('follows next on a plain node', () => {
    expect(advance(doc, 'n1')).toBe('n2');
  });

  it('follows the picked choice', () => {
    expect(advance(doc, 'n2', 0)).toBe('n3');
  });

  it('ends on a terminal node, a missing node, a dangling link or a bad index', () => {
    expect(advance(doc, 'n3')).toBeNull();
    expect(advance(doc, 'ghost')).toBeNull();
    expect(advance(doc, 'n2', 1)).toBeNull(); // choice points at a node that does not exist
    expect(advance(doc, 'n2', 9)).toBeNull();
    expect(advance(doc, 'n2')).toBeNull(); // choices need an explicit pick
  });
});

describe('pickPostDialogue', () => {
  const game = {
    postWinDialogueId: 10,
    postLoseDialogueId: 20,
    styleDialogues: { ghost: 30 },
  };

  it('takes the lose dialogue regardless of styleTag', () => {
    expect(pickPostDialogue(game, { won: false, details: { styleTag: 'ghost' } })).toBe(20);
  });

  it('takes the style branch on a win when the tag is mapped', () => {
    expect(pickPostDialogue(game, { won: true, details: { styleTag: 'ghost' } })).toBe(30);
  });

  it('falls back to the plain win dialogue', () => {
    expect(pickPostDialogue(game, { won: true })).toBe(10);
    expect(pickPostDialogue(game, { won: true, details: { styleTag: 'breaker' } })).toBe(10);
    expect(pickPostDialogue(game, { won: true, details: { styleTag: 7 } })).toBe(10);
  });

  it('returns null when the game has no dialogue for the outcome', () => {
    const bare = { postWinDialogueId: null, postLoseDialogueId: null, styleDialogues: {} };
    expect(pickPostDialogue(bare, { won: true })).toBeNull();
    expect(pickPostDialogue(bare, { won: false })).toBeNull();
  });
});
