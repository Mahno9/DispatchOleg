import {
  PROBE_TICK_MS,
  evaluate,
  maxScoreFor,
  normalizeTasks,
  pickSound,
  probeTicks,
  shouldPlayReadyCue,
  shuffle,
  styleTagFor,
  type AudioValue,
  type Task,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / callbacks
// ---------------------------------------------------------------------------

interface GameConfig {
  playerName?: string;
  attempts?: number;
  winThresholdPercent?: number;
  tasks?: unknown;
  sounds?: {
    pick?: AudioValue;
    drop?: AudioValue;
    shred?: AudioValue;
    error?: AudioValue;
    confirm?: AudioValue;
    deal?: AudioValue;
    probe?: AudioValue;
    probeDone?: AudioValue;
    ready?: AudioValue;
    scan?: AudioValue;
  };
  music?: AudioValue;
  muted?: boolean;
  /** 0…100 из общего регулятора плеера; живьём приходит через setVolume. */
  musicVolume?: number;
  sfxVolume?: number;
}

interface Callbacks {
  onComplete: (result: { score: number; won: boolean; details?: Record<string, number | string> }) => void;
  onExit: () => void;
  onProgress?: (text: string, percent?: number) => void;
}

type Zone = 'inbox' | 'queue' | 'archive';

const PREFIX = 'ts-';
const FADE_MS = 300;
const DRAG_THRESHOLD = 5;
const RETURN_MS = 160;
const SCAN_MS = 400;
const DEAL_STEP_MS = 40;
/** Фон не должен спорить с foley: он подложка, а не трек. */
const MUSIC_GAIN = 0.35;
/** Наведение подряд на десяток карточек не должно строчить звуком запроса. */
const PROBE_SOUND_GAP_MS = 120;
const SPINNER = ['|', '/', '—', '\\'];

// ---------------------------------------------------------------------------
// Styles — scoped under .ts-root, no global rules
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  box-sizing: border-box;
  background: #030B0C;
  color: #D3DED5;
  font-family: 'Barlow Condensed', 'Roboto Condensed', 'Rajdhani', system-ui, sans-serif;
  font-size: 15px;
  letter-spacing: 0.04em;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  -webkit-user-select: none;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }
.${PREFIX}mono { font-family: 'Share Tech Mono', 'IBM Plex Mono', ui-monospace, monospace; }

