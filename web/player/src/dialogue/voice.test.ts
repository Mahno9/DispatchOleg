import { describe, expect, it } from 'vitest';
import {
  CHAR_MS,
  charDelayMs,
  normalizeVoice,
  normalizeVoices,
  planBlip,
  questionRise,
  type VoicePreset,
} from './voice';

/** Пресет Чейза (58) с демо-страницы — эталон, по нему сверяются числа. */
const CHASE_RAW = {
  source: 'osc',
  wave: 'triangle',
  hz: 273,
  jitter: 3,
  charMs: 57,
  blipMs: 93,
  decayMs: 20,
  lowpass: 4250,
  pauseMul: 1,
  questionMul: 1.15,
  consonantDip: true,
  everyN: 5,
  pitchMin: 0.85,
  pitchMax: 1.27,
  sampleGain: -4,
  cut: true,
};

function preset(over: Partial<VoicePreset> = {}): VoicePreset {
  return { ...(normalizeVoice(CHASE_RAW) as VoicePreset), ...over };
}

describe('normalizeVoice', () => {
  it('берёт пресет с демо-страницы как есть и отбрасывает поля сэмплов', () => {
    expect(normalizeVoice(CHASE_RAW)).toEqual({
      wave: 'triangle',
      hz: 273,
      jitter: 3,
      charMs: 57,
      blipMs: 93,
      decayMs: 20,
      lowpass: 4250,
      pauseMul: 1,
      questionMul: 1.15,
      consonantDip: true,
    });
  });

  it('сэмплы в игру не заводим', () => {
    expect(normalizeVoice({ ...CHASE_RAW, source: 'samples' })).toBeNull();
  });

  it('отсутствующий source — это осциллятор: пресет могли написать руками', () => {
    expect(normalizeVoice({ wave: 'sine', hz: 200, charMs: 30, blipMs: 40 })).not.toBeNull();
  });

  it('чужая волна и недостающие обязательные поля дают null', () => {
    expect(normalizeVoice({ ...CHASE_RAW, wave: 'noise' })).toBeNull();
    expect(normalizeVoice({ ...CHASE_RAW, hz: '273' })).toBeNull();
    expect(normalizeVoice({ ...CHASE_RAW, charMs: undefined })).toBeNull();
    expect(normalizeVoice({ ...CHASE_RAW, blipMs: NaN })).toBeNull();
    expect(normalizeVoice(null)).toBeNull();
    expect(normalizeVoice([CHASE_RAW])).toBeNull();
    expect(normalizeVoice('osc')).toBeNull();
  });

  it('клампит вылезшие за диапазон значения, а не отбрасывает пресет целиком', () => {
    const p = normalizeVoice({
      wave: 'square',
      hz: 5000,
      charMs: 1,
      blipMs: 900,
      decayMs: 0,
      lowpass: 99999,
      jitter: 300,
      pauseMul: 12,
      questionMul: 9,
      consonantDip: true,
    });
    expect(p).toEqual({
      wave: 'square',
      hz: 1000,
      charMs: 8,
      blipMs: 200,
      decayMs: 5,
      lowpass: 12000,
      jitter: 30,
      pauseMul: 3,
      questionMul: 1.6,
      consonantDip: true,
    });
    // Нижние границы тоже держатся.
    expect(normalizeVoice({ wave: 'sine', hz: 1, charMs: 999, blipMs: 1 })).toMatchObject({
      hz: 40,
      charMs: 120,
      blipMs: 10,
    });
  });

  it('необязательные поля добираются умолчаниями', () => {
    expect(normalizeVoice({ wave: 'sine', hz: 200, charMs: 30, blipMs: 40 })).toEqual({
      wave: 'sine',
      hz: 200,
      charMs: 30,
      blipMs: 40,
      decayMs: 30,
      lowpass: 4000,
      jitter: 0,
      pauseMul: 1,
      questionMul: 1,
      consonantDip: false,
    });
  });
});

describe('normalizeVoices', () => {
  it('оставляет только живые пресеты, мусор молча выбрасывает', () => {
    const out = normalizeVoices({
      oleg: CHASE_RAW,
      '58': { ...CHASE_RAW, hz: 300 },
      '59': { ...CHASE_RAW, source: 'samples' },
      broken: { wave: 'nope' },
      nothing: null,
    });
    expect(Object.keys(out).sort()).toEqual(['58', 'oleg']);
    expect(out['58']?.hz).toBe(300);
  });

  it('не-объект — пустая карта, а не падение', () => {
    expect(normalizeVoices(null)).toEqual({});
    expect(normalizeVoices('x')).toEqual({});
    expect(normalizeVoices([CHASE_RAW])).toEqual({});
  });
});

