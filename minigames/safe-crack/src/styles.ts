import { P } from './widgets/common.js';

/**
 * Все стили scoped под `.sc-root` — глобальных правил нет (контракт «Изоляция»).
 * Палитра и формы — STYLE.md: почти чёрный фон, бирюзовый интерфейс,
 * янтарь на активном, углы 0–3px, переходы 100–220 мс.
 */
export const STYLES = `
.${P}root {
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
  transition: opacity 300ms ease;
  user-select: none;
  -webkit-user-select: none;
}
.${P}root.${P}visible { opacity: 1; }
.${P}root * { box-sizing: border-box; }
.${P}mono { font-family: 'Share Tech Mono', 'IBM Plex Mono', ui-monospace, monospace; }
.${P}hint { font-size: 11px; letter-spacing: 0.1em; color: #759C96; }

/* --- HUD ---------------------------------------------------------------- */
.${P}hud {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
  font-size: 13px;
  letter-spacing: 0.1em;
}
.${P}hud__title { font-weight: 700; color: #16A69B; white-space: nowrap; }
.${P}hud__spacer { flex: 1 1 auto; }
.${P}hud__cell { color: #759C96; white-space: nowrap; }
.${P}hud__cell b { color: #D3DED5; font-weight: 400; }
.${P}hud__cell--alert b { color: #F0713E; }

.${P}sq {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0A3435;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5;
  border-radius: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.${P}sq:hover { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.35); }

/* --- рабочая область ---------------------------------------------------- */
.${P}body { flex: 1 1 auto; min-height: 0; display: flex; gap: 6px; }
.${P}stage {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
}
.${P}question {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-left: 2px solid #E9A928;
  background: #0A3435;
  font-size: 14px;
  letter-spacing: 0.06em;
  color: #D3DED5;
}
.${P}slot {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 4px;
  transition: opacity 160ms ease;
}
.${P}slot.${P}slot--off { opacity: 0.3; pointer-events: none; }
.${P}status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.${P}statusbar {
  flex: 1 1 auto;
  padding: 3px 8px;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: #759C96;
  border: 1px solid #0A3435;
}
.${P}statusbar--check { color: #E9A928; border-color: #E9A928; }
.${P}statusbar--open { color: #16A69B; border-color: #16A69B; }
.${P}statusbar--fail { color: #F0713E; border-color: #F0713E; animation: ${P}blink 220ms steps(1) 2; }
@keyframes ${P}blink { 50% { background: rgba(240,113,62,0.25); } }

/* --- ригели ------------------------------------------------------------- */
.${P}bolts {
  flex: 0 0 auto;
  width: 84px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
  overflow-y: auto;
}
.${P}bolt {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 3px 5px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #2c4b4a;
  border: 1px solid #0A3435;
  background: #030B0C;
  transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
}
.${P}bolt--active { color: #E9A928; border-color: #E9A928; background: #0A3435; }
.${P}bolt--open { color: #030B0C; border-color: #E9A928; background: #E9A928; }
.${P}bolt--fail { color: #F0713E; border-color: #F0713E; }

/* --- кнопка ВВОД -------------------------------------------------------- */
.${P}btn {
  padding: 5px 12px;
  background: #0A3435;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #062326;
  border-radius: 0;
  color: #D3DED5;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
.${P}btn:hover:not(:disabled) { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.35); }
.${P}btn:disabled { opacity: 0.35; cursor: not-allowed; }
.${P}btn:focus-visible { outline: 1px solid #E9A928; outline-offset: 1px; }
.${P}btn--enter { border-color: #E9A928; color: #E9A928; min-width: 96px; font-weight: 700; }
.${P}btn--enter:hover:not(:disabled) { border-color: #E9A928; box-shadow: 0 0 8px rgba(233,169,40,0.45); }
.${P}btn--tiny { padding: 1px 6px; font-size: 11px; }
.${P}btn--square { width: 64px; height: 56px; font-size: 20px; }
.${P}row { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }

/* --- общие детали виджетов ---------------------------------------------- */
.${P}wdisplay {
  min-width: 120px;
  padding: 4px 10px;
  text-align: center;
  font-size: 20px;
  letter-spacing: 0.2em;
  color: #E9A928;
  background: #030B0C;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 12px rgba(233,169,40,0.12);
}

/* --- mega-slider -------------------------------------------------------- */
.${P}slider { width: min(560px, 100%); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.${P}slider__value { font-size: 34px; letter-spacing: 0.24em; }
.${P}slider__input { width: 100%; accent-color: #E9A928; }
.${P}slider__scale { width: 100%; display: flex; justify-content: space-between; font-size: 11px; color: #759C96; }

/* --- haystack-dropdown --------------------------------------------------- */
.${P}haystack { width: min(420px, 100%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
.${P}haystack__select {
  width: 100%;
  background: #030B0C;
  color: #D3DED5;
  border: 1px solid #16A69B;
  border-radius: 0;
  font-size: 14px;
  padding: 2px;
  text-transform: none;
}
.${P}haystack__select option { padding: 1px 4px; }
.${P}haystack__select option:checked { background: #E9A928; color: #030B0C; }

/* --- rotary-dial --------------------------------------------------------- */
.${P}dial { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.${P}dial__body { position: relative; width: 210px; height: 210px; }
.${P}dial__disc {
  position: absolute;
  inset: 0;
  border: 2px solid #16A69B;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #0A3435 0 38%, #062326 39% 100%);
  box-shadow: inset 0 0 0 6px #030B0C;
  touch-action: none;
}
.${P}dial__hole {
  position: absolute;
  width: 34px;
  height: 34px;
  margin: -17px 0 0 -17px;
  border: 1px solid #5DE2D0;
  border-radius: 50%;
  background: #030B0C;
  color: #D3DED5;
  font-size: 14px;
  cursor: grab;
  padding: 0;
  transition: border-color 120ms ease, color 120ms ease;
}
.${P}dial__hole:hover { border-color: #E9A928; color: #E9A928; }
.${P}dial__stop {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  background: #E86836;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

/* --- shuffle-keyboard ---------------------------------------------------- */
.${P}keyboard { display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(460px, 100%); }
.${P}keyboard__grid { display: grid; gap: 3px; width: 100%; }
.${P}key {
  padding: 6px 0;
  background: #0A3435;
  border: 1px solid #16A69B;
  border-radius: 0;
  color: #D3DED5;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  transition: background 100ms ease, border-color 100ms ease;
}
.${P}key:hover { border-color: #5DE2D0; background: #10474a; }
.${P}key--alt { border-color: #E86836; color: #E86836; }

/* --- number-as-words ----------------------------------------------------- */
.${P}words { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.${P}words__rack { display: flex; gap: 8px; }
.${P}words__reel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border: 1px solid #0A3435;
  background: #030B0C;
}
.${P}words__face {
  width: 110px;
  padding: 8px 2px;
  text-align: center;
  font-size: 14px;
  color: #E9A928;
  border-top: 1px solid #0A3435;
  border-bottom: 1px solid #0A3435;
  text-transform: none;
}

/* --- plus-minus ---------------------------------------------------------- */
.${P}plusminus { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.${P}plusminus__value { font-size: 40px; letter-spacing: 0.16em; }
.${P}pad { display: flex; gap: 14px; transition: transform 140ms ease; }
.${P}pad--swap { transform: translateY(-4px); }

/* --- safe-drum ----------------------------------------------------------- */
.${P}drum { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.${P}drum__body {
  position: relative;
  width: 120px;
  overflow: hidden;
  background: #030B0C;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 26px rgba(3,11,12,0.9);
  touch-action: none;
  cursor: ns-resize;
}
.${P}drum__strip { display: flex; flex-direction: column; }
.${P}drum__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #759C96;
}
.${P}drum__cell--active { color: #E9A928; background: rgba(233,169,40,0.1); }

/* --- hold-button --------------------------------------------------------- */
.${P}hold { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.${P}gauge { position: relative; width: 140px; height: 140px; }
.${P}gauge__face {
  position: absolute;
  inset: 0;
  border: 2px solid #16A69B;
  border-radius: 50%;
  background:
    conic-gradient(from 210deg, rgba(22,166,155,0.18) 0 66%, rgba(240,113,62,0.2) 66% 100%),
    #030B0C;
  box-shadow: inset 0 0 0 4px #062326;
}
.${P}gauge__needle {
  position: absolute;
  left: 50%;
  bottom: 50%;
  width: 2px;
  height: 46%;
  margin-left: -1px;
  background: #E9A928;
  transform-origin: 50% 100%;
}
.${P}gauge__cap {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: #C8A878;
}
.${P}hold__pad {
  width: 170px;
  height: 64px;
  background: #0A3435;
  border: 2px solid #E9A928;
  box-shadow: inset 0 0 0 2px #062326;
  border-radius: 2px;
  color: #E9A928;
  font: inherit;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.14em;
  cursor: pointer;
  touch-action: none;
  transition: transform 100ms ease, background 100ms ease;
}
.${P}hold__pad--down { transform: translateY(3px); background: #E9A928; color: #030B0C; }

/* --- checkbox-wall ------------------------------------------------------- */
.${P}wall { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.${P}wall__grid { display: grid; gap: 4px; }
.${P}wall__cell {
  width: 34px;
  height: 34px;
  padding: 0;
  background: #030B0C;
  border: 1px solid #0A3435;
  border-radius: 0;
  cursor: pointer;
  transition: background 100ms ease, border-color 100ms ease;
}
.${P}wall__cell:hover { border-color: #16A69B; }
.${P}wall__cell--on { background: #16A69B; border-color: #5DE2D0; }
.${P}wall__cell--miss { background: #E86836; border-color: #F0713E; }

/* --- экраны -------------------------------------------------------------- */
.${P}screen {
  position: absolute;
  inset: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
  background: #030B0C;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #0A3435;
}
.${P}screen__title { font-size: 26px; font-weight: 700; letter-spacing: 0.16em; color: #16A69B; }
.${P}screen__title--alert { color: #F0713E; }
.${P}screen__rows { display: flex; flex-direction: column; gap: 2px; }
.${P}screen__prize { max-width: 40%; max-height: 34%; object-fit: contain; border: 1px solid #C8A878; }

.${P}door { position: relative; width: 150px; height: 150px; }
.${P}door__ring {
  position: absolute;
  inset: 0;
  border: 2px solid #16A69B;
  border-radius: 50%;
  box-shadow: inset 0 0 0 8px #062326, inset 0 0 0 10px #0A3435;
  transition: transform 600ms cubic-bezier(0.3, 0, 0.2, 1);
}
.${P}door__spokes {
  position: absolute;
  inset: 22%;
  border: 1px solid #5DE2D0;
  border-radius: 50%;
  background:
    linear-gradient(#5DE2D0, #5DE2D0) center / 100% 1px no-repeat,
    linear-gradient(#5DE2D0, #5DE2D0) center / 1px 100% no-repeat;
  transition: transform 600ms cubic-bezier(0.3, 0, 0.2, 1);
}
.${P}door--spin .${P}door__spokes { transform: rotate(220deg); }
.${P}door--open .${P}door__ring { transform: translateX(-46%) rotateY(52deg); }
.${P}door--open .${P}door__spokes { transform: translateX(-46%) rotate(220deg); }
`;
