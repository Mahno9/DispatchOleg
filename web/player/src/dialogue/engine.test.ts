import { describe, expect, it } from 'vitest';
import { advance, initialSides, parseDialogue, pickPostDialogue, type DialogueDoc } from './engine';

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
      link: null,
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

  it('reads `remote` as a strict boolean, defaulting to a face-to-face scene', () => {
    const nodes = { n1: { text: 'a' } };
    expect(parseDialogue(RAW)!.remote).toBe(false);
    expect(parseDialogue({ start: 'n1', nodes, remote: true })!.remote).toBe(true);
    expect(parseDialogue({ start: 'n1', nodes, remote: false })!.remote).toBe(false);
    // Anything but `true` is a near scene: a typo must not stage a call.
    expect(parseDialogue({ start: 'n1', nodes, remote: 'true' })!.remote).toBe(false);
    expect(parseDialogue({ start: 'n1', nodes, remote: 1 })!.remote).toBe(false);
  });

  it('reads `music` as a non-empty string, defaulting to silence', () => {
    const nodes = { n1: { text: 'a' } };
    expect(parseDialogue(RAW)!.music).toBeNull();
    expect(parseDialogue({ start: 'n1', nodes, music: '/assets-store/mus.ogg' })!.music).toBe(
      '/assets-store/mus.ogg',
    );
    // Мусор и пустая строка — тишина: пустой src резолвится в адрес страницы.
    expect(parseDialogue({ start: 'n1', nodes, music: '' })!.music).toBeNull();
    expect(parseDialogue({ start: 'n1', nodes, music: null })!.music).toBeNull();
    expect(parseDialogue({ start: 'n1', nodes, music: 42 })!.music).toBeNull();
    expect(parseDialogue({ start: 'n1', nodes, music: ['/a.ogg'] })!.music).toBeNull();
  });

  it('keeps http(s) links and drops everything else', () => {
    const doc = parseDialogue({
      start: 'n1',
      nodes: {
        n1: { text: 'a', link: 'https://t.me/black_mug' },
        n2: { text: 'b', link: 'javascript:alert(1)' },
        n3: { text: 'c', link: 42 },
      },
    })!;
    expect(doc.nodes.n1?.link).toBe('https://t.me/black_mug');
    expect(doc.nodes.n2?.link).toBeNull();
    expect(doc.nodes.n3?.link).toBeNull();
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

describe('initialSides', () => {
  it('seeds Oleg left and the NPC right in a plain scene', () => {
    const doc = parseDialogue(RAW) as DialogueDoc;
    expect(initialSides(doc, null)).toEqual({ left: 'oleg', right: '7' });
  });

  it('seeds both sides from the document in an NPC↔NPC scene — no phantom Oleg', () => {
    const doc = parseDialogue({
      start: 'n1',
      nodes: {
        n1: { speaker: '53', side: 'left', text: 'a', next: 'n2' },
        n2: { speaker: '62', side: 'right', text: 'b', next: null },
      },
    }) as DialogueDoc;
    expect(initialSides(doc, null)).toEqual({ left: '53', right: '62' });
    // The right slot honours the declared side even when a left-side NPC
    // comes first in key order.
    expect(initialSides(doc, '99')).toEqual({ left: '53', right: '62' });
  });

  it('falls back to Oleg and the game partner when a side never speaks', () => {
    const doc = parseDialogue({
      start: 'n1',
      nodes: { n1: { speaker: 'oleg', side: 'left', text: 'a', next: null } },
    }) as DialogueDoc;
    expect(initialSides(doc, '7')).toEqual({ left: 'oleg', right: '7' });
    expect(initialSides(doc, null)).toEqual({ left: 'oleg', right: null });
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
