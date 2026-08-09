import { useState } from 'react';

interface CharacterInfoProps {
  /** `characters.description`. Empty — nothing is rendered at all. */
  description: string;
  /**
   * Render the ⓘ as a real button that pins the note open. Off where the
   * character already sits inside a `<button>` (the meta screen): a nested
   * button is invalid markup, and there the whole figure is the hover target.
   */
  pinnable?: boolean;
}

/**
 * Who this character is, revealed on hover/focus of the enclosing frame — the
 * frame owns the CSS, this only supplies the markup and the pinned state.
 */
export function CharacterInfo({ description, pinnable = false }: CharacterInfoProps) {
  const [pinned, setPinned] = useState(false);
  if (!description) return null;

  return (
    <>
      {pinnable ? (
        <button
          type="button"
          className="char-info-dot"
          aria-expanded={pinned}
          aria-label="О персонаже"
          // The whole dialogue scene advances on click (DialogueScene) — the ⓘ must not.
          onClick={(e) => {
            e.stopPropagation();
            setPinned((p) => !p);
          }}
        >
          i
        </button>
      ) : (
        <i className="char-info-dot" aria-hidden="true">
          i
        </i>
      )}
      <p className={`char-info-note${pinned ? ' char-info-note--pinned' : ''}`}>{description}</p>
    </>
  );
}
