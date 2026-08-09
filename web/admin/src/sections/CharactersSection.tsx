import { useEffect, useState } from 'react';
import { api, type Character } from '../api';
import { AssetPickerModal } from '../schema-form/AssetPickerModal';
import { showToast } from '../toast';
import { Segmented } from '../ui/Segmented';

const NEW_ID = 0;

const blank: Character = {
  id: NEW_ID,
  name: '',
  portraitAsset: null,
  metaDialogueId: null,
  metaPosition: 'left',
  description: '',
};

export function CharactersSection() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [dialogues, setDialogues] = useState<{ id: number; title: string }[]>([]);
  const [draft, setDraft] = useState<Character | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getCharacters(), api.getDialogues()])
      .then(([c, d]) => {
        setCharacters(c);
        setDialogues(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }, []);

  function patch(p: Partial<Character>) {
    setDraft((cur) => (cur ? { ...cur, ...p } : cur));
  }

  async function save() {
    if (!draft) return;
    const { id, ...body } = draft;
    setSaving(true);
    setError(null);
    try {
      const saved =
        id === NEW_ID ? await api.createCharacter(body) : await api.updateCharacter(id, body);
      setCharacters(await api.getCharacters());
      setDraft(saved);
      showToast('Сохранено');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || draft.id === NEW_ID) return;
    if (!window.confirm(`Удалить персонажа «${draft.name}»?`)) return;
    try {
      await api.deleteCharacter(draft.id);
      setCharacters(await api.getCharacters());
      setDraft(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  return (
    <div className='lb-section'>
      <div className='poi-panel-header'>
        <h3 className='lb-block-title'>Персонажи</h3>
        <button onClick={() => setDraft({ ...blank })}>+ Новый персонаж</button>
      </div>
      {error && <p className='sf-asset-error'>{error}</p>}

      <div className='two-pane'>
        <div className='two-pane-list'>
          {characters.map((c) => (
            <button
              key={c.id}
              className={`minigames-row${draft?.id === c.id ? ' minigames-row--active' : ''}`}
              onClick={() => setDraft(c)}
            >
              <span className='minigames-row-name'>
                {c.portraitAsset && <img className='char-thumb' src={c.portraitAsset} alt='' />}
                {c.name}
              </span>
              <span className='minigames-row-game'>
                {c.metaDialogueId === null ? 'без меты' : `мета · ${c.metaPosition}`}
              </span>
            </button>
          ))}
          {characters.length === 0 && <p className='minigames-empty'>Персонажей пока нет.</p>}
        </div>

        {draft && (
          <div className='two-pane-panel poi-edit-panel'>
            <div className='poi-panel-header'>
              <strong>
                {draft.id === NEW_ID ? 'Новый персонаж' : `Персонаж #${draft.id}`}
              </strong>
              <button className='poi-close-btn' onClick={() => setDraft(null)}>
                ✕
              </button>
            </div>

            <label className='poi-field-label'>Имя</label>
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />

            <label className='poi-field-label'>Описание (всплывает у игрока по наведению на портрет)</label>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />

            <label className='poi-field-label'>Портрет</label>
            <div className='char-portrait-row'>
              {draft.portraitAsset ? (
                <img className='char-portrait' src={draft.portraitAsset} alt='' />
              ) : (
                <span className='minigames-empty'>не выбран</span>
              )}
              <button onClick={() => setPicking(true)}>Выбрать…</button>
              {draft.portraitAsset && (
                <button onClick={() => patch({ portraitAsset: null })}>Очистить</button>
              )}
            </div>

            <label className='poi-field-label'>Мета-диалог (клик по персонажу)</label>
            <select
              className='poi-select'
              value={draft.metaDialogueId ?? ''}
              onChange={(e) =>
                patch({ metaDialogueId: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value=''>— нет —</option>
              {dialogues.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} (#{d.id})
                </option>
              ))}
            </select>

            <label className='poi-field-label'>Позиция на мета-экране</label>
            <Segmented
              name='char-meta-position'
              options={[
                { value: 'left', label: 'Слева' },
                { value: 'right', label: 'Справа' },
              ]}
              value={draft.metaPosition}
              onChange={(v) => patch({ metaPosition: v })}
            />

            <div className='poi-panel-actions'>
              <button
                className='modal-save-primary'
                disabled={saving || !draft.name}
                onClick={() => void save()}
              >
                {draft.id === NEW_ID ? 'Создать' : 'Сохранить'}
              </button>
              {draft.id !== NEW_ID && (
                <button className='poi-delete-btn' onClick={() => void remove()}>
                  Удалить персонажа
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {picking && (
        <AssetPickerModal
          kinds={['image', 'gif']}
          onPick={(url) => {
            patch({ portraitAsset: url });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
