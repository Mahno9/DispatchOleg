import type { CSSProperties } from 'react';
import type { Character, Game, MetaStage, MetaStageCharacter } from '../api';
import { CharacterInfo } from '../dialogue/CharacterInfo';
import { silhouetteFor } from '../dialogue/Silhouettes';
import type { GameResult } from '../state/localState';
import { rosterGames } from './flow';
import { bgStyle } from './metaStage';

/** A character worth drawing on the default meta scene: one with something to say. */
export type MetaCharacter = Character & { metaDialogueId: number };

/** What a click on a character hands back: who, and which dialogue to play. On a
 *  stage the placement may override the character's own `metaDialogueId`. */
export interface MetaCharacterPick {
  character: Character;
  dialogueId: number;
}

interface MetaScreenProps {
  games: Game[];
  /** Полный ростер: стадия может поставить персонажа без собственной болтовни. */
  characters: Character[];
  /** Текущая стадия. Её выбирает App — сцена, значки и гейт обязаны смотреть на одну. */
  stage: MetaStage | null;
  /** Уже прочитанные диалоги, из прогресса игрока. */
  seen: number[];
  /** Click on a character — App plays the given dialogue and comes back here. */
  onCharacter: (pick: MetaCharacterPick) => void;
}

/** True when every prerequisite game has been won. Mirrors the server check. */
export function isUnlocked(game: Game, results: Record<string, GameResult>): boolean {
  return game.requiredGameIds.every((id) => results[String(id)]?.won === true);
}

/**
 * Режим без QR: следующую операцию выдаёт жребий, а не код на стене. Кандидаты
 * — разблокированные операции ростера (без обучалки и финала), ещё не
 * выигранные; если невыигранных не
 * осталось, отдаём любую разблокированную (переигрывать можно), а когда не
 * открыто вообще ничего — null, и START просто ничего не запускает.
 */
export function pickRandomGame(
  games: Game[],
  results: Record<string, GameResult>,
  rand: () => number = Math.random,
): Game | null {
  const open = rosterGames(games).filter((g) => isUnlocked(g, results));
  const fresh = open.filter((g) => results[String(g.id)]?.won !== true);
  const pool = fresh.length > 0 ? fresh : open;
  if (pool.length === 0) return null;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
  return pool[i] ?? null;
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
 * clickable cast standing on it.
 *
 * Two layouts share the frame. When the admin has configured a meta stage whose
 * trigger the player has met, that stage owns the floor: its background image
 * and its hand-placed cast. Otherwise the scene falls back to the built-in
 * two-column arrangement by `metaPosition`.
 */
export function MetaScreen({ games, characters, stage, seen, onCharacter }: MetaScreenProps) {
  const playable = rosterGames(games);
  const isRead = (id: number) => seen.includes(id);

  const chatty = characters.filter((c): c is MetaCharacter => c.metaDialogueId !== null);
  const byId = new Map(characters.map((c) => [c.id, c]));

  /** Stage placements paired with the roster; unknown ids are dropped. */
  const placed = stage
    ? stage.characters.flatMap((entry) => {
        const character = byId.get(entry.characterId);
        return character ? [{ entry, character }] : [];
      })
    : [];

  const headcount = stage ? placed.length : chatty.length;

  return (
    <div className="screen">
      <div className="terminal-bar">
        <span className="terminal-title">{stage ? stage.title || 'Мета' : 'Мета'}</span>
        <span>Сектор 04</span>
        <span className="terminal-bar-spacer" />
        <span>Персонал: {headcount}</span>
        <span>Оперативные задания: {playable.length}</span>
      </div>

      <div className="meta-stage" style={stage ? bgStyle(stage.background) : undefined}>
        <i className="meta-corner tl" />
        <i className="meta-corner tr" />
        <i className="meta-corner bl" />
        <i className="meta-corner br" />

        {stage
          ? placed.map(({ entry, character }) => (
              <PlacedCharacter
                key={`${entry.characterId}-${entry.x}-${entry.y}`}
                entry={entry}
                character={character}
                isRead={isRead}
                onCharacter={onCharacter}
              />
            ))
          : SIDES.map((side) => (
              <div key={side} className="meta-group">
                {chatty
                  .filter((c) => metaSide(c.metaPosition) === side)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="meta-char"
                      onClick={() => onCharacter({ character: c, dialogueId: c.metaDialogueId })}
                    >
                      <span className="meta-char-frame">
                        <Figure character={c} tag={isRead(c.metaDialogueId) ? 'read' : 'unread'} />
                      </span>
                      <span className="status meta-char-name">{c.name}</span>
                    </button>
                  ))}
              </div>
            ))}

        {headcount === 0 && <span className="label meta-empty">Персонал вне зоны связи</span>}
      </div>
    </div>
  );
}

function CharacterMedia({ character }: { character: Character }) {
  return character.portraitAsset ? (
    <img className="portrait-media" src={character.portraitAsset} alt="" />
  ) : (
    silhouetteFor(character.id)
  );
}

/**
 * The media plus its «Диалог» tag in one box sized by the picture itself, so
 * the tag hangs just over the head — not over the dead air the 3:4 slot
 * leaves above a square avatar.
 *
 * Непрочитанный диалог — дело игрока, его значок горит всегда; прочитанный
 * гаснет до приглушённой отметки и всплывает по наведению, как раньше.
 */
function Figure({ character, tag }: { character: Character; tag: 'none' | 'unread' | 'read' }) {
  return (
    <span className="meta-char-figure">
      <CharacterMedia character={character} />
      {/* ⓘ — в коробке самой картинки: угол образует верхняя кромка персонажа,
          а не пустой верх 3:4-слота. Ничто снаружи не клипает — заметка целая. */}
      <CharacterInfo description={character.description} />
      {tag !== 'none' && (
        <span
          className={`status meta-char-tag ${
            tag === 'read' ? 'status-idle meta-char-tag--read' : 'status-active'
          }`}
        >
          {tag === 'read' ? <i className="marker-check">✓</i> : <i className="marker" />}
          {tag === 'read' ? 'Завершено' : 'Диалог'}
        </span>
      )}
    </span>
  );
}

/**
 * A character at an absolute spot on the stage. x/y are percent of the stage
 * box and address the sprite's centre, so the translate is part of the anchor,
 * not decoration. Without a dialogue the figure is scenery: rendered as a plain
 * element, so it neither invites a click nor takes keyboard focus.
 */
function PlacedCharacter({
  entry,
  character,
  isRead,
  onCharacter,
}: {
  entry: MetaStageCharacter;
  character: Character;
  isRead: (id: number) => boolean;
  onCharacter: (pick: MetaCharacterPick) => void;
}) {
  const dialogueId = entry.dialogueId ?? character.metaDialogueId;
  const style = {
    left: `${entry.x}%`,
    top: `${entry.y}%`,
    '--char-scale': entry.scale ?? 1,
  } as CSSProperties;

  const body = (
    <>
      <span className="meta-char-frame">
        <Figure
          character={character}
          tag={dialogueId === null ? 'none' : isRead(dialogueId) ? 'read' : 'unread'}
        />
      </span>
      <span className="status meta-char-name">{character.name}</span>
    </>
  );

  if (dialogueId === null) {
    return (
      <div className="meta-char meta-char--placed meta-char--idle" style={style}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="meta-char meta-char--placed"
      style={style}
      onClick={() => onCharacter({ character, dialogueId })}
    >
      {body}
    </button>
  );
}
