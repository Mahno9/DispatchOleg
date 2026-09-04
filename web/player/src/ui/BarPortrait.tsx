import { silhouetteFor } from '../dialogue/Silhouettes';
import type { Character } from '../api';

/**
 * Портрет собеседника в нижней панели — тот же кадр связи, что и в диалоге
 * (`.portrait-remote`), только размером со слот: во время мини-игры персонаж
 * диктует подсказки по громкой связи и должен быть виден.
 */
export function BarPortrait({
  character,
  speaking = true,
}: {
  character: Character;
  speaking?: boolean;
}) {
  return (
    <figure
      className={`portrait portrait-remote bar-portrait ${
        speaking ? 'portrait-speaking' : 'portrait-muted'
      }`}
    >
      <div className="portrait-frame">
        {character.portraitAsset ? (
          <img className="portrait-media" src={character.portraitAsset} alt="" />
        ) : (
          silhouetteFor(String(character.id))
        )}
      </div>
    </figure>
  );
}
