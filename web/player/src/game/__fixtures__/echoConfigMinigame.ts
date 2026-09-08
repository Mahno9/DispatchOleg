// Тестовый бандл для minigameLoader.timeout.test.ts: при init отдаёт адрес
// музыки обратно через onProgress. По нему видно, с каким конфигом стартовала
// игра — с blob-адресами предзагрузки или с исходными сетевыми.
export function init(
  _container: unknown,
  config: Record<string, unknown>,
  callbacks: { onProgress?: (text: string, percent?: number) => void },
) {
  callbacks.onProgress?.(String(config.music));
  return { destroy() {} };
}
