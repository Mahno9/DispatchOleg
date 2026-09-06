import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AudioPrefs } from '../state/localState';
import { charDelayMs, createVoicePlayer, type VoicePreset } from './voice';
import './glow.css';

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

/** Кусок реплики: обычный текст или слово под подсветкой (`**…**`). */
export interface EmphasisSegment {
  text: string;
  glow: boolean;
}

/** Пары `**…**`; непарная звёздочка остаётся в тексте как есть. */
const EMPHASIS = /\*\*([\s\S]+?)\*\*/g;

/**
 * Разбирает разметку выделения: `А **Олег**.` → куски текста плюс та же строка
 * без звёздочек.
 *
 * `plain` нужен печати: `useTypewriter` считает символы, и звёздочки не должны
 * тратить такты (а бубнёж — блипать на них). Поэтому счётчик `shown` живёт в
 * координатах `plain`, а разметку раскладывает уже DialogueLine.
 */
export function parseEmphasis(text: string): { plain: string; segments: EmphasisSegment[] } {
  const segments: EmphasisSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPHASIS)) {
    const at = m.index ?? 0;
    if (at > last) segments.push({ text: text.slice(last, at), glow: false });
    segments.push({ text: m[1] ?? '', glow: true });
    last = at + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), glow: false });
  return { plain: segments.map((s) => s.text).join(''), segments };
}

/**
 * Кусок разобранной реплики от `start` до `end` в символах `plain`. Печать
 * может застать подсвеченное слово на середине — тогда оно приезжает двумя
 * половинками, и каждая остаётся подсвеченной.
 */
function sliceSegments(segments: EmphasisSegment[], start: number, end: number): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  for (const [i, seg] of segments.entries()) {
    const from = Math.max(start, pos);
    const to = Math.min(end, pos + seg.text.length);
    if (to > from) {
      const piece = seg.text.slice(from - pos, to - pos);
      out.push(
        seg.glow ? (
          <span key={i} className="dialogue-glow">
            {piece}
            {/* Третья искра: у span всего два псевдоэлемента, а орбите нужен
                ещё один огонёк. Пустой, вся отрисовка в glow.css. */}
            <i className="dialogue-spark" aria-hidden="true" />
          </span>
        ) : (
          piece
        ),
      );
    }
    pos += seg.text.length;
  }
  return out;
}

/** Текст с разметкой `**…**` как разметка — для мест без печати (карточки выбора). */
export function EmphasisText({ text }: { text: string }) {
  return <>{sliceSegments(parseEmphasis(text).segments, 0, Number.POSITIVE_INFINITY)}</>;
}

interface DialogueLineProps {
  /** Имя говорящего над репликой. Пустое — строка имени не рисуется. */
  name: string;
  /** Текст с разметкой: `{player}` уже подставлен, `**…**` ещё нет. */
  text: string;
  /** Сколько символов уже напечатано (`useTypewriter`), без учёта звёздочек. */
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
  const { segments } = parseEmphasis(text);
  return (
    <div
      className={`dialogue-context${side === 'right' ? ' dialogue-context-right' : ''}`}
      onClick={onClick}
    >
      {name && <div className="label dialogue-name">{name}</div>}
      <p className="dialogue-line">
        {sliceSegments(segments, 0, shown)}
        {/* Ненапечатанный хвост остаётся в DOM, просто невидимый: строка держит
            финальную раскладку с первого символа, а не расползается по мере
            печати (при выравнивании вправо это было нечитаемо). Курсор —
            залитый фоном NBSP, а не inline-block: атомарный inline добавил бы
            точку переноса посреди слова и дёргал бы текст вокруг себя. */}
        <span className={`dialogue-cursor${done ? ' dialogue-hidden' : ''}`}>{' '}</span>
        <span className="dialogue-hidden">
          {sliceSegments(segments, shown, Number.POSITIVE_INFINITY)}
        </span>
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
  // Печатается текст без звёздочек — иначе разметка съедала бы такты печати.
  const { shown, done, skip } = useTypewriter(parseEmphasis(text).plain, undefined, voice);
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
