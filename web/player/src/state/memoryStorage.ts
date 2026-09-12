/**
 * Мини-localStorage для тестов: vitest в плеере запускается в node, без DOM,
 * поэтому обращения к хранилищу там молча гасятся catch-ами стора — и проверить
 * флаг показа финала было бы нечем.
 */
export function installMemoryLocalStorage(): void {
  const data = new Map<string, string>();
  const stub: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = stub;
}
