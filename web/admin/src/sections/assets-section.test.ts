import { describe, expect, it } from 'vitest';
import type { AssetUsage } from '../api';
import { formatAssetUsageWarning } from './AssetsSection';

describe('formatAssetUsageWarning', () => {
  it('returns nothing for an asset used nowhere', () => {
    expect(formatAssetUsageWarning([])).toBe('');
  });

  it('lists every usage with its kind, title, id and field', () => {
    const usage: AssetUsage[] = [
      { kind: 'game', id: 25, title: 'Пробоина в отсеке', field: 'конфиг: sounds.move[0].url' },
      { kind: 'setting', id: 'ui_click_sound_url', title: 'ui_click_sound_url', field: 'значение' },
    ];
    const warn = formatAssetUsageWarning(usage);
    expect(warn).toContain('игра «Пробоина в отсеке» (#25) — конфиг: sounds.move[0].url');
    expect(warn).toContain('настройка «ui_click_sound_url» (#ui_click_sound_url) — значение');
  });

  it('warns that the links stay broken, not that they get cleared', () => {
    const warn = formatAssetUsageWarning([
      { kind: 'character', id: 3, title: 'Диспетчер', field: 'портрет' },
    ]);
    expect(warn).toContain('останутся битыми');
    expect(warn).not.toContain('будут сняты');
  });

  it('covers every usage kind label', () => {
    const usage: AssetUsage[] = [
      { kind: 'game', id: 1, title: 'Игра', field: 'f' },
      { kind: 'character', id: 2, title: 'Персонаж', field: 'f' },
      { kind: 'dialogue', id: 3, title: 'Диалог', field: 'f' },
      { kind: 'metaStage', id: 4, title: 'Этап', field: 'f' },
      { kind: 'setting', id: 'k', title: 'k', field: 'f' },
    ];
    const warn = formatAssetUsageWarning(usage);
    for (const label of ['игра', 'персонаж', 'диалог', 'этап меты', 'настройка']) {
      expect(warn).toContain(label);
    }
  });
});
