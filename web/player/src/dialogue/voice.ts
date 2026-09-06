// ---------------------------------------------------------------------------
// Бубнёж персонажей: короткий тон осциллятора на каждую напечатанную букву
// (как в Undertale/Celeste). Пресет на персонажа приезжает настройкой
// `character_voices` и отобран разработчиком на демо-странице
// (`artifacts/babble-demo-20260905/page.html`) — здесь повторена ровно та же
// арифметика, чтобы игра звучала как отобранное демо, а не «примерно так же».
//
// Чистая логика (нормализация, темп, план блипа) вынесена из Web Audio:
// vitest в плеере крутится в node без DOM, и всё, что ниже createVoicePlayer,
// проверяется тестами напрямую.
// ---------------------------------------------------------------------------

import type { AudioPrefs } from '../state/localState';

export const WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const;
export type Wave = (typeof WAVES)[number];

/**
 * Пресет в том виде, в каком его использует игра. На демо-странице пресет
 * плоский и шире этого: поля источника «сэмплы» (`everyN`, `pitchMin`,
 * `pitchMax`, `sampleGain`, `cut`, `bank`) хранятся в настройке ради
 * round-trip с демо, но в игру не заводятся и здесь просто отбрасываются.
 */
export interface VoicePreset {
  wave: Wave;
  /** Базовая частота блипа, Гц. */
  hz: number;
  /** Разброс частоты, ±%. */
  jitter: number;
  /** Темп печати, мс на символ. */
  charMs: number;
  /** Длина блипа, мс. */
  blipMs: number;
  /** Спад огибающей, мс. */
  decayMs: number;
  /** Частота среза выходного НЧ-фильтра, Гц. */
  lowpass: number;
  /** Множитель пауз на знаках препинания. */
  pauseMul: number;
  /** Насколько ползёт вверх хвост перед «?». */
  questionMul: number;
  /** Согласные ниже гласных на 15% — голос перестаёт быть монотонным. */
  consonantDip: boolean;
}

/** Скорость печати без пресета, мс на символ. Прежнее поведение терминала. */
export const CHAR_MS = 22;

/** Мастер бубнежа: −12 дБ, как на демо-странице (`applyVolume`). */
const MASTER_GAIN = 0.25;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Число из чужого JSON: не число или NaN → значение по умолчанию. */
function num(raw: unknown, fallback: number, lo: number, hi: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, lo, hi) : fallback;
}

/**
 * Сырое значение из настроек → пресет или `null`, если это не осцилляторный
 * пресет. `null` дают: не-объект, неизвестная волна, отсутствующие hz/charMs/
 * blipMs (те же три поля проверяет админка перед сохранением) и явный
 * `source`, отличный от `'osc'` — сэмплы в игру не заводим. Отсутствующий
 * `source` считаем осциллятором: пресет, написанный руками, а не скопированный
 * с демо-страницы, это поле вполне может не нести.
 */
export function normalizeVoice(raw: unknown): VoicePreset | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.source !== undefined && p.source !== 'osc') return null;
  if (!WAVES.includes(p.wave as Wave)) return null;
  const required = [p.hz, p.charMs, p.blipMs];
  if (required.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return {
    wave: p.wave as Wave,
    hz: num(p.hz, 220, 40, 1000),
    jitter: num(p.jitter, 0, 0, 30),
    charMs: num(p.charMs, CHAR_MS, 8, 120),
    blipMs: num(p.blipMs, 50, 10, 200),
    decayMs: num(p.decayMs, 30, 5, 200),
    lowpass: num(p.lowpass, 4000, 200, 12000),
    pauseMul: num(p.pauseMul, 1, 0, 3),
    questionMul: num(p.questionMul, 1, 0.8, 1.6),
    consonantDip: p.consonantDip === true,
  };
}

/** Настройка `character_voices` целиком → пресеты по id говорящего. */
export function normalizeVoices(raw: unknown): Record<string, VoicePreset> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, VoicePreset> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const preset = normalizeVoice(value);
    if (preset) out[id] = preset;
  }
  return out;
}

const VOWELS = 'аеёиоуыэюяaeiouy';
const isLetter = (c: string): boolean => /[a-zа-яё]/i.test(c);
const isVowel = (c: string): boolean => VOWELS.includes(c.toLowerCase());

/**
 * Задержка перед печатью очередного символа. Знак препинания добавляет паузу
 * ПОСЛЕ себя (демо, `timeline`), поэтому пауза считается по предыдущему
 * символу; `curChar` нужен ровно для одного случая — многоточие «...» держит
 * паузу один раз, на последней точке подряд, а не трижды.
 *
 * Без пресета — прежний ровный `CHAR_MS` без пауз вообще.
 */
export function charDelayMs(
  preset: VoicePreset | null,
  prevChar: string | null | undefined,
  curChar?: string | null,
): number {
  if (!preset) return CHAR_MS;
  let ms = preset.charMs;
  if (prevChar === ',' || prevChar === ';' || prevChar === ':') ms += 120 * preset.pauseMul;
  else if (prevChar === '.' || prevChar === '…' || prevChar === '!' || prevChar === '?') {
    if (!(prevChar === '.' && curChar === '.')) ms += 250 * preset.pauseMul;
  }
  return ms;
}

