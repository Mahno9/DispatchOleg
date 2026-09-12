import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Game } from '../api';
import { SandboxGameList, SandboxLauncher } from './SandboxLauncher';

const games: Game[] = [
  {
    id: 2,
    title: 'Восточный мост',
    minigameId: 'bridge',
    isTutorial: false,
    isFinale: false,
    requiredGameIds: [],
    sortOrder: 10,
    character: null,
  },
  {
    id: 3,
    title: 'Кухня для героев',
    minigameId: 'cooking',
    isTutorial: false,
    isFinale: false,
    requiredGameIds: [2],
    sortOrder: 20,
    character: null,
  },
];

describe('SandboxGameList', () => {
  it('показывает все операции в серверном порядке активными кнопками', () => {
    const out = renderToStaticMarkup(<SandboxGameList games={games} onSelect={vi.fn()} />);
    expect(out.indexOf(games[0]!.title)).toBeLessThan(out.indexOf(games[1]!.title));
    expect(out).toContain('id="sandbox-games"');
    expect(out).toContain('role="group"');
    expect(out).not.toContain('role="menu');
    expect(out).not.toContain('disabled');
  });

  it('не мигает в эндгейме', () => {
    const out = renderToStaticMarkup(<SandboxLauncher games={games} onSelect={vi.fn()} />);
    expect(out).not.toContain('btn-alert');
  });
});