.${PREFIX}topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
  flex: 0 0 auto;
}
.${PREFIX}title {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #16A69B;
  white-space: nowrap;
}
.${PREFIX}msg {
  flex: 1 1 auto;
  min-width: 0;
  text-transform: uppercase;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: #759C96;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${PREFIX}msg.${PREFIX}alert { color: #F0713E; }

.${PREFIX}sq {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0A3435;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5;
  border-radius: 0;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.${PREFIX}sq:hover:not(:disabled) { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.35), inset 0 0 0 1px #062326; }
.${PREFIX}sq:disabled { opacity: 0.35; cursor: not-allowed; }
.${PREFIX}sq:focus-visible { outline: 1px solid #E9A928; outline-offset: 1px; }

.${PREFIX}zones {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr;
  grid-auto-rows: minmax(120px, 1fr);
  gap: 6px;
}
@media (min-width: 720px) {
  .${PREFIX}zones { grid-template-columns: 1fr 1fr 1fr; grid-auto-rows: auto; }
}

.${PREFIX}zone {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
  transition: border-color 120ms ease, background 120ms ease;
}
.${PREFIX}zone.${PREFIX}hover { border-color: #5DE2D0; background: #08292c; }
.${PREFIX}zone--archive { clip-path: polygon(0 0, 4px 6px, 8px 0, 12px 6px, 16px 0, 20px 6px, 24px 0, 28px 6px, 32px 0, 36px 6px, 40px 0, 44px 6px, 48px 0, 52px 6px, 56px 0, 60px 6px, 64px 0, 68px 6px, 72px 0, 76px 6px, 80px 0, 84px 6px, 88px 0, 92px 6px, 96px 0, 100% 0, 100% 100%, 0 100%); }

.${PREFIX}zone__head {
  flex: 0 0 auto;
  padding: 3px 8px;
  text-transform: uppercase;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #030B0C;
  background: #16A69B;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.${PREFIX}zone--queue .${PREFIX}zone__head { background: #E9A928; }
.${PREFIX}zone--archive .${PREFIX}zone__head { background: #E86836; }
.${PREFIX}zone__hint {
  flex: 0 0 auto;
  padding: 2px 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #759C96;
  text-transform: uppercase;
  border-bottom: 1px solid #0A3435;
}
.${PREFIX}zone__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scrollbar-width: thin;
}
.${PREFIX}zone--inbox .${PREFIX}zone__body { gap: 2px; }
.${PREFIX}zone__empty {
  margin: auto;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #2c4b4a;
}

.${PREFIX}slot { display: flex; align-items: stretch; gap: 4px; }
.${PREFIX}slot__num {
  flex: 0 0 auto;
  width: 22px;
  padding-top: 4px;
  text-align: right;
  font-size: 12px;
  color: #759C96;
}
.${PREFIX}slot > .${PREFIX}card { flex: 1 1 auto; min-width: 0; }

.${PREFIX}card {
  position: relative;
  box-sizing: border-box;
  height: 96px;
  display: flex;
  flex-direction: column;
  background: #0A3435;
  border: 1px solid #C8A878;
  padding: 0;
  touch-action: none;
  cursor: grab;
  transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, filter 120ms ease;
}
.${PREFIX}card:hover { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.25); }
.${PREFIX}card:focus-visible { outline: 1px solid #E9A928; outline-offset: 1px; }
.${PREFIX}zone--archive .${PREFIX}card { opacity: 0.55; filter: saturate(0.4); }
.${PREFIX}zone--archive .${PREFIX}card:hover { opacity: 1; filter: none; }

.${PREFIX}card__status {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #030B0C;
  background: #16A69B;
}
.${PREFIX}card--done .${PREFIX}card__status { background: #759C96; }
.${PREFIX}card--alert .${PREFIX}card__status { background: #F0713E; }
.${PREFIX}card--alert { border-color: #F0713E; }
.${PREFIX}card__badge {
  padding: 0 4px;
  background: #030B0C;
  color: #759C96;
  font-size: 10px;
}
.${PREFIX}card__badge--own { color: #E9A928; }
.${PREFIX}card__meta { display: flex; align-items: center; gap: 4px; }
.${PREFIX}card__mark {
  width: 8px; height: 8px; border-radius: 50%;
  background: #030B0C;
  animation: ${PREFIX}blink 900ms steps(2, end) infinite;
}
.${PREFIX}card__text {
  flex: 1 1 auto;
  margin: 0;
  padding: 4px 6px 0;
  font-size: 13px;
  line-height: 1.2;
  color: #D3DED5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
}
.${PREFIX}card__foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 2px 4px;
}
.${PREFIX}card__id { font-size: 11px; color: #759C96; }
/* Приоритет намеренно тихий: он должен читаться, но не кричать вместо текста. */
.${PREFIX}card__prio {
  display: inline-block;
  min-width: 20px;
  text-align: center;
  color: #C8A878;
}
/* Не запрошен — заштрихованная плашка «поле не подгружено», как ручка драга. */
.${PREFIX}card__prio--hidden {
  height: 9px;
  vertical-align: -1px;
  background: repeating-linear-gradient(-45deg, #C8A878 0 1px, transparent 1px 4px);
  opacity: 0.5;
}
.${PREFIX}card__prio--probe { color: #E9A928; }
.${PREFIX}card__actions { display: flex; gap: 2px; }
.${PREFIX}card__actions .${PREFIX}sq { width: 22px; height: 20px; font-size: 11px; }
.${PREFIX}card__grip {
  width: 12px; height: 10px; margin-left: 2px;
  background: repeating-linear-gradient(-45deg, #C8A878 0 1px, transparent 1px 4px);
  cursor: grab;
}
.${PREFIX}card__corner {
  position: absolute;
  width: 6px; height: 6px;
  border: 1px solid #C8A878;
  pointer-events: none;
}
.${PREFIX}card__corner:nth-of-type(1) { top: 1px; left: 1px; border-right: 0; border-bottom: 0; }
.${PREFIX}card__corner:nth-of-type(2) { top: 1px; right: 1px; border-left: 0; border-bottom: 0; }
.${PREFIX}card__corner:nth-of-type(3) { bottom: 1px; left: 1px; border-right: 0; border-top: 0; }
.${PREFIX}card__corner:nth-of-type(4) { bottom: 1px; right: 1px; border-left: 0; border-top: 0; }

.${PREFIX}card--drag {
  position: fixed;
  z-index: 40;
  left: 0; top: 0;
  margin: 0;
  pointer-events: none;
  cursor: grabbing;
  border-color: #5DE2D0;
  box-shadow: 0 0 14px rgba(93,226,208,0.4);
  opacity: 1 !important;
  filter: none !important;
}
.${PREFIX}ph {
  border: 1px dashed #16A69B;
  background: rgba(22,166,155,0.06);
  box-sizing: border-box;
}
.${PREFIX}insert {
  height: 2px;
  background: #E9A928;
  box-shadow: 0 0 6px rgba(233,169,40,0.6);
  flex: 0 0 auto;
}
.${PREFIX}card--deal { animation: ${PREFIX}deal 200ms ease both; animation-delay: calc(var(--i) * ${DEAL_STEP_MS}ms); }

.${PREFIX}footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  background: #062326;
  border: 1px solid #0A3435;
}
.${PREFIX}confirm {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 18px;
  background: #0A3435;
  border: 1px solid #759C96;
  box-shadow: inset 0 0 0 1px #062326;
  color: #759C96;
  font: inherit;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 0;
  cursor: not-allowed;
  transition: border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
.${PREFIX}confirm:enabled {
  border-color: #E9A928;
  color: #E9A928;
  cursor: pointer;
  animation: ${PREFIX}pulse 220ms ease 1;
}
.${PREFIX}confirm:enabled:hover { box-shadow: 0 0 10px rgba(233,169,40,0.35), inset 0 0 0 1px #062326; }
.${PREFIX}note { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #759C96; }

.${PREFIX}fallback {
  margin: auto;
  max-width: 420px;
  border: 1px solid #F0713E;
  background: #062326;
  text-align: center;
}
.${PREFIX}fallback__status {
  padding: 2px 8px;
  background: #F0713E;
  color: #030B0C;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: 12px;
}
.${PREFIX}fallback p { margin: 0; padding: 16px 12px; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: #D3DED5; }
.${PREFIX}fallback .${PREFIX}confirm { margin: 0 12px 14px; }

.${PREFIX}scan {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: #5DE2D0;
  box-shadow: 0 0 12px rgba(93,226,208,0.7);
  pointer-events: none;
  z-index: 30;
  animation: ${PREFIX}scan ${SCAN_MS}ms linear 1;
}

@keyframes ${PREFIX}deal { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
@keyframes ${PREFIX}blink { 50% { opacity: 0.15; } }
@keyframes ${PREFIX}pulse { from { box-shadow: 0 0 16px rgba(233,169,40,0.7); } to { box-shadow: none; } }
@keyframes ${PREFIX}scan { from { top: 0; } to { top: 100%; } }
`;

// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): {
  destroy: () => void;
  setVolume: (v: { muted: boolean; musicVolume: number; sfxVolume: number }) => void;
} {
  const styleEl = el('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = el('div', `${PREFIX}root`);
  container.appendChild(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`)));

  // --- config ---
  const playerName = (typeof config.playerName === 'string' && config.playerName.trim()) || 'Олег';
  const attemptsAllowed = Math.max(1, Math.min(5, Math.round(Number(config.attempts)) || 2));
  const winThreshold = Number.isFinite(Number(config.winThresholdPercent))
    ? Math.max(0, Math.min(100, Math.round(Number(config.winThresholdPercent))))
    : 100;
  const tasks = normalizeTasks(config.tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const total = tasks.length;

  // --- state ---
  let muted = config.muted === true;
  let finished = false;
  const gain = (v: unknown, fallback: number): number =>
    Math.max(0, Math.min(100, typeof v === 'number' && Number.isFinite(v) ? v : fallback)) / 100;
  let musicGain = gain(config.musicVolume, 100);
  let sfxGain = gain(config.sfxVolume, 100);
  let phase: 'deal' | 'sort' | 'checking' | 'done' = 'deal';
  let attemptsUsed = 0;
  let mistakeIds = new Set<string>();
  let inbox = shuffle(
    tasks.map((t) => t.id),
    Date.now(),
  );
  let queue: string[] = [];
  let archive: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // Приоритет, уже подгруженный игроком. Протухает, как только карточку
  // сдвинули: держать его до конца смены значило бы «запросил один раз и
  // разложил на память», а интерфейс диспетчерской должен мешать.
  const revealed = new Set<string>();
  const probes = new Set<ReturnType<typeof setInterval>>();
  let rafId = 0;

  function later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  // --- audio ---
  const audioCache = new Map<string, HTMLAudioElement>();

  function play(value: AudioValue | undefined): void {
    if (muted) return;
    const sound = pickSound(value);
    if (!sound) return;
    let base = audioCache.get(sound.url);
    if (!base) {
      base = new Audio(sound.url);
      base.preload = 'auto';
      audioCache.set(sound.url, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = Math.max(0, Math.min(1, (sound.volume / 100) * sfxGain));
    node.play().catch(() => {});
  }

  const musicSound = pickSound(config.music);
  const music = musicSound ? new Audio(musicSound.url) : null;
  if (music) music.loop = true;

  function applyMusicVolume(): void {
    if (!music || !musicSound) return;
    music.volume = Math.max(0, Math.min(1, (musicSound.volume / 100) * MUSIC_GAIN * musicGain));
  }

  function syncMusic(): void {
    if (!music) return;
    applyMusicVolume();
    // Ползунок в нуле — это тоже «не играть», иначе трек крутится вхолостую.
    if (muted || finished || musicGain === 0) music.pause();
    else void music.play().catch(() => {});
  }
  applyMusicVolume();

  function stopMusic(): void {
    if (!music) return;
    music.pause();
    // Пустой src резолвится в адрес страницы — элемент заново лезет в неё за
    // ресурсом и сыплет MEDIA_ELEMENT_ERROR. Снимаем атрибут вместо этого.
    // Вызывается дважды на обычном финише (fadeOut, потом destroy) — второй
    // раз атрибута уже нет, дальше pause() и делать нечего.
    if (music.hasAttribute('src')) {
      music.removeAttribute('src');
      music.load();
    }
  }

  // --- finish latches ---
  function fadeOut(cb: () => void): void {
    stopMusic();
    root.classList.remove(`${PREFIX}visible`);
    later(cb, FADE_MS);
  }

  function fireExit(): void {
    if (finished) return;
    finished = true;
    phase = 'done';
    fadeOut(() => callbacks.onExit());
  }

  // --- empty config fallback (§7) ---
  if (total === 0) {
    const box = el('div', `${PREFIX}fallback`);
    const status = el('div', `${PREFIX}fallback__status`);
    status.textContent = 'ALERT';
    const text = el('p');
    text.textContent = 'Конфиг пуст · задачи не загружены';
    const exitBtn = el('button', `${PREFIX}confirm`);
    exitBtn.textContent = 'Завершить';
    exitBtn.disabled = false;
    exitBtn.addEventListener('click', fireExit);
    box.append(status, text, exitBtn);
    root.appendChild(box);
    return {
      destroy(): void {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        stopMusic();
        container.innerHTML = '';
      },
      setVolume(): void {
        /* нечего озвучивать: игра не поднялась */
      },
    };
  }

  // --- chrome ---
  const topbar = el('div', `${PREFIX}topbar`);
  const title = el('div', `${PREFIX}title`);
  title.textContent = 'Смена · разбор входящих';
  const msgEl = el('div', `${PREFIX}msg`);
  msgEl.textContent = 'Свои активные — в очередь по срочности, остальное — в архив';
  const muteBtn = el('button', `${PREFIX}sq`);
  muteBtn.setAttribute('aria-label', 'Звук');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    syncMusic();
  });
  topbar.append(title, msgEl, muteBtn);

  syncMusic();
  // Автоплей глушится до первого жеста в документе, а игра монтируется под
  // брифинговым оверлеем, который этот жест и съедает.
  // ponytail: одна попытка добора на первом pointerdown, дальше не пытаемся.
  root.addEventListener('pointerdown', syncMusic, { once: true });

  const zonesEl = el('div', `${PREFIX}zones`);
  const bodies: Record<Zone, HTMLElement> = {
    inbox: el('div', `${PREFIX}zone__body`),
    queue: el('div', `${PREFIX}zone__body`),
    archive: el('div', `${PREFIX}zone__body`),
  };

  function buildZone(zone: Zone, head: string, hint?: string): HTMLElement {
    const section = el('section', `${PREFIX}zone ${PREFIX}zone--${zone}`);
    section.dataset.zone = zone;
    const header = el('div', `${PREFIX}zone__head`);
    const label = el('span');
    label.textContent = head;
    const count = el('span', `${PREFIX}mono`);
    count.dataset.count = zone;
    header.append(label, count);
    section.appendChild(header);
    if (hint) {
      const hintEl = el('div', `${PREFIX}zone__hint`);
      hintEl.textContent = hint;
      section.appendChild(hintEl);
    }
    section.appendChild(bodies[zone]);
    return section;
  }

  zonesEl.append(
    buildZone('inbox', 'Входящие'),
    buildZone('queue', `Очередь · ${playerName}`, '↑ P1 срочное   ·   ↓ P4 подождёт   ·   навести = запросить'),
    buildZone('archive', 'Архив // шреддер'),
  );

  const footer = el('div', `${PREFIX}footer`);
  const confirmBtn = el('button', `${PREFIX}confirm`);
  const stamp = el('span');
  stamp.textContent = '▣';
  stamp.setAttribute('aria-hidden', 'true');
  const confirmLabel = el('span');
  confirmLabel.textContent = 'Подтвердить смену';
  confirmBtn.append(stamp, confirmLabel);
  const noteEl = el('div', `${PREFIX}note`);
  footer.append(confirmBtn, noteEl);

  root.append(topbar, zonesEl, footer);

  // --- state mutation (single path for drag and buttons) ---
  function arrOf(zone: Zone): string[] {
    return zone === 'inbox' ? inbox : zone === 'queue' ? queue : archive;
  }

  function zoneOf(id: string): Zone {
    return queue.includes(id) ? 'queue' : archive.includes(id) ? 'archive' : 'inbox';
  }

  function place(id: string, zone: Zone, index?: number): void {
    inbox = inbox.filter((x) => x !== id);
    queue = queue.filter((x) => x !== id);
    archive = archive.filter((x) => x !== id);
    const target = arrOf(zone);
    target.splice(index === undefined ? target.length : Math.max(0, Math.min(target.length, index)), 0, id);
    mistakeIds.delete(id); // "touched" clears the ALERT stripe
    play(zone === 'archive' ? config.sounds?.shred : config.sounds?.drop);
    reportProgress();
    render();
  }

  function swapInQueue(id: string, delta: number): void {
    const i = queue.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= queue.length) return;
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
    mistakeIds.delete(id);
    play(config.sounds?.drop);
    render();
  }

  let lastProgress = -1;
  function reportProgress(): void {
    if (attemptsUsed > 0) return; // after a failed check the message is fixed
    if (inbox.length === lastProgress) return;
    lastProgress = inbox.length;
    const sorted = total - inbox.length;
    callbacks.onProgress?.(`РАЗОБРАНО: ${sorted} / ${total}`, (sorted / total) * 100);
  }

  // --- rendering ---
  function actionButton(label: string, icon: string, task: Task, onClick: () => void, disabled = false): HTMLButtonElement {
    const btn = el('button', `${PREFIX}sq`);
    btn.textContent = icon;
    btn.disabled = disabled;
    btn.setAttribute('aria-label', `${label}: ${task.text.slice(0, 40)}…`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (phase !== 'sort') return;
      onClick();
    });
    return btn;
  }

  function cardEl(task: Task, zone: Zone, index: number, dealing: boolean): HTMLElement {
    const card = el('article', `${PREFIX}card`);
    card.dataset.id = task.id;
    card.tabIndex = 0;
    card.title = task.text;
    // Приоритет в label не пишем: он раскрывается запросом, в том числе для скринридера.
    card.setAttribute('aria-label', `${task.done ? 'Выполнено' : 'Активно'}, ${task.assignee}: ${task.text}`);
    if (task.done) card.classList.add(`${PREFIX}card--done`);
    if (mistakeIds.has(task.id)) card.classList.add(`${PREFIX}card--alert`);
    if (dealing) {
      card.classList.add(`${PREFIX}card--deal`);
      card.style.setProperty('--i', String(index));
    }

    const status = el('div', `${PREFIX}card__status`);
    const statusText = el('span');
    statusText.textContent = mistakeIds.has(task.id)
      ? '! ALERT'
      : task.done
        ? 'Выполнено'
        : 'Активно';
    const meta = el('span', `${PREFIX}card__meta`);
    const isPlayers = task.assignee.trim().toLowerCase() === playerName.trim().toLowerCase();
    const badge = el('span', `${PREFIX}card__badge${isPlayers ? ` ${PREFIX}card__badge--own` : ''}`);
    badge.textContent = task.assignee.toUpperCase();
    meta.appendChild(badge);
    if (mistakeIds.has(task.id)) meta.appendChild(el('span', `${PREFIX}card__mark`));
    status.append(statusText, meta);

    const text = el('p', `${PREFIX}card__text`);
    text.textContent = task.text;

    const foot = el('div', `${PREFIX}card__foot`);
    const ticket = el('span', `${PREFIX}card__id ${PREFIX}mono`);
    ticket.textContent = `TK-${String(417 + Number(task.id.slice(1)) * 13).padStart(4, '0')} · `;
    // Слот стоит на КАЖДОЙ карточке, включая чужие и выполненные: пустое место
    // само стало бы подсказкой «эту в архив».
    const prio = el('span', `${PREFIX}card__prio`);
    ticket.appendChild(prio);

    // Запрос приоритета: наведение (или фокус) на карточку, спиннер, потом число.
    let probe: ReturnType<typeof setInterval> | null = null;

    function paintPrio(): void {
      const known = revealed.has(task.id);
      prio.className = `${PREFIX}card__prio${known ? '' : ` ${PREFIX}card__prio--hidden`}`;
      prio.textContent = known ? `P${task.priority}` : '';
      prio.setAttribute('aria-label', known ? `приоритет ${task.priority}` : 'приоритет не запрошен');
    }

    function stopProbe(): void {
      if (!probe) return;
      clearInterval(probe);
      probes.delete(probe);
      probe = null;
      paintPrio();
    }

    function startProbe(): void {
      if (probe || revealed.has(task.id) || phase === 'deal') return;
      // Проводка курсором по стопке поднимает запрос на каждой карточке —
      // без зазора это очередь из щелчков вместо одного звука.
      const now = Date.now();
      if (now - lastProbeSoundAt >= PROBE_SOUND_GAP_MS) {
        lastProbeSoundAt = now;
        play(config.sounds?.probe);
      }
      // Уход курсора до конца обрывает запрос — иначе достаточно мазнуть по
      // стопке и вернуться за готовыми ответами.
      let tick = 0;
      const need = probeTicks(Math.random());
      prio.className = `${PREFIX}card__prio ${PREFIX}card__prio--probe`;
      prio.textContent = SPINNER[0]!;
      prio.setAttribute('aria-label', 'приоритет запрашивается');
      probe = setInterval(() => {
        tick++;
        if (tick >= need) {
          revealed.add(task.id);
          play(config.sounds?.probeDone);
          stopProbe();
          return;
        }
        prio.textContent = SPINNER[tick % SPINNER.length]!;
      }, PROBE_TICK_MS);
      probes.add(probe);
    }

    paintPrio();
    card.addEventListener('pointerenter', startProbe);
    card.addEventListener('pointerleave', stopProbe);
    card.addEventListener('focus', startProbe);
    card.addEventListener('blur', stopProbe);
    const actions = el('div', `${PREFIX}card__actions`);
    if (zone === 'queue') {
      actions.append(
        actionButton('Выше', '▲', task, () => swapInQueue(task.id, -1), index === 0),
        actionButton('Ниже', '▼', task, () => swapInQueue(task.id, 1), index === queue.length - 1),
        actionButton('В архив', '⌦', task, () => place(task.id, 'archive')),
        actionButton('Во входящие', '←', task, () => place(task.id, 'inbox')),
      );
    } else if (zone === 'inbox') {
      actions.append(
        actionButton('В очередь', '→', task, () => place(task.id, 'queue')),
        actionButton('В архив', '⌦', task, () => place(task.id, 'archive')),
      );
    } else {
      actions.append(
        actionButton('В очередь', '→', task, () => place(task.id, 'queue')),
        actionButton('Во входящие', '←', task, () => place(task.id, 'inbox')),
      );
    }
    const grip = el('span', `${PREFIX}card__grip`);
    foot.append(ticket, actions, grip);

    card.append(status, text, foot);
    for (let i = 0; i < 4; i++) card.appendChild(el('i', `${PREFIX}card__corner`));

    card.addEventListener('pointerdown', (e) => onPointerDown(e, task.id, card));
    card.addEventListener('keydown', (e) => {
      if (phase !== 'sort' || !e.altKey) return;
      if (e.key === 'ArrowUp' && zoneOf(task.id) === 'queue') {
        e.preventDefault();
        swapInQueue(task.id, -1);
      } else if (e.key === 'ArrowDown' && zoneOf(task.id) === 'queue') {
        e.preventDefault();
        swapInQueue(task.id, 1);
      }
    });
    return card;
  }

  let dealing = true;
  /**
   * Собственная «пустота» входящих, отдельно от phase — иначе провал
   * проверки (phase дёргается в 'checking' и обратно в 'sort', пока входящие
   * не менялись) перевзводит звук разблокировки следом за звуком ошибки.
   */
  let wasInboxEmpty = false;
  let lastProbeSoundAt = 0;

  function render(): void {
    // Карточки пересоздаются целиком, поэтому запрос приоритета на старом узле
    // надо оборвать: иначе он дотикает в отрыве от DOM и раскроет поле сам.
    for (const p of probes) clearInterval(p);
    probes.clear();
    for (const zone of ['inbox', 'queue', 'archive'] as Zone[]) {
      const body = bodies[zone];
      body.innerHTML = '';
      const ids = arrOf(zone);
      const counter = zonesEl.querySelector<HTMLElement>(`[data-count="${zone}"]`);
      if (counter) counter.textContent = String(ids.length);
      if (ids.length === 0) {
        const empty = el('div', `${PREFIX}zone__empty`);
        empty.textContent = zone === 'inbox' ? 'пусто · можно подтверждать' : 'пусто';
        body.appendChild(empty);
        continue;
      }
      ids.forEach((id, index) => {
        const task = byId.get(id);
        if (!task) return;
        const card = cardEl(task, zone, index, dealing && zone === 'inbox');
        if (zone === 'queue') {
          const slot = el('div', `${PREFIX}slot`);
          const num = el('span', `${PREFIX}slot__num ${PREFIX}mono`);
          num.textContent = String(index + 1).padStart(2, '0');
          slot.append(num, card);
          body.appendChild(slot);
        } else {
          body.appendChild(card);
        }
      });
    }

    const inboxEmpty = inbox.length === 0;
    const ready = inboxEmpty && phase === 'sort';
    if (shouldPlayReadyCue(inboxEmpty, phase === 'sort', wasInboxEmpty)) play(config.sounds?.ready);
    wasInboxEmpty = inboxEmpty;
    confirmBtn.disabled = !ready;
    noteEl.textContent = ready
      ? `Попытка ${attemptsUsed + 1} из ${attemptsAllowed}`
      : `Осталось во входящих: ${inbox.length}`;
  }

  // --- drag & drop (pointer events, see §2.1) ---
  interface Drag {
    id: string;
    card: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    x: number;
    y: number;
    active: boolean;
    placeholder: HTMLElement | null;
    insert: HTMLElement | null;
    hoverZone: Zone | null;
    hoverBody: HTMLElement | null;
    insertIndex: number | null;
  }
  let drag: Drag | null = null;

  function clearZoneHover(): void {
    zonesEl.querySelectorAll(`.${PREFIX}zone`).forEach((s) => s.classList.remove(`${PREFIX}hover`));
  }

  function onPointerDown(e: PointerEvent, id: string, card: HTMLElement): void {
    if (phase !== 'sort' || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = card.getBoundingClientRect();
    drag = {
      id,
      card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      x: e.clientX,
      y: e.clientY,
      active: false,
      placeholder: null,
      insert: null,
      hoverZone: null,
      hoverBody: null,
      insertIndex: null,
    };
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      /* element may already be gone */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function beginDrag(d: Drag): void {
    d.active = true;
    const holderTarget = d.card.parentElement!; // slot wrapper in queue, body elsewhere
    const holder = holderTarget.classList.contains(`${PREFIX}slot`) ? holderTarget : d.card;
    const ph = el('div', `${PREFIX}ph`);
    ph.style.height = `${holder.getBoundingClientRect().height}px`;
    holder.parentElement!.insertBefore(ph, holder);
    d.placeholder = ph;
    holder.remove();
    d.card.classList.add(`${PREFIX}card--drag`);
    d.card.style.width = `${d.width}px`;
    d.card.style.height = `${d.height}px`;
    root.appendChild(d.card);
    play(config.sounds?.pick);
  }

  function onPointerMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) < DRAG_THRESHOLD) return;
    if (!d.active) beginDrag(d);
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(): void {
    rafId = 0;
    const d = drag;
    if (!d || !d.active) return;
    const left = d.x - d.offsetX;
    const top = d.y - d.offsetY;
    d.card.style.transform = `translate(${left}px, ${top}px) rotate(-1.5deg)`;

    // Zone under the card's centre — steadier than under the cursor.
    const under = document.elementFromPoint(left + d.width / 2, top + d.height / 2);
    const section = under?.closest<HTMLElement>(`.${PREFIX}zone`) ?? null;
    const zone = (section?.dataset.zone as Zone | undefined) ?? null;
    if (zone !== d.hoverZone) {
      clearZoneHover();
      section?.classList.add(`${PREFIX}hover`);
      d.hoverZone = zone;
      d.hoverBody = zone ? bodies[zone] : null;
      d.insert?.remove();
      d.insert = null;
    }

    if (d.hoverBody) {
      // autoscroll near the zone edges
      const r = d.hoverBody.getBoundingClientRect();
      if (d.y - r.top < 48) d.hoverBody.scrollTop -= 12;
      else if (r.bottom - d.y < 48) d.hoverBody.scrollTop += 12;
    }

    if (d.hoverZone === 'queue') {
      const centreY = top + d.height / 2;
      const slots = Array.from(bodies.queue.children).filter((c) => !c.classList.contains(`${PREFIX}insert`));
      let index = slots.length;
      for (let i = 0; i < slots.length; i++) {
        const r = slots[i]!.getBoundingClientRect();
        if (r.top + r.height / 2 > centreY) {
          index = i;
          break;
        }
      }
      if (index !== d.insertIndex || !d.insert) {
        d.insert?.remove();
        d.insert = el('div', `${PREFIX}insert`);
        bodies.queue.insertBefore(d.insert, slots[index] ?? null);
        d.insertIndex = index;
      }
    } else {
      d.insert?.remove();
      d.insert = null;
      d.insertIndex = null;
    }
  }

  function cleanupDrag(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    clearZoneHover();
    const d = drag;
    drag = null;
    if (!d) return;
    try {
      d.card.releasePointerCapture(d.pointerId);
    } catch {
      /* pointer or element already released */
    }
    d.insert?.remove();
    // Only a real drag detached the card from its zone; a plain click must not.
    if (d.active) {
      d.card.remove();
      d.placeholder?.remove();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      cleanupDrag();
      return; // a plain click, not a drag
    }
    const zone = d.hoverZone;
    const index = d.insertIndex;
    const id = d.id;
    if (!zone || phase !== 'sort') {
      // a check may have started under a second pointer — keep the layout intact
      returnToPlace(d);
      return;
    }
    cleanupDrag();
    // The insert index was measured on a list that already lacks the dragged
    // card (its slot is pulled out of the DOM at drag start), and `place`
    // removes the id before splicing — so the index needs no adjustment.
    place(id, zone, zone === 'queue' && index !== null ? index : undefined);
  }

  function onPointerCancel(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      cleanupDrag();
      return;
    }
    returnToPlace(d);
  }

  function returnToPlace(d: Drag): void {
    const rect = d.placeholder?.getBoundingClientRect();
    if (rect) {
      d.card.style.transition = `transform ${RETURN_MS}ms ease`;
      d.card.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    }
    later(() => {
      cleanupDrag();
      render();
    }, RETURN_MS);
    // stop tracking the pointer immediately; cleanup happens after the animation
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  // --- check / finish ---
  confirmBtn.addEventListener('click', () => {
    if (phase !== 'sort' || inbox.length > 0 || finished) return;
    phase = 'checking';
    play(config.sounds?.scan);
    render();
    const scan = el('div', `${PREFIX}scan`);
    zonesEl.style.position = 'relative';
    zonesEl.appendChild(scan);
    later(() => {
      scan.remove();
      resolveCheck();
    }, SCAN_MS);
  });

  function resolveCheck(): void {
    attemptsUsed++;
    const result = evaluate(queue, archive, tasks, playerName);
    if (result.perfect || attemptsUsed >= attemptsAllowed) {
      finish(result);
      return;
    }
    mistakeIds = new Set(result.mistakeIds);
    phase = 'sort';
    msgEl.textContent = `Обнаружены несоответствия: ${result.mistakeIds.length}. Проверьте отмеченное.`;
    msgEl.classList.add(`${PREFIX}alert`);
    play(config.sounds?.error);
    callbacks.onProgress?.(`ИСПРАВЬТЕ ОТМЕЧЕННОЕ · ПОПЫТКА ${attemptsUsed + 1} ИЗ ${attemptsAllowed}`);
    render();
  }

  function finish(result: ReturnType<typeof evaluate>): void {
    if (finished) return;
    finished = true;
    phase = 'done';
    const won = result.perfect || (winThreshold > 0 && result.percent >= winThreshold);
    const details: Record<string, number | string> = {
      mistakes: result.mistakes.length,
      archivedOwnActive: result.mistakes.filter((m) => m.kind === 'archived-own-active').length,
      queuedForeignOrDone: result.mistakes.filter((m) => m.kind === 'queued-foreign-or-done').length,
      orderInversions: result.mistakes.filter((m) => m.kind === 'order-inversion').length,
      attemptsUsed,
      percent: result.percent,
    };
    if (won) details.styleTag = styleTagFor(result, attemptsUsed);
    mistakeIds = won ? new Set() : new Set(result.mistakeIds);
    msgEl.textContent = won
      ? `Смена принята · ${result.score} из ${maxScoreFor(tasks, playerName)}`
      : `Смена не принята · ${result.percent}%`;
    msgEl.classList.toggle(`${PREFIX}alert`, !won);
    play(won ? config.sounds?.confirm : config.sounds?.error);
    callbacks.onProgress?.(won ? 'СМЕНА ПРИНЯТА' : 'СМЕНА НЕ ПРИНЯТА', 100);
    render();
    fadeOut(() => callbacks.onComplete({ score: result.score, won, details }));
  }

  // --- start: РАСКЛАДКА ---
  render();
  reportProgress();
  play(config.sounds?.deal);
  later(
    () => {
      dealing = false;
      phase = 'sort';
      render();
    },
    Math.min(600, total * DEAL_STEP_MS) + 200,
  );

  return {
    // Общий регулятор в шапке плеера; локальная кнопка 🔊 остаётся быстрым
    // переключателем, но глобальная настройка её перебивает.
    setVolume(v): void {
      musicGain = gain(v.musicVolume, 100);
      sfxGain = gain(v.sfxVolume, 100);
      muted = v.muted === true;
      muteBtn.textContent = muted ? '🔇' : '🔊';
      syncMusic();
    },
    destroy(): void {
      cleanupDrag();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const p of probes) clearInterval(p);
      probes.clear();
      if (rafId) cancelAnimationFrame(rafId);
      for (const audio of audioCache.values()) {
        audio.pause();
        // Тот же случай, что и в stopMusic(): пустой src бьёт по документу.
        audio.removeAttribute('src');
        audio.load();
      }
      audioCache.clear();
      stopMusic();
      container.innerHTML = '';
    },
  };
}
