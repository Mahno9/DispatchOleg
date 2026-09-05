import {
  cancelHold,
  currentOrder,
  currentStep,
  cookWindow,
  doseWindow,
  endCook,
  endPour,
  initialState,
  normalize,
  pickIngredient,
  progress,
  resolveOrderDone,
  resolveSpoiled,
  resolveWipe,
  startCook,
  startPour,
  styleTagFor,
  tickHold,
  type State,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / callbacks
// ---------------------------------------------------------------------------

type WeightedAudio = { url: string; weight: number; volume?: number };
type AudioValue = string | WeightedAudio[];

interface GameConfig {
  ingredients?: unknown;
  characters?: unknown;
  fillRatePerSec?: number;
  doseTolerancePct?: number;
  cookTolerancePct?: number;
  failsAllowed?: number;
  pointsPerStep?: number;
  pointsPerOrder?: number;
  spoilAnimationMs?: number;
  sounds?: {
    place?: AudioValue;
    pourLoop?: AudioValue;
    pourOk?: AudioValue;
    cookLoop?: AudioValue;
    orderDone?: AudioValue;
    fail?: AudioValue;
    wipe?: AudioValue;
  };
  muted?: boolean;
  /** 0…100 из общего регулятора плеера; живьём приходит через setVolume. Музыки тут нет — играют только SFX-петли. */
  musicVolume?: number;
  sfxVolume?: number;
}

interface Callbacks {
  onComplete: (result: { score: number; won: boolean; details?: Record<string, number | string> }) => void;
  onExit: () => void;
  onProgress?: (text: string, percent?: number) => void;
}

const PREFIX = 'co-';
const FADE_MS = 300;
const ORDER_DONE_MS = 600;
const WIPE_MS = 1500;
const FINISH_MS = 1200;
const INTERRUPT_MS = 900;
const RING_R = 58;
const RING_C = 2 * Math.PI * RING_R;

// ---------------------------------------------------------------------------
// Inline outline artwork — the default config ships no assets (§4.2), so every
// picture falls back to a glowing blueprint placeholder drawn from its id.
// ---------------------------------------------------------------------------

const GLYPHS = [
  'M9 3h6M10 3v5L5.5 18a3 3 0 0 0 2.7 4.2h7.6A3 3 0 0 0 18.5 18L14 8V3', // flask
  'M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM9 8V5h6v3M6 12h12', // jar
  'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z', // droplet
  'M20 4c0 9-5 14-12 15 0-9 4-14 12-15zM8 19c1-4 3-7 7-9', // leaf
  'M6 9h12v2l-3 1v9h-6v-9l-3-1zM10 9V4h4v5', // bolt
  'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z', // spark
  'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v18M4 7.5l8 4.5 8-4.5', // cube
  'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', // ring
];

const POT_SVG = `<svg viewBox="0 0 120 96" aria-hidden="true">
  <path d="M14 30h92v34a20 20 0 0 1-20 20H34a20 20 0 0 1-20-20z"/>
  <path d="M8 30h104M14 40h-8a5 5 0 0 0 0 10h8M106 40h8a5 5 0 0 1 0 10h-8"/>
  <path d="M40 22c0-6 4-10 4-14M60 20c0-7 4-10 4-16M80 22c0-6 4-10 4-14" class="${PREFIX}steam"/>
</svg>`;

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

// Thematic icons for the eight default ingredients (§4.2 defaults) — same
// visual language as GLYPHS: 24x24, stroke-only, no fills. Custom ingredients
// added via the admin fall back to the generic GLYPHS hash below.
const INGREDIENT_ICONS: Record<string, string> = {
  // stardust — four-point star with a short trail of dust dots
  stardust: `<path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/><circle cx="5.5" cy="17" r="0.9"/><circle cx="8" cy="20" r="0.7"/><circle cx="3.5" cy="20.5" r="0.5"/>`,
  // honey — dipper stick over a drop
  honey: `<path d="M12 13c3 3.4 4 5.6 4 7.2A4 4 0 0 1 4 20.2c0-1.6 1-3.8 4-7.2z"/><path d="M12 13V4M9 4h6M9.5 7h5"/>`,
  // hero-milk — bottle with a small star emblem
  'hero-milk': `<path d="M9.5 3h5v3.4l2 3V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-9.6l2-3z"/><path d="M7.5 12h9"/><path d="M12 15.2l0.9 1.9 2.1 0.3-1.5 1.5 0.4 2.1-1.9-1-1.9 1 0.4-2.1-1.5-1.5 2.1-0.3z"/>`,
  // cinnamon — two rolled sticks crossed
  cinnamon: `<path d="M4 8.5a2.2 2.2 0 1 1 4.4 0 2.2 2.2 0 0 1-4.4 0z"/><path d="M6.2 8.5L17 19.5"/><path d="M15.6 19.5a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0z"/><path d="M4.6 15.4L15.4 4.6"/>`,
  // dragon-coal — faceted lump with a small flame
  'dragon-coal': `<path d="M6 16c-1.4-1.8-1.4-4.2 0-6l3-3.4 3 2 3-2 3 3.4c1.4 1.8 1.4 4.2 0 6l-3 3.4H9z"/><path d="M12 8c0.8 1.4 1.4 2.3 1.4 3.2a1.4 1.4 0 1 1-2.8 0c0-0.9 0.6-1.8 1.4-3.2z"/>`,
  // sugar — two stacked cubes
  sugar: `<path d="M5 13h6v6H5zM13 13h6v6h-6zM9 5h6v6H9z"/>`,
  // moon-mint — crescent moon cradling a leaf
  'moon-mint': `<path d="M15.5 4a8 8 0 1 0 0 16 8 8 0 0 1 0-16z"/><path d="M10.5 12.5c2.4 0 4 1.6 4 4-2.4 0-4-1.6-4-4z"/><path d="M10.5 12.5c0-1.8 1-3 2.4-3.6"/>`,
  // iron-bolt — hexagonal bolt head + threaded shaft
  'iron-bolt': `<path d="M12 3l5.2 3v6L12 15l-5.2-3V6z"/><path d="M12 15v6M9.5 17.5h5M9.5 19.5h5M9.5 21h5"/>`,
};

function glyphSvg(seed: string): string {
  const themed = INGREDIENT_ICONS[seed];
  if (themed) return `<svg viewBox="0 0 24 24" aria-hidden="true">${themed}</svg>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[hash(seed) % GLYPHS.length]!}"/></svg>`;
}

const PORTRAIT_SVG = `<svg viewBox="0 0 60 72" aria-hidden="true">
  <path d="M30 12a11 11 0 1 1 0 22 11 11 0 0 1 0-22z"/>
  <path d="M8 68c0-13 10-21 22-21s22 8 22 21"/>
  <path d="M4 4h10M4 4v10M56 4H46M56 4v10"/>
</svg>`;

// ---------------------------------------------------------------------------
// Styles — scoped under .co-root, no global rules
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
  letter-spacing: 0.05em;
  text-transform: uppercase;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }
