import { useEffect, useState } from 'react';
import { api } from '../api';

// ---------------------------------------------------------------------------
// Victory — the shift closes. Shown once, the first time every operation on the
// meta screen is won; after that the player is free to wander back to the meta.
// ---------------------------------------------------------------------------

/** What the screen says when the admin has left `final_victory_text` empty. */
export const FALLBACK_VICTORY_TEXT = 'ВСЕ ОПЕРАЦИИ ЗАВЕРШЕНЫ. СМЕНА ЗАКРЫТА. СПАСИБО, ОПЕРАТОР.';

export function VictoryScreen() {
  const [text, setText] = useState(FALLBACK_VICTORY_TEXT);

  useEffect(() => {
    let live = true;
    api.getSettings().then(
      (settings) => {
        // A blank or missing setting is not a request for an empty screen.
        const custom = settings.final_victory_text;
        if (live && typeof custom === 'string' && custom.trim()) setText(custom);
      },
      // No settings, no custom send-off — the built-in one still closes the shift.
      (err: unknown) => console.error('[victory] failed to load settings', err),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="screen screen-center victory">
      <div className="panel victory-panel">
        <div className="victory-head">
          <span className="status status-active victory-badge">
            <i className="marker marker-blink" />
            Победа
          </span>
          <span className="label">Смена закрыта · протокол завершён</span>
        </div>

        <div className="divider" />

        <div className="victory-body mono">
          {text.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          <span className="victory-cursor" />
        </div>

        <div className="divider" />

        <div className="victory-foot label">
          <span>Диспетчерский терминал ОЛЕГ</span>
          <span>Статус: ВСЕ ОПЕРАЦИИ ВЫПОЛНЕНЫ</span>
        </div>
      </div>
    </div>
  );
}
