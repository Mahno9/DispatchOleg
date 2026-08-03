import { useEffect, useState } from 'react';
import { api, type Asset } from '../api';

// ---------------------------------------------------------------------------
// AssetPickerModal — choose an already-uploaded asset matching the field type.
// ---------------------------------------------------------------------------

interface AssetPickerProps {
  kinds: Asset['kind'][];
  onPick: (url: string) => void;
  onClose: () => void;
}

export function AssetPickerModal({ kinds, onPick, onClose }: AssetPickerProps) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAssets()
      .then((all) => setAssets(all.filter((a) => kinds.includes(a.kind))))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
    // kinds is a fresh array each render; compare by content
  }, [kinds.join(',')]);

  // Esc closes only this picker (capture + preventDefault → parent modal stays).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const isAudio = kinds.length === 1 && kinds[0] === 'audio';

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-card asset-picker-modal' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <span className='modal-title'>Выбор ассета</span>
          <button className='modal-close' title='Закрыть' onClick={onClose}>
            ✕
          </button>
        </div>
        <div className='modal-body'>
          {error && <p className='sf-asset-error'>{error}</p>}
          {!assets && !error && <p>Загрузка…</p>}
          {assets && assets.length === 0 && <p className='minigames-empty'>Нет подходящих ассетов.</p>}
          {assets && assets.length > 0 && (
            <div className={isAudio ? 'asset-picker-audio' : 'asset-picker'}>
              {assets.map((a) =>
                isAudio ? (
                  <div className='asset-picker-arow' key={a.id}>
                    <button type='button' className='asset-picker-pick' onClick={() => onPick(a.url)}>
                      Выбрать
                    </button>
                    <span className='asset-picker-name'>{a.originalName}</span>
                    <audio controls preload='none' src={a.url} className='asset-picker-audio-prev' />
                  </div>
                ) : (
                  <button
                    type='button'
                    className='asset-picker-item'
                    key={a.id}
                    title={a.originalName}
                    onClick={() => onPick(a.url)}
                  >
                    <img src={a.url} alt='' />
                    <span>{a.originalName}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
