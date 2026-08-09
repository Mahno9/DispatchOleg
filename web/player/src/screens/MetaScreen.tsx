import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, type Character, type Game, type MetaStage, type MetaStageCharacter } from '../api';
import { CharacterInfo } from '../dialogue/CharacterInfo';
import { silhouetteFor } from '../dialogue/Silhouettes';
import type { GameResult } from '../state/localState';
import { bgStyle, resolveStage } from './metaStage';

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
  results: Record<string, GameResult>;
  /** Click on a character — App plays the given dialogue and comes back here. */
  onCharacter: (pick: MetaCharacterPick) => void;
  /** Admin test mode: show this stage regardless of triggers. */
  forceStageId?: number | null;
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
 * clickable cast standing on it.
 *
 * Two layouts share the frame. When the admin has configured a meta stage whose
 * trigger the player has met, that stage owns the floor: its background image
 * and its hand-placed cast. Otherwise the scene falls back to the built-in
 * two-column arrangement by `metaPosition`.
 */
export function MetaScreen({ games, results, onCharacter, forceStageId = null }: MetaScreenProps) {
  const playable = games.filter((g) => !g.isTutorial);
  // The full roster: a stage may place a character who has no meta chatter of
  // their own, so the cast cannot be pre-filtered to metaDialogueId !== null.
  const [cast, setCast] = useState<Character[]>([]);
  const [stages, setStages] = useState<MetaStage[]>([]);

  useEffect(() => {
    let live = true;
    api.getCharacters().then(
      (list) => {
        // A cast that fails to load costs the chatter, not the meta screen.
        if (live) setCast(list);
      },
      (err: unknown) => console.error('[meta] failed to load characters', err),
    );
    api.getMetaStages().then(
      // Stages that fail to load cost the staged scene, not the meta screen:
      // an empty list resolves to null and the default layout stands in.
      (list) => {
        if (live) setStages(list);
      },
      (err: unknown) => console.error('[meta] failed to load meta stages', err),
    );
    return () => {
      live = false;
    };
  }, []);

  const playableIds = useMemo(() => games.filter((g) => !g.isTutorial).map((g) => g.id), [games]);
  const stage = useMemo(() => {
    if (forceStageId !== null) return stages.find((s) => s.id === forceStageId) ?? null;
    return resolveStage(stages, results, playableIds);
  }, [stages, results, playableIds, forceStageId]);

  const chatty = cast.filter((c): c is MetaCharacter => c.metaDialogueId !== null);
  const byId = new Map(cast.map((c) => [c.id, c]));

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
                        <CharacterMedia character={c} />
                        <span className="status status-active meta-char-tag">
                          <i className="marker" />
                          Диалог
                        </span>
                      </span>
                      <span className="status meta-char-name">{c.name}</span>
                      {/* Outside the frame: it clips overflow, the note is wider. */}
                      <CharacterInfo description={c.description} />
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
 * A character at an absolute spot on the stage. x/y are percent of the stage
 * box and address the sprite's centre, so the translate is part of the anchor,
 * not decoration. Without a dialogue the figure is scenery: rendered as a plain
 * element, so it neither invites a click nor takes keyboard focus.
 */
function PlacedCharacter({
  entry,
  character,
  onCharacter,
}: {
  entry: MetaStageCharacter;
  character: Character;
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
        <CharacterMedia character={character} />
        {dialogueId !== null && (
          <span className="status status-active meta-char-tag">
            <i className="marker" />
            Диалог
          </span>
        )}
      </span>
      <span className="status meta-char-name">{character.name}</span>
      <CharacterInfo description={character.description} />
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
