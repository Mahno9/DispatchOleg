import { useEffect, useRef } from 'react';
import type { AudioPrefs } from '../state/localState';

// ---------------------------------------------------------------------------
// Фоновая петля экрана: лобби (мета / скан / запуск, настройка `meta_music_url`)
// и диалоговая сцена (поле документа `music`). Громкость — общая настройка
// игрока, как у мини-игр.
// ---------------------------------------------------------------------------

/** Ползунок 0…100 → [0,1]: вне диапазона `HTMLAudioElement.volume` бросает. */
function gain(value: unknown): number {
  return Math.max(0, Math.min(100, typeof value === 'number' && Number.isFinite(value) ? value : 0)) / 100;
}

export interface MusicLoopState {
  /** Играть ли сейчас: в лобби — только на мете/скане/запуске; в сцене — пока она на экране. */
  active: boolean;
  prefs: AudioPrefs;
}

/**
 * Императивная часть хука: один элемент на петлю. Вынесена из хука, потому
 * что vitest в плеере ходит в node без DOM — так логику видно тестам.
 */
export function createMusicLoop(url: string) {
  const node = new Audio(url);
  node.loop = true;
  let last: MusicLoopState | null = null;
  let retry: (() => void) | null = null;
  let destroyed = false;

  function disarm(): void {
    if (!retry) return;
    document.removeEventListener('pointerdown', retry);
    retry = null;
  }

  function sync(state: MusicLoopState): void {
    if (destroyed) return;
    last = state;
    node.volume = gain(state.prefs.musicVolume);
    // Мьют и нулевая громкость — это «не играть», а не «играть в ноль».
    if (!state.active || state.prefs.muted || node.volume === 0) {
      disarm();
      node.pause();
      return;
    }
    if (!node.paused || retry) return;
    void Promise.resolve(node.play()).catch(() => {
      // Автоплей заблокирован до первого жеста — доберём его на pointerdown.
      if (destroyed || retry) return;
      retry = () => {
        retry = null;
        if (last) sync(last);
      };
      document.addEventListener('pointerdown', retry, { once: true });
    });
  }

  function destroy(): void {
    destroyed = true;
    disarm();
    node.pause();
    // Не гасить через `src = ''`: пустой src резолвится в адрес страницы.
    if (node.hasAttribute('src')) {
      node.removeAttribute('src');
      node.load();
    }
  }

  return { sync, destroy };
}

/** Играет `url` пока `active`, реагируя на prefs без пересоздания элемента. */
export function useMusicLoop({ url, active, prefs }: MusicLoopState & { url: string | null }): void {
  const musicRef = useRef<ReturnType<typeof createMusicLoop> | null>(null);

  useEffect(() => {
    if (!url) return;
    const music = createMusicLoop(url);
    musicRef.current = music;
    return () => {
      musicRef.current = null;
      music.destroy();
    };
  }, [url]);

  // Отдельным эффектом: смена громкости не должна пересоздавать элемент.
  useEffect(() => {
    musicRef.current?.sync({ active, prefs });
  }, [url, active, prefs]);
}