/**
 * Вопросительная интонация: последние до шести букв перед «?» ползут вверх
 * к `questionMul` (демо, `questionRise`). Пробелы между буквами пропускаются,
 * любой другой знак обрывает хвост. Ключ — индекс символа в тексте.
 */
export function questionRise(text: string, mul: number): Record<number, number> {
  const rise: Record<number, number> = {};
  if (!(mul > 1.0001)) return rise;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '?') continue;
    const idx: number[] = [];
    for (let j = i - 1; j >= 0 && idx.length < 6; j--) {
      const c = text[j] as string;
      if (isLetter(c)) idx.push(j);
      else if (/\s/.test(c)) continue;
      else break;
    }
    idx.reverse();
    idx.forEach((at, k) => {
      rise[at] = 1 + (mul - 1) * ((k + 1) / idx.length);
    });
  }
  return rise;
}

/** Что играть на одном символе. `null` — на этом символе тишина. */
export interface Blip {
  hz: number;
  blipMs: number;
  decayMs: number;
}

/**
 * План блипа для символа `index`. Звучат только буквы: пробелы, знаки и цифры
 * молчат (демо, `scheduleOsc`). Порядок множителей взят оттуда же: сначала
 * провал согласной, потом джиттер, потом подъём на вопросе.
 *
 * `random` вынесен в параметр, чтобы джиттер проверялся тестом на границах.
 */
export function planBlip(
  preset: VoicePreset,
  text: string,
  index: number,
  random: number = Math.random(),
): Blip | null {
  const c = text[index];
  if (c === undefined || !isLetter(c)) return null;
  let hz = preset.hz;
  if (preset.consonantDip && !isVowel(c)) hz *= 0.85;
  hz *= 1 + (random * 2 - 1) * (preset.jitter / 100);
  const rise = questionRise(text, preset.questionMul)[index];
  if (rise) hz *= rise;
  return { hz: clamp(hz, 20, 12000), blipMs: preset.blipMs, decayMs: preset.decayMs };
}

/** Проигрыватель бубнежа: один на модуль печати, контекст поднимается лениво. */
export interface VoicePlayer {
  blip(preset: VoicePreset, text: string, index: number, audio: AudioPrefs): void;
}

type AudioContextCtor = new () => AudioContext;

/**
 * Web Audio поверх `planBlip`. Контекст создаётся на первом блипе и живёт до
 * конца вкладки; граф на блип — Oscillator → Gain (огибающая) → lowpass →
 * мастер → выход, как на демо-странице.
 *
 * Автоплей: контекст, поднятый до первого жеста, приезжает `suspended`
 * (диалог может начаться под оверлеем, который жест и съел) — добираем
 * одноразовым слушателем `pointerdown` на документе.
 */
export function createVoicePlayer(): VoicePlayer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let waitingForGesture = false;
  let broken = false;

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx;
    if (broken) return null;
    const win = globalThis as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) {
      broken = true;
      return null;
    }
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  /** Разбуженный контекст или добор на первом жесте — звук не теряем молча. */
  function resume(context: AudioContext): void {
    if (context.state !== 'suspended') return;
    void Promise.resolve(context.resume()).catch(() => {});
    if (waitingForGesture || typeof document === 'undefined') return;
    waitingForGesture = true;
    const wake = (): void => {
      waitingForGesture = false;
      document.removeEventListener('pointerdown', wake);
      void Promise.resolve(context.resume()).catch(() => {});
    };
    document.addEventListener('pointerdown', wake, { once: true });
  }

  function blip(preset: VoicePreset, text: string, index: number, audio: AudioPrefs): void {
    try {
      if (audio.muted) return;
      const sfx = clamp(Number(audio.sfxVolume) || 0, 0, 100) / 100;
      if (sfx === 0) return;
      const plan = planBlip(preset, text, index);
      if (!plan) return;
      const context = ensureCtx();
      if (!context || !master) return;
      resume(context);
      master.gain.value = clamp(sfx * MASTER_GAIN, 0, 1);

      const when = context.currentTime;
      const len = Math.max(0.01, plan.blipMs / 1000);
      const dec = Math.max(0.005, plan.decayMs / 1000);
      // Спад не длиннее самого блипа — иначе короткий блип звучал бы длинным.
      const decEnd = Math.min(0.005 + dec, Math.max(len, 0.008));

      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = preset.lowpass;
      lowpass.Q.value = 0.7;
      lowpass.connect(master);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(0.45, when + 0.005); // атака 5 мс
      gain.gain.exponentialRampToValueAtTime(0.0002, when + decEnd);
      gain.connect(lowpass);

      const osc = context.createOscillator();
      osc.type = preset.wave;
      osc.frequency.value = plan.hz;
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + Math.max(len, decEnd) + 0.005);
      // Узлы одноразовые: без отцепки они копятся на мастере до конца вкладки.
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
          lowpass.disconnect();
        } catch {
          // Уже отцеплен — ничего страшного.
        }
      };
    } catch {
      // Нет Web Audio (SSR, старый браузер, запрет) — печать идёт молча.
    }
  }

  return { blip };
}
