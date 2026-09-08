import { useEffect, useRef, useState } from 'react';
import { api, type Asset, type AssetUsage } from '../api';
import { showToast } from '../toast';
import { MEDIA_ACCEPT } from '../asset-accept';
import { MultiAudioWidget, normalizeAudio, type WeightedAudio } from '../schema-form/SchemaForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} МБ`;
  return `${(bytes / 1_000).toFixed(1)} КБ`;
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  image: 'Изображение',
  gif: 'GIF',
  audio: 'Аудио',
};

const ASSET_USAGE_KIND: Record<AssetUsage['kind'], string> = {
  game: 'игра',
  character: 'персонаж',
  dialogue: 'диалог',
  metaStage: 'этап меты',
  setting: 'настройка',
};

/**
 * Текст-приписка к подтверждению удаления ассета: список мест, где он
 * используется, или пустая строка, если использований нет — в этом случае
 * подтверждение остаётся коротким, без пустого «используется:» блока.
 *
 * В отличие от диалогов, ссылка на удалённый ассет в конфиге не обнуляется
 * (это отдельное решение, которое никто не принимал) — поэтому текст честно
 * предупреждает, что ссылки останутся битыми, а не «будут сняты».
 */
export function formatAssetUsageWarning(usage: AssetUsage[]): string {
  if (usage.length === 0) return '';
  const used = usage
    .map((u) => `• ${ASSET_USAGE_KIND[u.kind]} «${u.title}» (#${u.id}) — ${u.field}`)
    .join('\n');
  return `\n\nОн используется:\n${used}\n\nЭти ссылки останутся битыми.`;
}

// ---------------------------------------------------------------------------
// Asset card
// ---------------------------------------------------------------------------

interface AssetCardProps {
  asset: Asset;
  onDelete: (id: string) => void;
}

function AssetCard({ asset, onDelete }: AssetCardProps) {
  return (
    <div className='asset-card'>
      <div className='asset-card-preview'>
        {(asset.kind === 'image' || asset.kind === 'gif') ? (
          <img src={asset.url} alt={asset.originalName} className='asset-thumb' />
        ) : (
          <audio controls src={asset.url} className='asset-audio' />
        )}
      </div>
      <div className='asset-card-info'>
        <span className='asset-name' title={asset.originalName}>{asset.originalName}</span>
        <div className='asset-meta'>
          <span className={`asset-kind-badge asset-kind-badge--${asset.kind}`}>
            {KIND_LABEL[asset.kind]}
          </span>
          <span className='asset-size'>{formatSize(asset.sizeBytes)}</span>
        </div>
      </div>
      <button className='asset-delete-btn' onClick={() => onDelete(asset.id)} title='Удалить'>
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function AssetsSection() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sounds, setSounds] = useState<WeightedAudio[]>([]);
  const [soundSaving, setSoundSaving] = useState(false);
  const [soundSaved, setSoundSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load assets + settings on mount
  useEffect(() => {
    void Promise.all([api.getAssets(), api.getSettings()]).then(([list, s]) => {
      setAssets(list);
      setSounds(normalizeAudio(s.ui_click_sound_url));
      setLoading(false);
    }).catch((e: unknown) => {
      // Молчаливый провал показывал «Нет загруженных ассетов» — пустую библиотеку
      // не отличить от упавшего запроса.
      showToast(e instanceof Error ? e.message : 'Ошибка загрузки ассетов', 'error');
      setLoading(false);
    });
  }, []);

  async function handleUpload(files: FileList) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded: Asset[] = [];
      for (const file of Array.from(files)) {
        const asset = await api.uploadAsset(file);
        uploaded.push(asset);
      }
      setAssets((prev) => [...uploaded, ...prev]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    const deleted = assets.find((a) => a.id === id);
    if (!deleted) return;
    // Сперва спрашиваем сервер, кто на ассет ссылается: молчаливое удаление
    // оставляло битые ссылки в конфигах игр, портретах, узлах диалогов и
    // мете — всплывали они уже в check-content, после выгрузки контента в гит.
    let usage: AssetUsage[];
    try {
      usage = await api.getAssetUsage(id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось проверить использование', 'error');
      return;
    }
    const warn = formatAssetUsageWarning(usage);
    if (!window.confirm(`Удалить файл «${deleted.originalName}»?${warn}`)) return;
    try {
      await api.deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      const next = sounds.filter((s) => s.url !== deleted.url);
      if (next.length !== sounds.length) {
        setSounds(next);
        await saveSounds(next);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  async function saveSounds(list: WeightedAudio[]) {
    setSoundSaving(true);
    try {
      const updated = await api.updateSettings({ ui_click_sound_url: list.length ? list : null });
      setSounds(normalizeAudio(updated.ui_click_sound_url));
      setSoundSaved(true);
      setTimeout(() => setSoundSaved(false), 2000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка сохранения', 'error');
    } finally {
      setSoundSaving(false);
    }
  }

  return (
    <div className='assets-section'>
      {/* Upload zone */}
      <div className='assets-header'>
        <h3 className='assets-title'>Ассеты</h3>
        <label
          className={`assets-upload-zone${uploading ? ' assets-upload-zone--busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              void handleUpload(e.dataTransfer.files);
            }
          }}
        >
          <input
            ref={fileInputRef}
            type='file'
            multiple
            accept={MEDIA_ACCEPT}
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleUpload(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {uploading
            ? 'Загрузка…'
            : 'Перетащите файлы сюда или нажмите для выбора'}
        </label>
        {uploadError && <p className='assets-upload-error'>{uploadError}</p>}
      </div>

      {/* Sound setting block */}
      <div className='assets-sound-block'>
        <h4 className='assets-block-title'>Звук нажатия кнопок (мета)</h4>
        <MultiAudioWidget value={sounds} onChange={(v) => setSounds(normalizeAudio(v))} />
        <div className='assets-sound-actions'>
          <button disabled={soundSaving} onClick={() => void saveSounds(sounds)}>
            Сохранить
          </button>
          {soundSaved && <span className='assets-sound-saved'>Сохранено ✓</span>}
        </div>
      </div>

      {/* Asset grid */}
      {loading ? (
        <p className='assets-loading'>Загрузка…</p>
      ) : assets.length === 0 ? (
        <p className='assets-empty'>Нет загруженных ассетов</p>
      ) : (
        <div className='assets-grid'>
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} onDelete={(id) => { void handleDelete(id); }} />
          ))}
        </div>
      )}
    </div>
  );
}