describe('charDelayMs', () => {
  it('без пресета — прежний ровный темп терминала без пауз', () => {
    expect(charDelayMs(null, null)).toBe(CHAR_MS);
    expect(charDelayMs(null, '.')).toBe(CHAR_MS);
    expect(charDelayMs(null, ',')).toBe(CHAR_MS);
  });

  it('запятая, точка и обычная буква — три разных шага (демо, timeline)', () => {
    const p = preset({ charMs: 57, pauseMul: 1 });
    expect(charDelayMs(p, 'а')).toBe(57);
    expect(charDelayMs(p, ',')).toBe(57 + 120);
    expect(charDelayMs(p, '.')).toBe(57 + 250);
    expect(charDelayMs(p, '?')).toBe(57 + 250);
    expect(charDelayMs(p, '…')).toBe(57 + 250);
    expect(charDelayMs(p, ';')).toBe(57 + 120);
    expect(charDelayMs(p, ':')).toBe(57 + 120);
  });

  it('pauseMul масштабирует только паузу, не темп', () => {
    const p = preset({ charMs: 40, pauseMul: 1.5 });
    expect(charDelayMs(p, 'а')).toBe(40);
    expect(charDelayMs(p, ',')).toBe(40 + 180);
    expect(charDelayMs(p, '.')).toBe(40 + 375);
  });

  it('многоточие держит паузу один раз, на последней точке подряд', () => {
    const p = preset({ charMs: 45, pauseMul: 1 });
    expect(charDelayMs(p, '.', '.')).toBe(45); // «..» — пауза ещё не здесь
    expect(charDelayMs(p, '.', ' ')).toBe(45 + 250); // последняя точка — пауза
  });
});

describe('planBlip', () => {
  const p = preset({ hz: 273, jitter: 0, consonantDip: true, questionMul: 1 });

  it('пробелы, знаки и цифры молчат', () => {
    expect(planBlip(p, 'а б', 1, 0.5)).toBeNull();
    expect(planBlip(p, 'а.', 1, 0.5)).toBeNull();
    expect(planBlip(p, 'а7', 1, 0.5)).toBeNull();
    expect(planBlip(p, 'аб', 5, 0.5)).toBeNull();
  });

  it('гласная звучит на своей частоте, согласная — на 15% ниже', () => {
    // «ба»: б — согласная, а — гласная.
    expect(planBlip(p, 'ба', 1, 0.5)?.hz).toBeCloseTo(273, 6);
    expect(planBlip(p, 'ба', 0, 0.5)?.hz).toBeCloseTo(273 * 0.85, 6);
  });

  it('без consonantDip согласная не проваливается', () => {
    const flat = preset({ hz: 273, jitter: 0, consonantDip: false, questionMul: 1 });
    expect(planBlip(flat, 'ба', 0, 0.5)?.hz).toBeCloseTo(273, 6);
  });

  it('джиттер укладывается ровно в ±jitter% на краях random', () => {
    const j = preset({ hz: 300, jitter: 10, consonantDip: false, questionMul: 1 });
    expect(planBlip(j, 'а', 0, 0)?.hz).toBeCloseTo(270, 6); // random 0 → −10%
    expect(planBlip(j, 'а', 0, 1)?.hz).toBeCloseTo(330, 6); // random 1 → +10%
    expect(planBlip(j, 'а', 0, 0.5)?.hz).toBeCloseTo(300, 6);
  });

  it('хвост перед «?» ползёт вверх, а ровная реплика — нет', () => {
    const q = preset({ hz: 300, jitter: 0, consonantDip: false, questionMul: 1.2 });
    const rising = planBlip(q, 'да?', 1, 0.5)!.hz; // последняя буква перед «?»
    const before = planBlip(q, 'да?', 0, 0.5)!.hz;
    expect(rising).toBeGreaterThan(before);
    expect(rising).toBeCloseTo(360, 6); // 300 × 1.2 — полный подъём на последней
    expect(planBlip(q, 'да.', 1, 0.5)!.hz).toBeCloseTo(300, 6);
  });

  it('blipMs/decayMs отдаются из пресета как есть', () => {
    expect(planBlip(p, 'а', 0, 0.5)).toMatchObject({ blipMs: 93, decayMs: 20 });
  });
});

describe('questionRise', () => {
  it('без подъёма (questionMul ≈ 1) карта пуста', () => {
    expect(questionRise('да?', 1)).toEqual({});
  });

  it('подъём распределён по последним буквам перед «?»', () => {
    const rise = questionRise('да?', 1.2);
    expect(rise[0]).toBeCloseTo(1.1, 6);
    expect(rise[1]).toBeCloseTo(1.2, 6);
    expect(rise[2]).toBeUndefined();
  });

  it('не-буква обрывает хвост, пробел — нет', () => {
    // «ты да?» — пробел прозрачен, буквы «т ы д а» попадают в хвост.
    expect(Object.keys(questionRise('ты да?', 1.2)).length).toBe(4);
    // Запятая обрывает: в хвост попадают только «да».
    expect(Object.keys(questionRise('ты, да?', 1.2)).length).toBe(2);
  });

  it('хвост не длиннее шести букв', () => {
    expect(Object.keys(questionRise('хранилищесмотришь?', 1.2)).length).toBe(6);
  });
});
