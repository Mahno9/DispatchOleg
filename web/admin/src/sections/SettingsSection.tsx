import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';
import { AssetPickerModal } from '../schema-form/AssetPickerModal';
import { showToast } from '../toast';

/** ui_click_sound_url хранится либо строкой, либо взвешенным списком (вкладка «Ассеты»). */
function firstSoundUrl(value: Settings['ui_click_sound_url']): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? (value[0]?.url ?? '') : '';
}

export function SettingsSection() {
  const [interval, setIntervalS] = useState('');
  const [sound, setSound] = useState('');
  const [savedSound, setSavedSound] = useState('');
  const [weighted, setWeighted] = useState(false);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(s: Settings) {
    setIntervalS(String(s.sync_interval_s ?? ''));
    setSound(firstSoundUrl(s.ui_click_sound_url));
    setSavedSound(firstSoundUrl(s.ui_click_sound_url));
    setWeighted(Array.isArray(s.ui_click_sound_url) && s.ui_click_sound_url.length > 1);
  }

  useEffect(() => {
    api
      .getSettings()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const seconds = Number(interval);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      showToast('Интервал синхронизации — положительное число секунд', 'error');
      return;
    }
    setSaving(true);
    try {
      // Звук шлём, только если его меняли — иначе взвешенный список из «Ассетов» схлопнется в один.
      apply(
        await api.updateSettings({
          sync_interval_s: seconds,
          ...(sound === savedSound ? {} : { ui_click_sound_url: sound || null }),
        }),
      );
      showToast('Сохранено');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className='minigames-empty'>Загрузка…</p>;

  return (
    <div className='lb-section'>
      <h3 className='lb-block-title'>Настройки</h3>
      {error && <p className='sf-asset-error'>{error}</p>}

      <div className='two-pane-panel poi-edit-panel'>
        <label className='poi-field-label'>Интервал синхронизации прогресса, с</label>
        <input
          type='number'
          min={1}
          value={interval}
          onChange={(e) => setIntervalS(e.target.value)}
        />

        <label className='poi-field-label'>Звук нажатия кнопок</label>
        <div className='char-portrait-row'>
          {sound ? <audio controls preload='none' src={sound} /> : <span className='minigames-empty'>не выбран</span>}
          <button onClick={() => setPicking(true)}>Выбрать…</button>
          {sound && <button onClick={() => setSound('')}>Очистить</button>}
        </div>
        {weighted && (
          <p className='dlg-warn'>
            Сейчас задано несколько звуков со случайным выбором — сохранение здесь оставит только
            один. Взвешенный список правится во вкладке «Ассеты».
          </p>
        )}

        <div className='poi-panel-actions'>
          <button className='modal-save-primary' disabled={saving} onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </div>

      {picking && (
        <AssetPickerModal
          kinds={['audio']}
          onPick={(url) => {
            setSound(url);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
