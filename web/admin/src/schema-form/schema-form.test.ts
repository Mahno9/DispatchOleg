import { describe, expect, it } from 'vitest';
import { clampToRange, rangeHint } from './LiveNumberInput';
import { missingRequired, type Schema } from './SchemaForm';

describe('clampToRange', () => {
  it('leaves a value inside the range alone', () => {
    expect(clampToRange(3, 1, 10)).toBe(3);
    expect(clampToRange(1, 1, 10)).toBe(1);
    expect(clampToRange(10, 1, 10)).toBe(10);
  });

  it('pulls values back to the nearest bound', () => {
    expect(clampToRange(-5, 1, 10)).toBe(1);
    expect(clampToRange(999, 1, 10)).toBe(10);
  });

  it('applies whichever bound the schema declares', () => {
    expect(clampToRange(0, 0.1, undefined)).toBe(0.1);
    expect(clampToRange(0, undefined, 60)).toBe(0);
    expect(clampToRange(80, undefined, 60)).toBe(60);
    expect(clampToRange(-99, undefined, undefined)).toBe(-99);
  });
});

describe('rangeHint', () => {
  it('describes the declared bounds', () => {
    expect(rangeHint(1, 10)).toBe('от 1 до 10');
    expect(rangeHint(0.1, undefined)).toBe('не меньше 0.1');
    expect(rangeHint(undefined, 4)).toBe('не больше 4');
    expect(rangeHint(undefined, undefined)).toBe('');
  });
});

describe('missingRequired', () => {
  const schema: Schema = {
    type: 'object',
    required: ['shape', 'lives', 'tasks', 'muted'],
    properties: {
      shape: { type: 'object', title: 'Силуэт' },
      lives: { type: 'integer', title: 'Жизни' },
      tasks: { type: 'array', title: 'Задачи' },
      muted: { type: 'boolean', title: 'Без звука' },
      extra: { type: 'string', title: 'Необязательное' },
    },
  };

  it('reports nothing when every required field is filled', () => {
    expect(missingRequired(schema, { shape: { rows: [] }, lives: 3, tasks: [{}], muted: true })).toEqual([]);
  });

  it('keeps falsy-but-real values (0, false)', () => {
    expect(missingRequired(schema, { shape: {}, lives: 0, tasks: [{}], muted: false })).toEqual([]);
  });

  it('reports titles of empty, null and missing fields', () => {
    expect(missingRequired(schema, { shape: null, tasks: [], muted: false })).toEqual([
      'Силуэт',
      'Жизни',
      'Задачи',
    ]);
  });

  it('falls back to the key when the property has no title', () => {
    expect(missingRequired({ required: ['locks'] }, {})).toEqual(['locks']);
  });

  it('does not descend into array items', () => {
    const nested: Schema = {
      required: ['locks'],
      properties: {
        locks: {
          type: 'array',
          title: 'Ригели',
          items: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
        },
      },
    };
    // answer: '' — законное значение для hold-button, сохранение блокировать нельзя
    expect(missingRequired(nested, { locks: [{ answer: '' }] })).toEqual([]);
  });

  it('treats a non-object config as everything missing', () => {
    expect(missingRequired({ required: ['a'] }, undefined)).toEqual(['a']);
  });
});
