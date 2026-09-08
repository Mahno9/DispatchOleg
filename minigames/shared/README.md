# shared

Общий код мини-игр. Отдельного пакета и своей сборки у него нет: файл
импортируется относительным путём (`../../shared/audio.js`) и попадает в бандл
каждой игры при `vite build`.

- `audio.ts` — `pickSound` и `createAudio`: музыка, зацикленный звук действия и
  одноразовые эффекты под одним владельцем, чтобы выход из игры не оставлял звук
  играть поверх меты. Описание API — в `minigame_contract.md`, раздел «Звук».
  Тесты живут в воркспейсах игр (`safe-crack/src/audio.test.ts`,
  `cooking-orders/src/audio.test.ts`) — иначе файл не попадает в `npm test` из корня.

Кто подключён: `cooking-orders`, `safe-crack`, `task-sort`, `tetris-fill`.
У `three-mazes` и `rescue-catch` звук свой, исторический.
