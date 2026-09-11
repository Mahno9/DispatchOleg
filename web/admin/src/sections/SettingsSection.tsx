import { useEffect, useState } from 'react';
import { api, playerTestUrl, type Settings } from '../api';
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
  const [music, setMusic] = useState('');
  const [victoryText, setVictoryText] = useState('');
  const [voices, setVoices] = useState('');
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'click' | 'music' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(s: Settings) {
    setIntervalS(String(s.sync_interval_s ?? ''));
    setSound(firstSoundUrl(s.ui_click_sound_url));
    setSavedSound(firstSoundUrl(s.ui_click_sound_url));
    setWeighted(Array.isArray(s.ui_click_sound_url) && s.ui_click_sound_url.length > 1);
    setMusic(s.meta_music_url ?? '');
    setVictoryText(s.final_victory_text ?? '');
    setVoices(s.character_voices ? JSON.stringify(s.character_voices, null, 2) : '');
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

    const trimmedVoices = voices.trim();
    let voicesPatch: Record<string, unknown> | null = null;
    if (trimmedVoices) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmedVoices);
      } catch {
        setVoicesError('Невалидный JSON');
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setVoicesError('Ожидается объект вида { [speakerId]: preset }');
        return;
      }
      const allowedWaves = ['sine', 'triangle', 'square', 'sawtooth'];
      for (const [speakerId, preset] of Object.entries(parsed as Record<string, unknown>)) {
        const p = (preset ?? {}) as Record<string, unknown>;
        if (typeof preset !== 'object' || preset === null || !allowedWaves.includes(p.wave as string)) {
          setVoicesError(
            `${speakerId}: поле wave должно быть одним из sine/triangle/square/sawtooth`,
          );
          return;
        }
        if (!Number.isFinite(p.hz) || !Number.isFinite(p.charMs) || !Number.isFinite(p.blipMs)) {
          setVoicesError(`${speakerId}: поля hz/charMs/blipMs должны быть числами`);
          return;
        }
      }
      voicesPatch = parsed as Record<string, unknown>;
    }
    setVoicesError(null);

    setSaving(true);
    try {
      // Звук шлём, только если его меняли — иначе взвешенный список из «Ассетов» схлопнется в один.
      apply(
        await api.updateSettings({
          sync_interval_s: seconds,
          meta_music_url: music || null,
          final_victory_text: victoryText.trim() ? victoryText : null,
          character_voices: voicesPatch,
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
          <button onClick={() => setPicking('click')}>Выбрать…</button>
          {sound && <button onClick={() => setSound('')}>Очистить</button>}
        </div>
        {weighted && (
          <p className='dlg-warn'>
            Сейчас задано несколько звуков со случайным выбором — сохранение здесь оставит только
            один. Взвешенный список правится во вкладке «Ассеты».
          </p>
        )}

        <label className='poi-field-label'>Фоновая музыка лобби</label>
        <div className='char-portrait-row'>
          {music ? <audio controls preload='none' src={music} /> : <span className='minigames-empty'>не выбрана</span>}
          <button onClick={() => setPicking('music')}>Выбрать…</button>
          {music && <button onClick={() => setMusic('')}>Очистить</button>}
        </div>

        <label className='poi-field-label'>Текст финальной победы</label>
        <textarea
          className='meta-ed-victory-text'
          rows={4}
          value={victoryText}
          placeholder='Показывается игроку, когда пройдены все игры'
          onChange={(e) => setVictoryText(e.target.value)}
        />

        <label className='poi-field-label'>Голоса персонажей (JSON)</label>
        <p className='minigames-empty'>
          Вставьте JSON из демо-страницы бубнежа (кнопка «скопировать пресеты»)
        </p>
        <textarea
          rows={8}
          value={voices}
          placeholder='{ "oleg": { "source": "osc", "wave": "triangle", "hz": 210, "charMs": 30, "blipMs": 50 } }'
          onChange={(e) => setVoices(e.target.value)}
        />
        {voicesError && <p className='sf-asset-error'>{voicesError}</p>}

        <div className='poi-panel-actions'>
          <button className='modal-save-primary' disabled={saving} onClick={() => void save()}>
            Сохранить
          </button>
          <button onClick={() => window.open(playerTestUrl('endgame'), '_blank')}>
            ▶ Эндгейм в плеере
          </button>
        </div>
      </div>

      {picking && (
        <AssetPickerModal
          kinds={['audio']}
          onPick={(url) => {
            if (picking === 'music') setMusic(url);
            else setSound(url);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
