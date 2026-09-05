import { useEffect, useRef } from 'react';
import type { AudioPrefs } from '../state/localState';

// ---------------------------------------------------------------------------
// Щелчок интерфейса. Источник — глобальная настройка `ui_click_sound_url`:
// строка (легаси, один файл) или взвешенный список вариантов из админки.
// Громкость — общий ползунок эффектов игрока, как у мини-игр.
// ---------------------------------------------------------------------------

/** Один вариант звука во взвешенном списке; `volume` — 0…200 процентов. */
export interface ClickVariant {
  url: string;
  weight: number;
  volume: number;
}

/** Сколько элементов на один url держим, чтобы частые клики накладывались. */
const POOL_LIMIT = 4;

/** `0` — валидная громкость варианта, `|| 100` её бы съело. */
function volumeOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : 100;
}

/** Строка / список / мусор из настроек → варианты. Пусто — звука нет. */
export function normalizeClickSound(value: unknown): ClickVariant[] {
  if (!value) return [];
  if (typeof value === 'string') return [{ url: value, weight: 1, volume: 100 }];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { url: string } => !!v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string')
    .map((v) => ({
      url: v.url,
      weight: Math.max(1, Number((v as { weight?: unknown }).weight) || 1),
      volume: volumeOf((v as { volume?: unknown }).volume),
    }));
}

/**
 * Императивная часть хука. Вынесена из хука, потому что vitest в плеере ходит
 * в node без DOM — так логику видно тестам.
 */
export function createClickSound(value: unknown) {
  const variants = normalizeClickSound(value);
  // Элементы создаём один раз на url: подгрузка не должна съедать первый клик.
  const pool = new Map<string, HTMLAudioElement[]>();
  for (const v of variants) {
    if (pool.has(v.url)) continue;
    const node = new Audio(v.url);
    node.preload = 'auto';
    pool.set(v.url, [node]);
  }

  /** Взвешенный выбор: подряд идущие клики не бьют в одну и ту же запись. */
  function pick(random: number = Math.random()): ClickVariant | null {
    if (!variants.length) return null;
    let r = random * variants.reduce((s, v) => s + v.weight, 0);
    for (const v of variants) {
      r -= v.weight;
      if (r <= 0) return v;
    }
    return variants[variants.length - 1]!;
  }

  function play(prefs: AudioPrefs, random?: number): void {
    if (prefs.muted) return;
    const sfx = Math.max(0, Math.min(100, Number(prefs.sfxVolume) || 0)) / 100;
    if (sfx === 0) return;
    const variant = pick(random);
    if (!variant) return;
    const nodes = pool.get(variant.url)!;
    // Свободный элемент, а иначе копия: клик по клику должен переспускаться,
    // а не ждать в очереди за предыдущим.
    let node = nodes.find((n) => n.paused);
    if (!node) {
      if (nodes.length < POOL_LIMIT) {
        node = nodes[0]!.cloneNode() as HTMLAudioElement;
        nodes.push(node);
      } else {
        node = nodes[0]!;
      }
    }
    node.volume = Math.max(0, Math.min(1, sfx * (variant.volume / 100)));
    node.currentTime = 0;
    // Автоплей до первого жеста тут не проблема: жест — это и есть сам клик.
    void Promise.resolve(node.play()).catch(() => {});
  }

  return { variants, pick, play };
}

/** Вешает один слушатель на документ: щелчок на любой живой кнопке. */
export function useClickSound({ value, prefs }: { value: unknown; prefs: AudioPrefs }): void {
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const sound = createClickSound(value);
    if (!sound.variants.length) return;
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      const button = target?.closest?.('button') as HTMLButtonElement | null | undefined;
      if (!button || button.disabled) return;
      sound.play(prefsRef.current);
    };
    // Перехват: у части кнопок обработчик глушит всплытие (выбор в диалоге).
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [value]);
}
