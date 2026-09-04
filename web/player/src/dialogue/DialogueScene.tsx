import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSnapshot as cameraSnapshot, subscribe as subscribeCamera } from '../camera/camera';
import { CharacterInfo } from './CharacterInfo';
import { DialogueLine, useTypewriter } from './Line';
import { silhouetteFor } from './Silhouettes';
import { OLEG, advance, initialSides, type DialogueDoc } from './engine';

/** Portrait source for one speaker id (`characters` row, trimmed). */
export interface SceneCharacter {
  name: string;
  portraitAsset: string | null;
  description: string;
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
  /** `doc.remote` — draw the portrait as a comms panel instead of a figure. */
  remote: boolean;
  cast: Record<string, SceneCharacter>;
}

function Portrait({ id, side, speaking, remote, cast }: PortraitProps) {
  if (id === null) return <div className="portrait portrait-empty" />;
  const character = cast[id];
  const name = id === OLEG ? 'Олег' : (character?.name ?? '???');
  // Oleg is always on a screen — his side of the terminal is the camera feed,
  // live or not. Everyone else only when the scene is a call.
  const framed = id === OLEG ? ' portrait-dispatcher' : remote ? ' portrait-remote' : '';
  return (
    <figure
      key={id}
      className={`portrait portrait-${side} ${
        speaking ? 'portrait-speaking' : 'portrait-muted'
      }${framed}`}
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
      {/* Outside .portrait-frame on purpose: the listener's frame is dimmed by a
          filter, and the note must stay readable there too. */}
      <CharacterInfo description={character?.description ?? ''} pinnable />
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

  const node = doc.nodes[nodeId] ?? null;
  const text = node?.text ?? '';
  // Печать живёт в общем useTypewriter (dialogue/Line.tsx) — там же появится
  // её звук. Ключ nodeId: две подряд ноды с одинаковым текстом печатаются заново.
  const { shown, done, skip } = useTypewriter(text, nodeId);
  // Misclick guard for nodes with an external link: the scene refuses to
  // advance until the player actually opened it.
  const [linkOpened, setLinkOpened] = useState(false);
  useEffect(() => setLinkOpened(false), [nodeId]);

  // Latest callbacks without re-running the effects that use them.
  const cb = useRef({ onContext, onFinish });
  cb.current = { onContext, onFinish };

  // Who stands where: the current speaker takes `side`, the other side keeps
  // whoever spoke there last (per-side seeding lives in engine.initialSides).
  const seededSides = useMemo(() => initialSides(doc, partner), [doc, partner]);
  const [sides, setSides] = useState(seededSides);

  useEffect(() => {
    if (!node) return;
    setSides((prev) =>
      prev[node.side] === node.speaker ? prev : { ...prev, [node.side]: node.speaker },
    );
  }, [node]);

  // Mirror the line into the bottom bar; clear the slot when the scene leaves.
  useEffect(() => {
    const speaker = node?.side === 'left' ? sides.left : sides.right;
    const name = speaker === OLEG ? 'Олег' : (speaker !== null && cast[speaker]?.name) || '';
    cb.current.onContext(
      <DialogueLine
        name={name}
        text={text}
        shown={shown}
        done={done}
        side={node?.side === 'right' ? 'right' : 'left'}
        onClick={onSceneClick}
      />,
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
    if (!done) return skip();
    if (node && node.choices.length > 0) return; // waiting for a card
    if (node?.link && !linkOpened) return; // waiting for the link to be opened
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
          remote={doc.remote}
          cast={cast}
        />
        <Portrait
          id={node?.side === 'right' ? node.speaker : sides.right}
          side="right"
          speaking={node?.side === 'right'}
          remote={doc.remote}
          cast={cast}
        />
      </div>

      {done && node?.link && (
        <div className="dialogue-choices">
          <a
            className="btn dialogue-choice"
            href={node.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              setLinkOpened(true);
            }}
          >
            {node.link.replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}

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
