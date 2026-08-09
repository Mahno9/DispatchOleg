import { describe, expect, it } from 'vitest';
import { pickInput } from './characters.js';

describe('pickInput', () => {
  it('lets description through', () => {
    expect(pickInput({ name: 'Замзам', description: 'Уточняет формулировки.' })).toEqual({
      name: 'Замзам',
      description: 'Уточняет формулировки.',
    });
  });

  it('drops keys that are not editable fields', () => {
    const body = { description: 'ок', id: 7, created_at: 1 } as never;
    expect(pickInput(body)).toEqual({ description: 'ок' });
  });

  it('keeps an explicit empty description (clearing the field)', () => {
    // `'description' in body` — не truthy-проверка, иначе описание нельзя было бы стереть.
    expect(pickInput({ description: '' })).toEqual({ description: '' });
  });
});
