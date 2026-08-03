import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSnapshot as cameraSnapshot, subscribe as subscribeCamera } from '../camera/camera';
import { silhouetteFor } from './Silhouettes';
import { OLEG, advance, type DialogueDoc } from './engine';

/** Portrait source for one speaker id (`characters` row, trimmed). */
export interface SceneCharacter {
  name: string;
  portraitAsset: string | null;
}

interface DialogueSceneProps {
  doc: DialogueDoc;
  /** Speaker id → portrait/name. `oleg` is not here: he is the webcam. */
  cast: Record<string, SceneCharacter>;
  /** Character of the running game — occupies the free side if nobody else does. */
  partner: string | null;
  /** Feeds bottom-bar slot 2 with the current line (docs/platform.md §1.2). */
  onContext: (node: ReactNode) => void;
  onFinish: () => void;
}

const CHAR_MS = 22;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Oleg's portrait is the player: the live webcam frame, or his silhouette. */
function OlegPortrait() {
  const cam = useSyncExternalStore(subscribeCamera, cameraSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || cam.status !== 'live') return;
    video.srcObject = cam.stream;
    void video.play().catch(() => {
      // Autoplay refused — the frame stays black, the scene still plays.
    });
    return () => {
      video.srcObject = null;
    };
  }, [cam]);

  if (cam.status !== 'live') return silhouetteFor(OLEG);
  return <video ref={videoRef} className="portrait-media" muted playsInline />;
}

interface PortraitProps {
  id: string | null;
  side: 'left' | 'right';
  speaking: boolean;
  cast: Record<string, SceneCharacter>;
}

function Portrait({ id, side, speaking, cast }: PortraitProps) {
  if (id === null) return <div className="portrait portrait-empty" />;
  const character = cast[id];
  const name = id === OLEG ? 'Олег' : (character?.name ?? '???');
  return (
    <figure
      key={id}
      className={`portrait portrait-${side} ${speaking ? 'portrait-speaking' : 'portrait-muted'}`}
    >
      <div className="portrait-frame">
        {id === OLEG ? (
          <OlegPortrait />
        ) : character?.portraitAsset ? (
          <img className="portrait-media" src={character.portraitAsset} alt="" />
        ) : (
          silhouetteFor(id)
        )}
      </div>
      <figcaption className={`status ${speaking ? 'status-active' : 'status-idle'}`}>
        {name}
      </figcaption>
    </figure>
  );
}

/**
 * Visual-novel renderer (docs/dialogue-system.md §2): portraits on both sides,
 * the line typed out into bottom-bar slot 2, choices as cards in the work area.
 * A click either completes the typing or advances the graph.
 */
export function DialogueScene({ doc, cast, partner, onContext, onFinish }: DialogueSceneProps) {
  const [nodeId, setNodeId] = useState(doc.start);
  const [shown, setShown] = useState(0);

  const node = doc.nodes[nodeId] ?? null;
  const text = node?.text ?? '';
  const done = shown >= text.length;

  // Latest callbacks without re-running the effects that use them.
  const cb = useRef({ onContext, onFinish });
  cb.current = { onContext, onFinish };

  // Who stands where: the current speaker takes `side`, the other side keeps
  // whoever spoke there last (Oleg left / the game character right initially).
  const initialSides = useMemo(() => {
    const other = Object.values(doc.nodes).find((n) => n.speaker !== OLEG)?.speaker ?? partner;
    return { left: OLEG as string | null, right: other };
  }, [doc, partner]);
  const [sides, setSides] = useState(initialSides);

  useEffect(() => {
    if (!node) return;
    setSides((prev) =>
      prev[node.side] === node.speaker ? prev : { ...prev, [node.side]: node.speaker },
    );
  }, [node]);

  // Typewriter. Restarts per node, even when two nodes carry the same text.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [nodeId, text]);

  // Mirror the line into the bottom bar; clear the slot when the scene leaves.
  useEffect(() => {
    const speaker = node?.side === 'left' ? sides.left : sides.right;
    const name = speaker === OLEG ? 'Олег' : (speaker !== null && cast[speaker]?.name) || '';
    cb.current.onContext(
      <>
        <div className="label">{name}</div>
        <p className="dialogue-line">
          {text.slice(0, shown)}
          {!done && <i className="boot-cursor" />}
        </p>
      </>,
    );
  }, [text, shown, done, node, sides, cast]);

  useEffect(() => () => cb.current.onContext(null), []);

  // Only reachable if the graph is broken mid-play — leave rather than hang.
  useEffect(() => {
    if (!node) cb.current.onFinish();
  }, [node]);

  function go(choiceIndex?: number): void {
    const next = advance(doc, nodeId, choiceIndex);
    if (next === null) onFinish();
    else setNodeId(next);
  }

  function onSceneClick(): void {
    if (!done) return setShown(text.length);
    if (node && node.choices.length > 0) return; // waiting for a card
    go();
  }

  const choices = done && node ? node.choices : [];

  return (
    <div className="dialogue-scene" onClick={onSceneClick}>
      <div className="dialogue-stage">
        <Portrait
          id={node?.side === 'left' ? node.speaker : sides.left}
          side="left"
          speaking={node?.side === 'left'}
          cast={cast}
        />
        <Portrait
          id={node?.side === 'right' ? node.speaker : sides.right}
          side="right"
          speaking={node?.side === 'right'}
          cast={cast}
        />
      </div>

      {choices.length > 0 && (
        <div className="dialogue-choices">
          {choices.map((choice, i) => (
            <button
              key={`${choice.next}-${i}`}
              type="button"
              className="btn dialogue-choice"
              onClick={(e) => {
                e.stopPropagation();
                go(i);
              }}
            >
              {choice.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