.${PREFIX}root * { box-sizing: border-box; }
.${PREFIX}mono { font-family: 'Share Tech Mono', 'IBM Plex Mono', ui-monospace, monospace; }
.${PREFIX}crt {
  position: absolute; inset: 0; z-index: 50; pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 4px);
  opacity: 0.7;
}

/* --- queue ------------------------------------------------------------- */
.${PREFIX}queue {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 8px;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
  padding: 4px;
}
.${PREFIX}cards { display: flex; gap: 2px; flex: 1 1 auto; min-width: 0; pointer-events: none; }
.${PREFIX}card {
  flex: 0 1 118px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #0A3435;
  border: 1px solid #C8A878;
  opacity: 0.55;
  filter: saturate(0.5);
  transition: opacity 160ms ease, filter 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.${PREFIX}card--active { opacity: 1; filter: none; border-color: #E9A928; box-shadow: 0 0 8px rgba(233,169,40,0.3); }
.${PREFIX}card--done { opacity: 0.45; }
.${PREFIX}card--alert { border-color: #F0713E; box-shadow: 0 0 10px rgba(240,113,62,0.45); }
.${PREFIX}card--enter { animation: ${PREFIX}mask 220ms ease both; }
.${PREFIX}card__status {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 4px;
  padding: 0 4px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
  color: #030B0C; background: #759C96;
}
.${PREFIX}card--active .${PREFIX}card__status { background: #E9A928; }
.${PREFIX}card--done .${PREFIX}card__status { background: #16A69B; }
.${PREFIX}card--alert .${PREFIX}card__status { background: #F0713E; }
.${PREFIX}dot { width: 7px; height: 7px; border-radius: 50%; background: #030B0C; opacity: 0.25; }
.${PREFIX}card--active .${PREFIX}dot { opacity: 1; animation: ${PREFIX}blink 1100ms steps(2, end) infinite; }
.${PREFIX}card__art {
  flex: 1 1 auto;
  position: relative;
  min-height: 48px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  background: #062326;
  border-bottom: 1px solid #0A3435;
}
.${PREFIX}card__art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.${PREFIX}card__art svg { width: 60%; height: 100%; fill: none; stroke: #16A69B; stroke-width: 1.6; }
.${PREFIX}card__initial {
  position: absolute; inset: auto 4px 2px auto;
  font-size: 20px; font-weight: 700; color: #16A69B; opacity: 0.5;
}
.${PREFIX}card__name {
  flex: 0 0 auto; padding: 1px 4px 0;
  font-size: 15px; font-weight: 700; letter-spacing: 0.08em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.${PREFIX}card__order {
  flex: 0 0 auto; padding: 0 4px 2px;
  font-size: 10px; line-height: 1.25; letter-spacing: 0.05em; color: #759C96;
  white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.${PREFIX}aside { flex: 0 0 auto; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; gap: 4px; }
.${PREFIX}fails { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #759C96; letter-spacing: 0.1em; }
.${PREFIX}fails i {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1px solid #759C96; background: transparent;
}
.${PREFIX}fails i.${PREFIX}spent { border-color: #F0713E; background: #F0713E; box-shadow: 0 0 6px rgba(240,113,62,0.6); }
.${PREFIX}sq {
  width: 28px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #0A3435; border: 1px solid #16A69B; border-radius: 0;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5; font: inherit; font-size: 13px; cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  pointer-events: auto;
}
.${PREFIX}sq:hover { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.35), inset 0 0 0 1px #062326; }
.${PREFIX}sq:focus-visible { outline: 1px solid #E9A928; outline-offset: 1px; }

/* --- middle ------------------------------------------------------------ */
.${PREFIX}mid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(150px, 210px) 1fr; gap: 6px; }
.${PREFIX}panel { background: #062326; border: 1px solid #0A3435; box-shadow: inset 0 0 0 1px #030B0C; display: flex; flex-direction: column; min-height: 0; }
.${PREFIX}panel__head {
  flex: 0 0 auto; padding: 2px 6px;
  font-size: 12px; font-weight: 700; line-height: 1.3; letter-spacing: 0.1em;
  color: #030B0C; background: #16A69B;
  white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.${PREFIX}recipe { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0; padding: 4px; list-style: none; scrollbar-width: thin; }
.${PREFIX}recipe li {
  display: flex; align-items: baseline; gap: 4px;
  padding: 2px 4px;
  font-size: 14px; color: #759C96;
  border-left: 2px solid transparent;
}
.${PREFIX}recipe li b { flex: 0 0 12px; font-weight: 400; color: #2c4b4a; }
.${PREFIX}recipe li span { flex: 1 1 auto; }
.${PREFIX}recipe li em { font-style: normal; color: #E9A928; }
.${PREFIX}recipe li.${PREFIX}done { color: #16A69B; opacity: 0.6; }
.${PREFIX}recipe li.${PREFIX}done em { color: inherit; }
.${PREFIX}recipe li.${PREFIX}now { color: #E9A928; border-left-color: #E9A928; background: rgba(233,169,40,0.08); }
.${PREFIX}recipe li.${PREFIX}now b { color: #E9A928; }
.${PREFIX}glitch { animation: ${PREFIX}glitch 180ms steps(2, end) 5; }

.${PREFIX}stage { position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.${PREFIX}potwrap {
  position: relative;
  width: 210px; max-width: 62%; max-height: 100%; aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.${PREFIX}ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.${PREFIX}ring circle { fill: none; stroke-width: 5; }
.${PREFIX}ring__track { stroke: #0A3435; }
.${PREFIX}ring__zone { stroke: #E9A928; opacity: 0; transition: opacity 140ms ease; }
.${PREFIX}ring__bar { stroke: #5DE2D0; }
.${PREFIX}stage--cook .${PREFIX}ring__zone { opacity: 0.5; }
.${PREFIX}pot {
  position: relative; width: 68%;
  border: 1px solid transparent;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.${PREFIX}pot svg { width: 100%; display: block; fill: none; stroke: #16A69B; stroke-width: 2; stroke-linecap: square; }
.${PREFIX}pot svg .${PREFIX}steam { stroke: #759C96; opacity: 0.35; }
/* Коробка заливки — внутренность котелка в единицах POT_SVG (120x96): стенки
   x 15..105, дно y 83, донные углы — четверть круга r~19. Проценты считаются от
   самой коробки (90 x 40.3 единицы), поэтому радиус разный по осям: 19/90 ~ 21%
   по горизонтали и 19/40.3 ~ 47% по вертикали. Без скругления прямоугольная
   заливка вылезала нижними углами за изгиб дна. */
.${PREFIX}pot__stack {
  position: absolute; left: 12.5%; right: 12.5%; bottom: 13.5%;
  height: 42%;
  display: flex; flex-direction: column-reverse;
  overflow: hidden;
  border-radius: 0 0 21% 21% / 0 0 47% 47%;
  pointer-events: none;
}
.${PREFIX}pot__layer {
  flex: 0 0 auto;
  width: 100%;
  height: 0;
  background: var(--co-hue, #16A69B);
  opacity: 0.35;
}
.${PREFIX}pot__layer--live { transition: none; }
.${PREFIX}stage--cook .${PREFIX}pot { border-color: #E9A928; box-shadow: 0 0 14px rgba(233,169,40,0.25); }
.${PREFIX}stage--spoiled .${PREFIX}pot { animation: ${PREFIX}alarm 260ms steps(2, end) 4; }
.${PREFIX}hint {
  position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%);
  font-size: 12px; letter-spacing: 0.14em; color: #E9A928;
  opacity: 0; transition: opacity 140ms ease; white-space: nowrap;
}
.${PREFIX}stage--cook .${PREFIX}hint { opacity: 1; animation: ${PREFIX}blink 900ms steps(2, end) infinite; }

.${PREFIX}gauge { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 26px; height: 72%; border: 1px solid #0A3435; background: #041518; opacity: 0; transition: opacity 140ms ease; }
.${PREFIX}stage--pour .${PREFIX}gauge { opacity: 1; }
.${PREFIX}gauge__zone { position: absolute; left: 0; right: 0; top: 0; bottom: auto; height: 0; background: rgba(233,169,40,0.22); border-top: none; border-bottom: 1px solid #E9A928; }
.${PREFIX}gauge__fill { position: absolute; left: 1px; right: 1px; bottom: 1px; height: 0; background: #5DE2D0; }
.${PREFIX}gauge__tick { position: absolute; left: 0; width: 7px; height: 1px; background: #759C96; }
.${PREFIX}gauge__cap { position: absolute; left: -2px; right: -2px; top: -1px; height: 2px; background: #E86836; }

/* --- shelf ------------------------------------------------------------- */
.${PREFIX}shelf {
  flex: 0 0 auto;
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px;
  padding: 4px;
  background: #062326; border: 1px solid #0A3435; box-shadow: inset 0 0 0 1px #030B0C;
  transition: opacity 140ms ease;
}
.${PREFIX}shelf--off { opacity: 0.3; }
.${PREFIX}cell {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 3px 2px;
  min-width: 0;
  background: #0A3435; border: 1px solid #759C96; border-radius: 0;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5; font: inherit; text-transform: uppercase; cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
  touch-action: none;
}
.${PREFIX}cell:hover { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.3), inset 0 0 0 1px #062326; }
.${PREFIX}cell:focus-visible { outline: 1px solid #E9A928; outline-offset: 1px; }
.${PREFIX}cell--held { border-color: #E9A928; background: #123c3a; box-shadow: 0 0 10px rgba(233,169,40,0.4), inset 0 0 0 1px #062326; }
.${PREFIX}cell--flash { animation: ${PREFIX}flash 220ms ease 1; }
.${PREFIX}cell__art { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
.${PREFIX}cell__art img { max-width: 100%; max-height: 100%; display: block; }
.${PREFIX}cell__art svg { width: 100%; height: 100%; fill: none; stroke: #5DE2D0; stroke-width: 1.4; }
.${PREFIX}cell__name { font-size: 11px; line-height: 1.05; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.${PREFIX}cell__unit { font-size: 9px; color: #759C96; letter-spacing: 0.06em; }

/* --- overlays ---------------------------------------------------------- */
.${PREFIX}banner {
  position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
  z-index: 40; padding: 2px 14px;
  font-size: 14px; font-weight: 700; letter-spacing: 0.16em;
  color: #030B0C; background: #F0713E; white-space: nowrap;
}
.${PREFIX}banner--calm { background: #16A69B; }
.${PREFIX}screen {
  position: absolute; inset: 0; z-index: 45;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  background: rgba(3,11,12,0.94);
  text-align: center;
}
.${PREFIX}screen h1 { margin: 0; font-size: clamp(28px, 8vw, 64px); font-weight: 700; letter-spacing: 0.14em; color: #F0713E; }
.${PREFIX}screen--win h1 { color: #E9A928; }
.${PREFIX}screen p { margin: 0; font-size: 15px; letter-spacing: 0.12em; color: #759C96; }
.${PREFIX}screen .${PREFIX}dot { width: 12px; height: 12px; background: #F0713E; opacity: 1; animation: ${PREFIX}blink 420ms steps(2, end) infinite; }
.${PREFIX}marks { display: flex; gap: 10px; }

.${PREFIX}fallback {
  margin: auto; max-width: 460px;
  border: 1px solid #F0713E; background: #062326; text-align: center;
}
.${PREFIX}fallback__status { padding: 2px 8px; background: #F0713E; color: #030B0C; font-weight: 700; letter-spacing: 0.1em; font-size: 12px; }
.${PREFIX}fallback p { margin: 0; padding: 16px 12px; font-size: 14px; letter-spacing: 0.08em; color: #D3DED5; }

@keyframes ${PREFIX}blink { 50% { opacity: 0.15; } }
@keyframes ${PREFIX}mask { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes ${PREFIX}flash { from { box-shadow: 0 0 16px rgba(93,226,208,0.8); } to { box-shadow: none; } }
@keyframes ${PREFIX}alarm { 50% { border-color: #F0713E; box-shadow: 0 0 24px rgba(240,113,62,0.6); } }
@keyframes ${PREFIX}glitch {
  0% { transform: none; }
  50% { transform: translateX(-2px) skewX(1.5deg); filter: hue-rotate(-25deg); }
  100% { transform: translateX(1px); }
}
@media (prefers-reduced-motion: reduce) {
  .${PREFIX}root * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
`;

// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Deterministic ingredient tint for the pot fill — blueprint-friendly hues only. */
function tint(id: string): string {
  return `hsl(${hash(id) % 360} 55% 55%)`;
}

/**
 * «×3 мерки» — count form of the unit name. Doses are 1…6 in practice, and the
 * default units are all feminine -ка nouns, so two rewrite rules cover them:
 * ложка → ложки / ложек, мерка → мерки / мерок.
 * ponytail: crude morphology, swap for a dictionary if admins add odd units.
 */
function plural(n: number, unit: string): string {
  const form = n % 100 >= 11 && n % 100 <= 14 ? 5 : n % 10 === 1 ? 1 : n % 10 >= 2 && n % 10 <= 4 ? 2 : 5;
  if (form === 1) return unit;
  if (!unit.endsWith('а')) return form === 2 ? `${unit}а` : `${unit}ов`;
  const stem = unit.slice(0, -1);
  if (form === 2) return `${stem}и`;
  return stem.endsWith('к') ? `${stem.slice(0, -1)}ок` : stem;
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

  const { cfg, ingredients, spoilAnimationMs, error } = normalize(config);
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  // --- config error panel (§6.6, §6.7): no onComplete, exit is the platform's --
  if (error) {
    const box = el('div', `${PREFIX}fallback`);
    const status = el('div', `${PREFIX}fallback__status`);
    status.textContent = 'ALERT';
    const text = el('p');
    text.textContent = error;
    box.append(status, text);
    root.append(box, el('div', `${PREFIX}crt`));
    return {
      destroy(): void {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        container.innerHTML = '';
      },
      setVolume(): void {
        /* нечего озвучивать: игра не поднялась */
      },
    };
  }

  const byId = new Map(ingredients.map((i) => [i.id, i]));

  // --- state ---
  let state = initialState();
  let muted = config.muted === true;
  let finished = false;
  let rafId = 0;
  let lastFrameAt = 0;
  let activePointerId: number | null = null;
  let captureEl: HTMLElement | null = null;
  /** set on pointerdown of a simple step: resolved on pointerup over the same cell (§2.2) */
  let pendingPick: string | null = null;
  let renderedOrder = -1;
  let lastProgress = '';
  let renderedPotOrder = -1;
  let renderedPotStep = -1;

  // --- audio ---
  const gainOf = (v: unknown, fallback: number): number =>
    Math.max(0, Math.min(100, typeof v === 'number' && Number.isFinite(v) ? v : fallback)) / 100;
  // Тут нет музыки — только SFX-петли (pourLoop/cookLoop), масштабируются sfxGain.
  let sfxGain = gainOf(config.sfxVolume, 100);
  const audioCache = new Map<string, HTMLAudioElement>();
  let loopAudio: HTMLAudioElement | null = null;
  let loopSound: { url: string; volume: number } | undefined;

  function pickSound(value: AudioValue | undefined): { url: string; volume: number } | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return { url: value, volume: 100 };
    if (!value.length) return undefined;
    let r = Math.random() * value.reduce((s, v) => s + (Number(v.weight) || 0), 0);
    for (const v of value) {
      r -= Number(v.weight) || 0;
      if (r <= 0) return { url: v.url, volume: Number(v.volume) || 100 };
    }
    const last = value[value.length - 1]!;
    return { url: last.url, volume: Number(last.volume) || 100 };
  }

  function audioFor(url: string): HTMLAudioElement {
    let base = audioCache.get(url);
    if (!base) {
      base = new Audio(url);
      base.preload = 'auto';
      audioCache.set(url, base);
    }
    return base;
  }

  function play(value: AudioValue | undefined): void {
    if (muted) return;
    const sound = pickSound(value);
    if (!sound) return;
    const node = audioFor(sound.url).cloneNode() as HTMLAudioElement;
    node.volume = Math.max(0, Math.min(1, (sound.volume / 100) * sfxGain));
    node.play().catch(() => {});
  }

  function applyLoopVolume(): void {
    if (!loopAudio || !loopSound) return;
    loopAudio.volume = Math.max(0, Math.min(1, (loopSound.volume / 100) * sfxGain));
  }

  function startLoop(value: AudioValue | undefined): void {
    stopLoop();
    if (muted) return;
    const sound = pickSound(value);
    if (!sound) return;
    const node = audioFor(sound.url).cloneNode() as HTMLAudioElement;
    node.loop = true;
    loopSound = sound;
    loopAudio = node;
    applyLoopVolume();
    node.play().catch(() => {});
  }

  function stopLoop(): void {
    if (!loopAudio) return;
    loopAudio.pause();
    loopAudio.currentTime = 0;
    loopAudio = null;
    loopSound = undefined;
  }

  // --- chrome -------------------------------------------------------------
  const queue = el('div', `${PREFIX}queue`);
  const cardsEl = el('div', `${PREFIX}cards`);
  const aside = el('div', `${PREFIX}aside`);
  const failsEl = el('div', `${PREFIX}fails`);
  const failsLabel = el('span');
  failsLabel.textContent = 'Ошибки';
  failsEl.appendChild(failsLabel);
  const failMarks: HTMLElement[] = [];
  for (let i = 0; i < cfg.failsAllowed; i++) {
    const mark = el('i');
    failMarks.push(mark);
    failsEl.appendChild(mark);
  }
  const muteBtn = el('button', `${PREFIX}sq`);
  muteBtn.type = 'button';
  muteBtn.setAttribute('aria-label', 'Звук');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (muted) stopLoop();
  });
  aside.append(failsEl, muteBtn);
  queue.append(cardsEl, aside);

  const cards = cfg.orders.map((order) => {
    const card = el('article', `${PREFIX}card`);
    const status = el('div', `${PREFIX}card__status`);
    const statusText = el('span');
    status.append(statusText, el('i', `${PREFIX}dot`));
    const art = el('div', `${PREFIX}card__art`);
    if (order.portrait) {
      const img = el('img');
      img.src = order.portrait;
      img.alt = '';
      art.appendChild(img);
    } else {
      art.innerHTML = PORTRAIT_SVG;
      const initial = el('span', `${PREFIX}card__initial`);
      initial.textContent = order.name.slice(0, 1);
      art.appendChild(initial);
    }
    const name = el('div', `${PREFIX}card__name`);
    name.textContent = order.name;
    const dish = el('div', `${PREFIX}card__order ${PREFIX}mono`);
    dish.textContent = order.orderName;
    dish.title = order.orderName;
    card.append(status, art, name, dish);
    cardsEl.appendChild(card);
    return { card, statusText };
  });

  // --- recipe + stage -----------------------------------------------------
  const mid = el('div', `${PREFIX}mid`);
  const recipePanel = el('section', `${PREFIX}panel`);
  const recipeHead = el('div', `${PREFIX}panel__head`);
  const recipeList = el('ol', `${PREFIX}recipe`);
  recipePanel.append(recipeHead, recipeList);

  const stage = el('section', `${PREFIX}panel ${PREFIX}stage`);
  const potWrap = el('div', `${PREFIX}potwrap`);
  potWrap.dataset.pot = '1';
  potWrap.innerHTML = `<svg class="${PREFIX}ring" viewBox="0 0 140 140" aria-hidden="true">
    <circle class="${PREFIX}ring__track" cx="70" cy="70" r="${RING_R}"/>
    <circle class="${PREFIX}ring__zone" cx="70" cy="70" r="${RING_R}"/>
    <circle class="${PREFIX}ring__bar" cx="70" cy="70" r="${RING_R}"/>
  </svg>`;
  const ringZone = potWrap.querySelector<SVGCircleElement>(`.${PREFIX}ring__zone`)!;
  const ringBar = potWrap.querySelector<SVGCircleElement>(`.${PREFIX}ring__bar`)!;
  ringBar.style.strokeDasharray = `${RING_C} ${RING_C}`;
  ringBar.style.strokeDashoffset = String(RING_C);
  const pot = el('div', `${PREFIX}pot`);
  pot.innerHTML = POT_SVG;
  const potStack = el('div', `${PREFIX}pot__stack`);
  const potLive = el('div', `${PREFIX}pot__layer ${PREFIX}pot__layer--live`);
  potStack.appendChild(potLive);
  pot.appendChild(potStack);
  potWrap.appendChild(pot);
  const hint = el('div', `${PREFIX}hint`);
  hint.textContent = 'Зажми';
  potWrap.appendChild(hint);

  const gauge = el('div', `${PREFIX}gauge`);
  const gaugeZone = el('div', `${PREFIX}gauge__zone`);
  const gaugeFill = el('div', `${PREFIX}gauge__fill`);
  const gaugeCap = el('div', `${PREFIX}gauge__cap`);
  gauge.append(gaugeZone, gaugeFill, gaugeCap);
  stage.append(potWrap, gauge);
  mid.append(recipePanel, stage);

  // --- shelf --------------------------------------------------------------
  const shelf = el('div', `${PREFIX}shelf`);
  const cells = new Map<string, HTMLElement>();
  for (const ing of ingredients) {
    const cell = el('button', `${PREFIX}cell`);
    cell.type = 'button';
    cell.dataset.ing = ing.id;
    const art = el('div', `${PREFIX}cell__art`);
    if (ing.image) {
      const img = el('img');
      img.src = ing.image;
      img.alt = '';
      art.appendChild(img);
    } else {
      art.innerHTML = glyphSvg(ing.id);
    }
    const name = el('div', `${PREFIX}cell__name`);
    name.textContent = ing.name;
    const unit = el('div', `${PREFIX}cell__unit ${PREFIX}mono`);
    unit.textContent = ing.unitName;
    cell.append(art, name, unit);
    cell.title = `${ing.name} · ${ing.unitName}`;
    shelf.appendChild(cell);
    cells.set(ing.id, cell);
  }

  root.append(queue, mid, shelf, el('div', `${PREFIX}crt`));

  // --- rendering ----------------------------------------------------------
  function stepLabel(step: { ingredientId: string; amount: number }): string {
    const ing = byId.get(step.ingredientId);
    const name = ing?.name ?? step.ingredientId;
    if (step.amount === 0) return `${name} — положить`;
    return `${name} ×${step.amount} ${plural(step.amount, ing?.unitName ?? 'ложка')}`;
  }

  function renderRecipe(): void {
    const order = currentOrder(state, cfg);
    renderedOrder = state.orderIndex;
    recipeHead.textContent = order ? order.orderName : 'Смена закрыта';
    recipeHead.title = order ? order.orderName : '';
    recipeList.innerHTML = '';
    if (!order) return;
    order.steps.forEach((step, i) => {
      const li = el('li');
      const num = el('b');
      num.textContent = `${i + 1}.`;
      const text = el('span');
      text.textContent = stepLabel(step);
      li.append(num, text);
      recipeList.appendChild(li);
    });
    const cook = el('li');
    const num = el('b');
    num.textContent = '▣';
    const text = el('span');
    const strong = el('em');
    strong.textContent = `Варка ${order.cookSeconds} с`;
    text.appendChild(strong);
    cook.append(num, text);
    recipeList.appendChild(cook);
  }

  function sync(): void {
    if (renderedOrder !== state.orderIndex) renderRecipe();
    const order = currentOrder(state, cfg);
    const cooking = !!order && state.stepIndex === order.steps.length;

    cards.forEach(({ card, statusText }, i) => {
      const active = i === state.orderIndex;
      const done = i < state.orderIndex;
      card.classList.toggle(`${PREFIX}card--active`, active);
      card.classList.toggle(`${PREFIX}card--done`, done);
      const alert = active && (state.phase === 'spoiled' || state.phase === 'wiped');
      card.classList.toggle(`${PREFIX}card--alert`, alert);
      statusText.textContent = alert ? 'Испорчено' : done ? 'Выдано' : active ? 'Готовится' : 'Ожидает';
    });

    failMarks.forEach((mark, i) => mark.classList.toggle(`${PREFIX}spent`, i < state.fails));

    Array.from(recipeList.children).forEach((li, i) => {
      li.classList.toggle(`${PREFIX}done`, i < state.stepIndex);
      li.classList.toggle(`${PREFIX}now`, i === state.stepIndex);
    });

    stage.classList.toggle(`${PREFIX}stage--cook`, cooking && state.phase !== 'spoiled' && state.phase !== 'wiped');
    stage.classList.toggle(`${PREFIX}stage--pour`, state.phase === 'pouring');
    shelf.classList.toggle(`${PREFIX}shelf--off`, cooking);

    const step = currentStep(state, cfg);
    potLive.style.setProperty('--co-hue', step ? tint(step.ingredientId) : '#16A69B');
    renderPotLayers();

    if (state.phase !== 'cooking') {
      ringBar.style.strokeDashoffset = String(RING_C);
      ringBar.style.stroke = '#5DE2D0';
      const w = cookWindow(state, cfg);
      if (w && w.ringMax > 0) {
        const f0 = w.min / w.ringMax;
        ringZone.style.strokeDasharray = `${(1 - f0) * RING_C} ${RING_C}`;
        ringZone.style.strokeDashoffset = String(-f0 * RING_C);
      }
    }
    if (state.phase !== 'pouring') {
      gaugeFill.style.height = '0';
      potLive.style.height = '0';
      renderGaugeMarks();
    }
  }

  /**
   * Rebuilds the settled pot layers purely from `state` — one sliver per
   * completed step of the current order, oldest at the bottom. Since layers
   * are derived from orderIndex/stepIndex rather than accumulated, a fail,
   * wipe, or order advance clears the pot for free (§5.1).
   */
  function renderPotLayers(): void {
    if (renderedPotOrder === state.orderIndex && renderedPotStep === state.stepIndex) return;
    renderedPotOrder = state.orderIndex;
    renderedPotStep = state.stepIndex;
    potStack.querySelectorAll(`.${PREFIX}pot__layer:not(.${PREFIX}pot__layer--live)`).forEach((n) => n.remove());
    const order = currentOrder(state, cfg);
    if (!order || order.steps.length === 0) return;
    // Percentages here resolve against potStack's own box (42% of the pot),
    // so a full-height slot is 100/steps.length — an even split of the stack.
    const slot = 100 / order.steps.length;
    const sliver = Math.min(slot, 100 * (3 / 42)); // ~2-3px-equivalent for amount:0 steps
    for (let i = 0; i < state.stepIndex && i < order.steps.length; i++) {
      const layer = el('div', `${PREFIX}pot__layer`);
      const stepAmount = order.steps[i]!.amount;
      layer.style.height = `${stepAmount === 0 ? sliver : slot}%`;
      layer.style.setProperty('--co-hue', tint(order.steps[i]!.ingredientId));
      potStack.insertBefore(layer, potLive);
    }
  }

  function renderGaugeMarks(): void {
    const w = doseWindow(state, cfg);
    gauge.querySelectorAll(`.${PREFIX}gauge__tick`).forEach((t) => t.remove());
    if (!w || w.scaleMax <= 0) {
      gaugeZone.style.height = '0';
      return;
    }
    gaugeZone.style.height = `${((w.scaleMax - w.min) / w.scaleMax) * 100}%`;
    const step = currentStep(state, cfg);
    const units = step ? step.amount : 0;
    for (let i = 1; i <= units; i++) {
      const tick = el('i', `${PREFIX}gauge__tick`);
      tick.style.bottom = `${(i / w.scaleMax) * 100}%`;
      gauge.appendChild(tick);
    }
  }

  function updateHoldVisuals(): void {
    if (state.phase === 'pouring') {
      const w = doseWindow(state, cfg);
      if (!w || w.scaleMax <= 0) return;
      const pct = Math.min(100, (state.holdValue / w.scaleMax) * 100);
      gaugeFill.style.height = `${pct}%`;
      const order = currentOrder(state, cfg);
      const slot = order && order.steps.length > 0 ? 100 / order.steps.length : 100;
      potLive.style.height = `${(pct / 100) * slot}%`;
    } else if (state.phase === 'cooking') {
      const w = cookWindow(state, cfg);
      if (!w || w.ringMax <= 0) return;
      const frac = Math.min(1, state.holdValue / w.ringMax);
      ringBar.style.strokeDashoffset = String(RING_C * (1 - frac));
      ringBar.style.stroke = frac >= w.min / w.ringMax ? '#E9A928' : '#5DE2D0';
    }
  }

  // --- banners / screens --------------------------------------------------
  function banner(text: string, calm: boolean, ms: number): void {
    root.querySelectorAll(`.${PREFIX}banner`).forEach((b) => b.remove());
    const node = el('div', `${PREFIX}banner${calm ? ` ${PREFIX}banner--calm` : ''}`);
    node.textContent = text;
    root.appendChild(node);
    later(() => node.remove(), ms);
  }

  function screen(title: string, note: string, win: boolean): HTMLElement {
    const node = el('div', `${PREFIX}screen${win ? ` ${PREFIX}screen--win` : ''}`);
    const h = el('h1');
    h.textContent = title;
    const p = el('p');
    p.textContent = note;
    const marks = el('div', `${PREFIX}marks`);
    if (!win) for (let i = 0; i < 3; i++) marks.appendChild(el('i', `${PREFIX}dot`));
    node.append(h, p, marks);
    root.appendChild(node);
    return node;
  }

  function report(): void {
    const p = progress(state, cfg);
    if (p.text === lastProgress) return;
    lastProgress = p.text;
    callbacks.onProgress?.(p.text, p.percent);
  }

  // --- transitions --------------------------------------------------------
  function stopRaf(): void {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function releasePointer(): void {
    if (captureEl && activePointerId !== null) {
      try {
        captureEl.releasePointerCapture(activePointerId);
      } catch {
        /* pointer already released */
      }
    }
    captureEl?.classList.remove(`${PREFIX}cell--held`);
    captureEl = null;
    activePointerId = null;
    pendingPick = null;
  }

  /** Single funnel for every engine result: reacts to the new phase, then repaints. */
  function commit(next: State): void {
    const prev = state.phase;
    state = next;
    if (state.phase !== prev) {
      switch (state.phase) {
        case 'spoiled':
          stopRaf();
          stopLoop();
          play(config.sounds?.fail);
          banner('Испорчено', false, spoilAnimationMs);
          recipeList.classList.add(`${PREFIX}glitch`);
          later(() => {
            recipeList.classList.remove(`${PREFIX}glitch`);
            commit(resolveSpoiled(state));
          }, spoilAnimationMs);
          break;
        case 'wiped':
          stopRaf();
          stopLoop();
          play(config.sounds?.wipe);
          {
            callbacks.onProgress?.('ВСЁ СГОРЕЛО · СМЕНА С НАЧАЛА', 0);
            lastProgress = ''; // the restart must re-report even if the text repeats
            const node = screen('Всё сгорело', 'Смена с начала', false);
            later(() => {
              node.remove();
              commit(resolveWipe(state));
            }, WIPE_MS);
          }
          break;
        case 'orderDone':
          stopRaf();
          stopLoop();
          play(config.sounds?.orderDone);
          cards[state.orderIndex]?.card.classList.add(`${PREFIX}card--enter`);
          later(() => commit(resolveOrderDone(state)), ORDER_DONE_MS);
          break;
        case 'finished':
          stopRaf();
          stopLoop();
          play(config.sounds?.orderDone);
          finish();
          break;
        case 'pouring':
          startLoop(config.sounds?.pourLoop);
          startRaf();
          break;
        case 'cooking':
          startLoop(config.sounds?.cookLoop);
          startRaf();
          break;
        default:
          stopLoop();
      }
    }
    sync();
    // 'wiped' and 'finished' publish their own progress line — do not overwrite it
    if (state.phase !== 'finished' && state.phase !== 'wiped') report();
  }

  function startRaf(): void {
    lastFrameAt = performance.now();
    renderGaugeMarks();
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(): void {
    rafId = 0;
    const now = performance.now();
    const before = state.phase;
    const next = tickHold(state, cfg, now, lastFrameAt);
    lastFrameAt = now;
    if (next.phase === before) {
      state = next;
      updateHoldVisuals();
      rafId = requestAnimationFrame(frame);
      return;
    }
    // hold ended by itself: overflow / overcook / a slept frame
    releasePointer();
    if (next.phase === 'idle') interrupted(next);
    else commit(next);
  }

  /** Hold aborted by the system — neutral, not a mistake (§6.2, §6.3). */
  function interrupted(next: State): void {
    stopRaf();
    stopLoop();
    banner('Прервано — повтори шаг', true, INTERRUPT_MS);
    commit(next);
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    releasePointer();
    const p = progress(state, cfg);
    callbacks.onProgress?.('СМЕНА ЗАКРЫТА', p.percent);
    screen('Смена закрыта', `Счёт ${state.score} · ошибок ${state.fails}`, true);
    const details: Record<string, number | string> = {
      orders: cfg.orders.length,
      fails: state.fails,
      wipes: state.wipes,
      styleTag: styleTagFor(state),
    };
    const score = Math.max(0, state.score);
    later(() => {
      root.classList.remove(`${PREFIX}visible`);
      later(() => callbacks.onComplete({ score, won: true, details }), FADE_MS);
    }, FINISH_MS);
  }

  // --- input --------------------------------------------------------------
  function cellUnder(e: PointerEvent): string | null {
    const node = document.elementFromPoint(e.clientX, e.clientY);
    return node?.closest<HTMLElement>(`[data-ing]`)?.dataset.ing ?? null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (finished || state.phase !== 'idle') return;
    if (activePointerId !== null) return; // busy: second finger, second click
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(`.${PREFIX}sq`)) return;
    const cell = target?.closest<HTMLElement>('[data-ing]');
    const potHit = target?.closest<HTMLElement>('[data-pot]');
    if (!cell && !potHit) return;
    e.preventDefault();

    const holder = (cell ?? potHit)!;
    activePointerId = e.pointerId;
    captureEl = holder;
    try {
      holder.setPointerCapture(e.pointerId);
    } catch {
      /* element may not accept capture */
    }

    if (cell) {
      const id = cell.dataset.ing!;
      const step = currentStep(state, cfg);
      if (step && step.amount === 0) {
        // simple step: the outcome is decided on release, over the same cell
        pendingPick = id;
        cell.classList.add(`${PREFIX}cell--held`);
        return;
      }
      cell.classList.add(`${PREFIX}cell--held`);
      const next = startPour(state, cfg, id, performance.now());
      if (next.phase !== 'pouring') releasePointer();
      commit(next);
      return;
    }

    const next = startCook(state, cfg, performance.now());
    if (next.phase !== 'cooking') releasePointer();
    commit(next);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const pick = pendingPick;
    const phase = state.phase;
    const overSameCell = pick !== null && cellUnder(e) === pick;
    releasePointer();
    if (phase === 'pouring') {
      stopRaf();
      stopLoop();
      const next = endPour(state, cfg, performance.now());
      if (next.phase === 'idle') play(config.sounds?.pourOk);
      commit(next);
    } else if (phase === 'cooking') {
      stopRaf();
      stopLoop();
      commit(endCook(state, cfg, performance.now()));
    } else if (pick !== null && phase === 'idle') {
      if (!overSameCell) return; // slid off the cell — no action, no penalty
      const next = pickIngredient(state, cfg, pick);
      if (next.phase === 'idle') {
        play(config.sounds?.place);
        const cell = cells.get(pick);
        cell?.classList.add(`${PREFIX}cell--flash`);
        later(() => cell?.classList.remove(`${PREFIX}cell--flash`), 240);
      }
      commit(next);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    abortHold();
  }

  function abortHold(): void {
    const holding = state.phase === 'pouring' || state.phase === 'cooking';
    releasePointer();
    if (!holding) return;
    interrupted(cancelHold(state));
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') abortHold();
  }

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', abortHold);
  document.addEventListener('visibilitychange', onVisibility);

  sync(); // first call also builds the recipe list
  report();

  return {
    setVolume(v): void {
      sfxGain = gainOf(v.sfxVolume, 100);
      muted = v.muted === true;
      muteBtn.textContent = muted ? '🔇' : '🔊';
      if (muted) stopLoop();
      applyLoopVolume();
    },
    destroy(): void {
      stopRaf();
      stopLoop();
      releasePointer();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', abortHold);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const audio of audioCache.values()) {
        audio.pause();
        audio.src = '';
      }
      audioCache.clear();
      container.innerHTML = '';
    },
  };
}
