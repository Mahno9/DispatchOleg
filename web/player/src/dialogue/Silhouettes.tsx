import type { ReactNode } from 'react';
import { OLEG } from './engine';

/**
 * Hand-drawn hero busts, used wherever a character has no portrait asset.
 *
 * Rules of the set: one solid shape per figure (`currentColor`, coloured by
 * `.avatar-silhouette`), head-and-shoulders framing, nothing thinner than a few
 * units — these are read at ~100x140 px on a phone. `xMidYMax` stands the figure
 * on the floor of its slot, the way the drawn portrait assets sit.
 */
function Bust({ children }: { children: ReactNode }) {
  return (
    <svg
      className="avatar-silhouette"
      viewBox="0 0 120 160"
      preserveAspectRatio="xMidYMax meet"
      fill="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Plain shoulders and a neck, shared by the figures that wear neither. */
const SHOULDERS = 'M60 92c-26 0-44 18-48 68h96c-4-50-22-68-48-68z';
const NECK = 'M50 72h20v26H50z';

/** Cape and high collar: the collar peaks flank the head, the cape flares out. */
function Caped() {
  return (
    <Bust>
      <path d="M18 26 52 84h16L102 26l8 134H10z" />
      <path d="M52 60h16v26H52z" />
      <circle cx="60" cy="48" r="20" />
    </Bust>
  );
}

/** Hood: the face is the hole, which is the whole read. */
function Hooded() {
  return (
    <Bust>
      <path
        fillRule="evenodd"
        d="M60 16c-22 0-34 20-34 44 0 14 4 26 10 34h48c6-8 10-20 10-34 0-24-12-44-34-44Zm0 22c12 0 20 12 20 26s-8 24-20 24-20-10-20-24 8-26 20-26Z"
      />
      <path d={SHOULDERS} />
    </Bust>
  );
}

/** Cowl with pointed ears. */
function Cowled() {
  return (
    <Bust>
      <path d="M38 36 30 2l22 24z" />
      <path d="M82 36 90 2 68 26z" />
      <path d="M60 24c-18 0-28 14-28 32s12 30 28 30 28-12 28-30-10-32-28-32z" />
      <path d={NECK} />
      <path d={SHOULDERS} />
    </Bust>
  );
}

/** Full helmet, visor cut straight through it. */
function Helmeted() {
  return (
    <Bust>
      <path
        fillRule="evenodd"
        d="M60 20c-20 0-31 14-31 34v42h62V54c0-20-11-34-31-34Zm-24 34h48v16H36Z"
      />
      <path d={SHOULDERS} />
    </Bust>
  );
}

/** Armoured pauldrons: slabs sitting off the chest, seam left open. */
function Pauldroned() {
  return (
    <Bust>
      <circle cx="60" cy="46" r="20" />
      <path d="M52 62h16v30H52z" />
      <path d="M60 86c-10 0-16 8-18 74h36c-2-66-8-74-18-74z" />
      <path d="M6 100 46 88v52l-40 8z" />
      <path d="M114 100 74 88v52l40 8z" />
    </Bust>
  );
}

/** Domino mask under a swept quiff. */
function Masked() {
  return (
    <Bust>
      <path d="M36 32C44 12 80 6 94 22 78 20 66 24 58 34c-6-4-16-4-22-2z" />
      <path fillRule="evenodd" d="M60 26a22 22 0 1 1 0 44 22 22 0 0 1 0-44Zm-20 16h40v12H40Z" />
      <path d={NECK} />
      <path d={SHOULDERS} />
    </Bust>
  );
}

/** Tech headset with a stub antenna. */
function Antennaed() {
  return (
    <Bust>
      <path d="M88 34h6V14h-6z" />
      <circle cx="91" cy="10" r="7" />
      <path d="M30 54a30 30 0 0 1 60 0H80a20 20 0 0 0-40 0z" />
      <circle cx="30" cy="58" r="10" />
      <circle cx="60" cy="52" r="21" />
      <path d={NECK} />
      <path d={SHOULDERS} />
    </Bust>
  );
}

/** Long coat, collar popped, lapels open down the chest. */
function Coated() {
  return (
    <Bust>
      <path d="M30 96 34 58l24 28z" />
      <path d="M90 96 86 58 62 86z" />
      <path fillRule="evenodd" d="M60 82 30 96l-10 64h80l-10-64Zm0 22 10 26-10 30-10-30Z" />
      <circle cx="60" cy="44" r="19" />
      <path d="M52 58h16v28H52z" />
    </Bust>
  );
}

/** Oleg is the dispatcher: headphones and a mic boom, never the modulo. */
function Dispatcher() {
  return (
    <Bust>
      <path d="M32 50a28 28 0 0 1 56 0h-9a19 19 0 0 0-38 0z" />
      <path d="M60 24c-16 0-24 10-24 26s8 26 24 26 24-10 24-26-8-26-24-26z" />
      <rect x="22" y="48" width="16" height="28" rx="7" />
      <rect x="82" y="48" width="16" height="28" rx="7" />
      <path d="M24 76c0 18 11 28 26 31v-11c-11-3-17-10-17-20z" />
      <circle cx="54" cy="102" r="7" />
      <path d={NECK} />
      <path d={SHOULDERS} />
    </Bust>
  );
}

const SILHOUETTES = [Caped, Hooded, Cowled, Helmeted, Pauldroned, Masked, Antennaed, Coated];

/** Deterministic stand-in for a character with no portrait: `id % 8`, Oleg apart. */
export function silhouetteFor(id: string | number) {
  if (id === OLEG) return <Dispatcher />;
  // A non-numeric id lands on NaN, i.e. on the fallback figure.
  const Figure = SILHOUETTES[Math.abs(Math.trunc(Number(id))) % SILHOUETTES.length] ?? Caped;
  return <Figure />;
}
