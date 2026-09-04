import { useEffect, useState } from 'react';

/** Скорость печати, мс на символ. Общая для всех реплик — это и есть «голос» терминала. */
const CHAR_MS = 22;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Побуквенный вывод текста — единственное место в плеере, где реплика
 * «печатается». Сюда ходят и диалоговая сцена, и подсказки мини-игр: звук
 * печати, когда он придёт в систему диалогов, добавляется здесь один раз
 * и сразу звучит везде.
 *
 * `restartKey` — когда печать надо начать заново на том же тексте (две подряд
 * ноды диалога с одинаковой репликой: без ключа эффект бы не перезапустился).
 */
export function useTypewriter(
  text: string,
  restartKey?: string | number,
): { shown: number; done: boolean; skip: () => void } {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [text, restartKey]);

  return { shown, done: shown >= text.length, skip: () => setShown(text.length) };
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
  onClick,
}: {
  name: string;
  text: string;
  side?: 'left' | 'right';
  onClick?: (() => void) | undefined;
}) {
  const { shown, done, skip } = useTypewriter(text);
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
