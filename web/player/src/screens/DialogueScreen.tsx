import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { DialogueScene, type SceneCharacter } from '../dialogue/DialogueScene';
import { parseDialogue, type DialogueDoc } from '../dialogue/engine';
import type { AudioPrefs } from '../state/localState';
import { useMusicLoop } from '../ui/useMusicLoop';

interface DialogueScreenProps {
  dialogueId: number;
  /** `games.character_id` — the portrait facing Oleg when the doc names nobody. */
  characterId: number | null;
  /** Громкость/мьют игрока — ими живёт фоновая петля сцены (`doc.music`). */
  prefs: AudioPrefs;
  /** Bottom-bar slot 2, driven by the scene. */
  onContext: (node: ReactNode) => void;
  /** Dialogue played out (or turned out to be unusable) — move the chain on. */
  onFinish: () => void;
}

/**
 * Loads one dialogue + the cast and hands them to the renderer. A missing,
 * broken or empty dialogue finishes immediately: a content bug in the admin
 * must never block the game (docs/platform.md §2.4).
 */
export function DialogueScreen({
  dialogueId,
  characterId,
  prefs,
  onContext,
  onFinish,
}: DialogueScreenProps) {
  const [doc, setDoc] = useState<DialogueDoc | null>(null);
  const [cast, setCast] = useState<Record<string, SceneCharacter>>({});

  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    let live = true;
    setDoc(null);
    Promise.all([api.getDialogue(dialogueId), api.getCharacters().catch(() => [])]).then(
      ([dialogue, characters]) => {
        if (!live) return;
        const parsed = parseDialogue((dialogue as { nodes?: unknown }).nodes);
        if (!parsed) {
          console.warn('[dialogue] empty or malformed dialogue, skipping', dialogueId);
          finishRef.current();
          return;
        }
        setCast(
          Object.fromEntries(
            characters.map((c) => [
              String(c.id),
              {
                name: c.name,
                portraitAsset: c.portraitAsset,
                description: c.description,
              } satisfies SceneCharacter,
            ]),
          ),
        );
        setDoc(parsed);
      },
      (err: unknown) => {
        console.error('[dialogue] failed to load', dialogueId, err);
        if (live) finishRef.current();
      },
    );
    return () => {
      live = false;
    };
  }, [dialogueId]);

  // Фон сцены звучит, пока сцена на экране: уход на мини-игру или на мету
  // размонтирует экран, и петля глохнет вместе с ним.
  useMusicLoop({ url: doc?.music ?? null, active: true, prefs });

  if (!doc) {
    return (
      <div className="screen screen-stub">
        <span className="label">Соединение…</span>
      </div>
    );
  }

  return (
    <DialogueScene
      key={dialogueId}
      doc={doc}
      cast={cast}
      partner={characterId === null ? null : String(characterId)}
      onContext={onContext}
      onFinish={onFinish}
    />
  );
}
