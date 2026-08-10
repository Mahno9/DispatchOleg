// Тестовый бандл мини-игры для minigameLoader.test.ts: при init сразу шлёт
// реплику через onLine, а её onDismiss сам же и очищает слот — как того
// требует контракт (игра решает, что значит «погасить»).
export function init(
  _container: unknown,
  _config: unknown,
  callbacks: { onLine?: (text: string | null, onDismiss?: () => void) => void },
) {
  callbacks.onLine?.('Тут кто-то уже проходил.', () => callbacks.onLine?.(null));
  return { destroy() {} };
}
