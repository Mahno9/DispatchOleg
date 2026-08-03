import type { CSSProperties } from 'react';
import type { MetaStage, MetaStageBackground, MetaStageTrigger } from '../api';
import type { GameResult } from '../state/localState';

// ---------------------------------------------------------------------------
// Meta stages — the scene the meta screen shows depends on how far the player
// got. Pure logic, no React: which stage is current, and how its background
// image maps onto CSS. Kept apart from MetaScreen so it stays testable.
// ---------------------------------------------------------------------------

/** True when `results` satisfy the trigger. Only wins count; a played-and-lost
 *  game is worth nothing here, same rule as `isUnlocked`. */
export function stageMatches(
  trigger: MetaStageTrigger,
  results: Record<string, GameResult>,
  playableIds: number[],
): boolean {
  if (trigger.type === 'games') {
    // An empty id list is vacuously satisfied — an "always on" stage.
    return trigger.ids.every((id) => results[String(id)]?.won === true);
  }
  const won = playableIds.filter((id) => results[String(id)]?.won === true).length;
  return won >= trigger.value;
}

/**
 * The stage on screen right now. Stages are ordered by (sortOrder, id) and the
 * LAST satisfied one wins: later stages describe later points in the story, so
 * a stage whose trigger fired most recently overrides everything before it.
 * Nothing satisfied (or nothing configured) → null, i.e. the default scene.
 */
export function resolveStage(
  stages: MetaStage[],
  results: Record<string, GameResult>,
  playableIds: number[],
): MetaStage | null {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  let current: MetaStage | null = null;
  for (const stage of ordered) {
    if (stageMatches(stage.trigger, results, playableIds)) current = stage;
  }
  return current;
}

/**
 * `fit` → background-size, mirroring BG_SIZE in the admin's SchemaForm so the
 * editor preview and the player render the same picture.
 *
 * `scale` multiplies the size only where a size can be written as a percentage
 * of the box: cover/fill-x become `${100*scale}% auto`, contain/fill-y become
 * `auto ${100*scale}%`, center/tile scale the natural size the same way. At
 * scale 1 every entry collapses back to the admin's literal value, so the
 * common case is byte-identical to the preview.
 */
const BG_SIZE: Record<string, string> = {
  cover: 'cover',
  contain: 'contain',
  'fill-x': '100% auto',
  'fill-y': 'auto 100%',
  center: 'auto',
  tile: 'auto',
};

function sizeFor(fit: string, scale: number): string {
  if (scale === 1) return BG_SIZE[fit] ?? 'cover';
  const pct = `${100 * scale}%`;
  switch (fit) {
    case 'contain':
    case 'fill-y':
      return `auto ${pct}`;
    case 'center':
    case 'tile':
      // No box-relative baseline to scale from — the picture keeps its natural
      // width and the multiplier applies to it.
      return `${pct} auto`;
    case 'cover':
    case 'fill-x':
    default:
      return `${pct} auto`;
  }
}

/**
 * `offset` is a percentage of the stage box (the admin drags in the same units:
 * it converts px → percent of the preview, so the two agree at any size). The
 * fit-dependent axis handling is copied from BgPreviewBox: a stretched axis has
 * no slack to shift along, so only the free axis takes the offset, and a tiled
 * background offsets from the origin rather than from the centre.
 */
function positionFor(fit: string, x: number, y: number): string {
  switch (fit) {
    case 'fill-x':
      return `center calc(50% + ${y}%)`;
    case 'fill-y':
      return `calc(50% + ${x}%) center`;
    case 'tile':
      return `${x}% ${y}%`;
    default:
      return `calc(50% + ${x}%) calc(50% + ${y}%)`;
  }
}

/** Inline style for `.meta-stage` — longhands only, so each one beats the
 *  `background` shorthand the theme sets on the class. */
export function bgStyle(bg: MetaStageBackground): CSSProperties {
  if (!bg.image) return {};
  const fit = bg.fit ?? 'cover';
  const scale = typeof bg.scale === 'number' && bg.scale > 0 ? bg.scale : 1;
  const x = bg.offset?.x ?? 0;
  const y = bg.offset?.y ?? 0;
  return {
    backgroundImage: `url(${bg.image})`,
    backgroundSize: sizeFor(fit, scale),
    backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: positionFor(fit, x, y),
    backgroundColor: 'var(--page)',
  };
}
