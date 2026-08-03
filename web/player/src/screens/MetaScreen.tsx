import { useEffect, useState } from 'react';
import { api, type Character, type Game } from '../api';
import { AvatarOutline } from '../dialogue/DialogueScene';
import type { GameResult } from '../state/localState';

/** A character worth drawing on the meta scene: one with something to say. */
export type MetaCharacter = Character & { metaDialogueId: number };

interface MetaScreenProps {
  games: Game[];
  results: Record<string, GameResult>;
  /** Click on a character — App plays their meta dialogue and comes back here. */
  onCharacter: (character: MetaCharacter) => void;
}

/** True when every prerequisite game has been won. Mirrors the server check. */
export function isUnlocked(game: Game, results: Record<string, GameResult>): boolean {
  return game.requiredGameIds.every((id) => results[String(id)]?.won === true);
}

/**
 * `meta_position` is an opaque slot string (docs/platform.md §6). The scene only
 * needs the side; anything that does not say "right" stands on the left.
 */
export function metaSide(position: string): 'left' | 'right' {
  return /right|прав/i.test(position) ? 'right' : 'left';
}

const SIDES = ['left', 'right'] as const;

/**
 * Meta scene (Windows.png, frame «МЕТА»): the command-centre floor with the
 * clickable cast standing on it, and the game dossiers as a compact strip below.
 */
export function MetaScreen({ games, results, onCharacter }: MetaScreenProps) {
  const playable = games.filter((g) => !g.isTutorial);
  const [cast, setCast] = useState<MetaCharacter[]>([]);

  useEffect(() => {
    let live = true;
    api.getCharacters().then(
      (list) => {
        // A cast that fails to load costs the chatter, not the meta screen.
        if (live) setCast(list.filter((c): c is MetaCharacter => c.metaDialogueId !== null));
      },
      (err: unknown) => console.error('[meta] failed to load characters', err),
    );
    return () => {
      live = false;
    };
  }, []);

  const titles = new Map(games.map((g) => [g.id, g.title]));

  return (
    <div className="screen">
      <div className="terminal-bar">
        <span className="terminal-title">Мета</span>
        <span>Сектор 04</span>
        <span className="terminal-bar-spacer" />
        <span>Персонал: {cast.length}</span>
        <span>Оперативные задания: {playable.length}</span>
      </div>

      <div className="meta-stage">
        <i className="meta-corner tl" />
        <i className="meta-corner tr" />
        <i className="meta-corner bl" />
        <i className="meta-corner br" />

        {SIDES.map((side) => (
          <div key={side} className="meta-group">
            {cast
              .filter((c) => metaSide(c.metaPosition) === side)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="meta-char"
                  onClick={() => onCharacter(c)}
                >
                  <span className="meta-char-frame">
                    {c.portraitAsset ? (
                      <img className="portrait-media" src={c.portraitAsset} alt="" />
                    ) : (
                      <AvatarOutline />
                    )}
                    <span className="status status-active meta-char-tag">
                      <i className="marker" />
                      Диалог
                    </span>
                  </span>
                  <span className="status meta-char-name">{c.name}</span>
                </button>
              ))}
          </div>
        ))}

        {cast.length === 0 && <span className="label meta-empty">Персонал вне зоны связи</span>}
      </div>

      <div className="card-row card-strip">
        {playable.map((game) => {
          const result = results[String(game.id)];
          const unlocked = isUnlocked(game, results);
          const status = !unlocked ? 'ЗАБЛОКИРОВАНО' : result?.won ? 'ВЫПОЛНЕНО' : 'АКТИВНО';
          const stripClass = !unlocked
            ? ''
            : result?.won
              ? 'dossier-strip-done'
              : 'dossier-strip-open';
          return (
            <div
              key={game.id}
              className={`dossier ${unlocked ? '' : 'dossier-locked'}`}
              title={unlocked ? game.title : 'Недоступно: нужен прогресс в других играх'}
            >
              <span className={`dossier-strip ${stripClass}`}>{status}</span>
              <div className="dossier-body">
                {unlocked ? (
                  <span className="label">{game.minigameId}</span>
                ) : (
                  <span className="dossier-lock">&#128274;</span>
                )}
              </div>
              <div className="dossier-name">{game.title}</div>
              {!unlocked && (
                <div className="label dossier-req">
                  Нужно: {game.requiredGameIds.map((id) => titles.get(id) ?? `#${id}`).join(' · ')}
                </div>
              )}
            </div>
          );
        })}
        {playable.length === 0 && <span className="label">Заданий нет</span>}
      </div>
    </div>
  );
}
