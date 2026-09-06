import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioPrefs } from '../state/localState';
import { charDelayMs, createVoicePlayer, type VoicePreset } from './voice';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Голос говорящего для печатаемой реплики. Без пресета печать беззвучная. */
export interface LineVoice {
  preset: VoicePreset | null;
  audio: AudioPrefs;
}

/**
 * Один проигрыватель бубнежа на весь плеер: контекст Web Audio поднимается
 * лениво внутри, на первом же звучащем символе.
 */
const voicePlayer = createVoicePlayer();

/**
 * Побуквенный вывод текста — единственное место в плеере, где реплика
 * «печатается». Сюда ходят и диалоговая сцена, и подсказки мини-игр, поэтому
 * звук печати (бубнёж персонажа, `dialogue/voice.ts`) добавлен здесь один раз
 * и звучит везде.
 *
 * `restartKey` — когда печать надо начать заново на том же тексте (две подряд
 * ноды диалога с одинаковой репликой: без ключа эффект бы не перезапустился).
 *
 * `voice` читается через ref, а не лежит в зависимостях: движение ползунка
 * громкости не должно перезапускать печать с первого символа.
 */
export function useTypewriter(
  text: string,
  restartKey?: string | number,
  voice?: LineVoice,
): { shown: number; done: boolean; skip: () => void } {
  const [shown, setShown] = useState(0);
  // Печать идёт цепочкой setTimeout (шаг зависит от знака перед символом),
  // и «уже показано» нужно ей синхронно: между тиком и рендером игрок мог
  // домотать строку кликом, и цепочка не должна отматывать её назад.
  const shownRef = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const reveal = useCallback((n: number) => {
    shownRef.current = n;
    setShown(n);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) {
      reveal(text.length);
      return;
    }
    reveal(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;

    function step(): void {
      const i = shownRef.current;
      if (!live || i >= text.length) return;
      const preset = voiceRef.current?.preset ?? null;
      timer = setTimeout(
        () => {
          const at = shownRef.current;
          if (!live || at >= text.length) return;
          reveal(at + 1);
          const v = voiceRef.current;
          if (v?.preset) voicePlayer.blip(v.preset, text, at, v.audio);
          step();
        },
        charDelayMs(preset, i === 0 ? null : text[i - 1], text[i]),
      );
    }
    step();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [text, restartKey, reveal]);

  return { shown, done: shown >= text.length, skip: () => reveal(text.length) };
}

/** Сравнение имён: регистр и «ё» не считаются. */
const nameKey = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е');

/**
 * «ИМЯ: реплика» → кто говорит и что именно. Так устроены двухголосые реплики
 * мини-игр: говорящий зашит префиксом в саму строку (`minigame_contract.md`).
 *
 * Имя признаётся только знакомое — полное или первое слово («ЧЕЙЗ» для «Чейз
 * Альбертович»). Иначе «Внимание: сирена» лишилось бы начала: у произвольного
 * двоеточия нет причин быть именем.
 */
export function splitSpeaker(
  text: string,
  names: readonly string[],
): { name: string | null; text: string } {
  const colon = text.indexOf(':');
  if (colon <= 0) return { name: null, text };
  const prefix = nameKey(text.slice(0, colon));
  if (prefix === '') return { name: null, text };
  const match = names.find(
    (n) => n !== '' && (nameKey(n) === prefix || nameKey(n.split(' ')[0] ?? '') === prefix),
  );
  if (match === undefined) return { name: null, text };
  return { name: match, text: text.slice(colon + 1).trim() };
}

interface DialogueLineProps {
  /** Имя говорящего над репликой. Пустое — строка имени не рисуется. */
  name: string;
  text: string;
  /** Сколько символов уже напечатано (`useTypewriter`). */
  shown: number;
  done: boolean;
  /** Сторона говорящего: правый прижимает текст к правому краю слота. */
  side?: 'left' | 'right';
  onClick?: () => void;
}

/**
 * Реплика в слоте 2 нижней панели: имя, напечатанная часть текста и курсор.
 * Только разметка — печатью управляет вызывающий (`useTypewriter`).
 */
export function DialogueLine({
  name,
  text,
  shown,
  done,
  side = 'left',
  onClick,
}: DialogueLineProps) {
  return (
    <div
      className={`dialogue-context${side === 'right' ? ' dialogue-context-right' : ''}`}
      onClick={onClick}
    >
      {name && <div className="label dialogue-name">{name}</div>}
      <p className="dialogue-line">
        {text.slice(0, shown)}
        {/* Ненапечатанный хвост остаётся в DOM, просто невидимый: строка держит
            финальную раскладку с первого символа, а не расползается по мере
            печати (при выравнивании вправо это было нечитаемо). Курсор —
            залитый фоном NBSP, а не inline-block: атомарный inline добавил бы
            точку переноса посреди слова и дёргал бы текст вокруг себя. */}
        <span className={`dialogue-cursor${done ? ' dialogue-hidden' : ''}`}>{' '}</span>
        <span className="dialogue-hidden">{text.slice(shown)}</span>
      </p>
    </div>
  );
}

/**
 * Самопечатающаяся реплика для тех, кому не нужен контроль над печатью
 * (подсказки мини-игр). Клик по панели сначала дописывает строку целиком,
 * и только на дописанной — отдаёт клик дальше.
 */
export function TypedLine({
  name,
  text,
  side = 'left',
  voice,
  onClick,
}: {
  name: string;
  text: string;
  side?: 'left' | 'right';
  /** Голос говорящего: пресет бубнежа + громкость игрока. Нет — печать молча. */
  voice?: LineVoice;
  onClick?: (() => void) | undefined;
}) {
  const { shown, done, skip } = useTypewriter(text, undefined, voice);
  return (
    <DialogueLine
      name={name}
      text={text}
      shown={shown}
      done={done}
      side={side}
      onClick={() => (done ? onClick?.() : skip())}
    />
  );
}
