import { useEffect, useState } from 'react';
import {
  api,
  playerTestUrl,
  type Character,
  type Game,
  type GameInput,
  type Minigame,
} from '../api';
import { MinigameConfigModal, TestRunOverlay, mergeTop, diffTop, type Cfg } from './MinigamesSection';
import { showToast } from '../toast';

type DialogueRef = { id: number; title: string };

const NEW_ID = 0;

function blankGame(minigameId: string, sortOrder: number): Game {
  return {
    id: NEW_ID,
    title: '',
    minigameId,
    config: {},
    characterId: null,
    preDialogueId: null,
    postWinDialogueId: null,
    postLoseDialogueId: null,
    styleDialogues: {},
    requiredGameIds: [],
    sortOrder,
    isTutorial: false,
  };
}

function toInput(game: Game): GameInput & { title: string; minigameId: string } {
  const body = { ...game } as Partial<Game> & { title: string; minigameId: string };
  delete body.id;
  return body;
}

// ---------------------------------------------------------------------------
// Dialogue select — nullable pick from the dialogue list
// ---------------------------------------------------------------------------

function DialogueSelect({
  label,
  dialogues,
  value,
  onChange,
}: {
  label: string;
  dialogues: DialogueRef[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className='poi-edit-panel'>
      <span className='poi-field-label'>{label}</span>
      <select
        className='poi-select'
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value=''>— нет —</option>
        {dialogues.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title} (#{d.id})
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// QR modal — printable code for a game
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function QrModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const url = api.qrUrl(game.id);

  function print() {
    const win = window.open('', '_blank', 'width=560,height=720');
    if (!win) {
      showToast('Браузер заблокировал окно печати', 'error');
      return;
    }
    const title = escapeHtml(game.title);
    win.document.write(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>` +
        `<style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px}` +
        `img{width:340px;height:340px}h1{font-size:22px;margin:16px 0 4px}` +
        `p{font-size:13px;color:#555;margin:0}</style></head><body>` +
        `<img src="${window.location.origin}${url}" onload="window.print()" alt="QR">` +
        `<h1>${title}</h1><p>игра #${game.id}</p></body></html>`,
    );
    win.document.close();
  }

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-card' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <span className='modal-title'>QR — {game.title}</span>
          <button className='modal-close' title='Закрыть' onClick={onClose}>
            ✕
          </button>
        </div>
        <div className='modal-body qr-modal-body'>
          <img className='qr-modal-img' src={url} alt={`QR игры ${game.title}`} />
          <p className='qr-modal-code'>
            игра #{game.id} · {game.title}
          </p>
          <p className='minigames-empty'>
            Код содержит подписанный идентификатор игры (<code>dispatch:{game.id}:&lt;подпись&gt;</code>
            ). Подпись считается сервером по QR_SECRET и в API не отдаётся.
          </p>
        </div>
        <div className='modal-actions'>
          <div className='modal-actions-spacer' />
          <button className='modal-save-primary' onClick={print}>
            Печать
          </button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function GamesSection() {
  const [games, setGames] = useState<Game[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [dialogues, setDialogues] = useState<DialogueRef[]>([]);
  const [minigames, setMinigames] = useState<Minigame[]>([]);
  const [draft, setDraft] = useState<Game | null>(null);
  const [styleRows, setStyleRows] = useState<{ tag: string; id: number }[]>([]);
  const [qrGame, setQrGame] = useState<Game | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [testRun, setTestRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getGames(), api.getCharacters(), api.getDialogues(), api.getMinigames()])
      .then(([g, c, d, m]) => {
        setGames(g);
        setCharacters(c);
        setDialogues(d);
        setMinigames(m);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }, []);

  function edit(game: Game) {
    setDraft(game);
    setStyleRows(Object.entries(game.styleDialogues).map(([tag, id]) => ({ tag, id })));
    setError(null);
  }

  function patch(p: Partial<Game>) {
    setDraft((cur) => (cur ? { ...cur, ...p } : cur));
  }

  const minigame = minigames.find((m) => m.id === draft?.minigameId);

  async function save() {
    if (!draft) return;
    const styleDialogues: Record<string, number> = {};
    for (const row of styleRows) {
      if (row.tag.trim() !== '') styleDialogues[row.tag.trim()] = row.id;
    }
    const body = toInput({ ...draft, styleDialogues });
    setSaving(true);
    setError(null);
    try {
      const saved =
        draft.id === NEW_ID ? await api.createGame(body) : await api.updateGame(draft.id, body);
      setGames(await api.getGames());
      edit(saved);
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
    if (!window.confirm(`Удалить игру «${draft.title}»?`)) return;
    try {
      await api.deleteGame(draft.id);
      setGames(await api.getGames());
      setDraft(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  return (
    <div className='lb-section'>
      <div className='poi-panel-header'>
        <h3 className='lb-block-title'>Игры</h3>
        <button
          onClick={() => edit(blankGame(minigames[0]?.id ?? '', games.length))}
          disabled={minigames.length === 0}
        >
          + Новая игра
        </button>
      </div>
      {error && <p className='sf-asset-error'>{error}</p>}
      {minigames.length === 0 && (
        <p className='minigames-empty'>
          Нет собранных мини-игр — сначала соберите бандлы (server/static/minigames).
        </p>
      )}

      <div className='two-pane'>
        <div className='two-pane-list'>
          {games.map((g) => (
            <button
              key={g.id}
              className={`minigames-row${draft?.id === g.id ? ' minigames-row--active' : ''}`}
              onClick={() => edit(g)}
            >
              <span className='minigames-row-name'>
                {g.isTutorial ? '⌂ ' : ''}
                {g.title}
              </span>
              <span className='minigames-row-game'>{g.minigameId}</span>
            </button>
          ))}
          {games.length === 0 && <p className='minigames-empty'>Игр пока нет.</p>}
        </div>

        {draft && (
          <div className='two-pane-panel poi-edit-panel'>
            <div className='poi-panel-header'>
              <strong>{draft.id === NEW_ID ? 'Новая игра' : `Игра #${draft.id}`}</strong>
              <button className='poi-close-btn' onClick={() => setDraft(null)}>
                ✕
              </button>
            </div>

            <label className='poi-field-label'>Название</label>
            <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />

            <label className='poi-field-label'>Мини-игра</label>
            <select
              className='poi-select'
              value={draft.minigameId}
              onChange={(e) => patch({ minigameId: e.target.value })}
            >
              {minigames.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.id})
                </option>
              ))}
              {!minigames.some((m) => m.id === draft.minigameId) && (
                <option value={draft.minigameId}>{draft.minigameId} (не найдена)</option>
              )}
            </select>

            <div className='two-col'>
              <label className='poi-check-label'>
                <input
                  type='checkbox'
                  checked={draft.isTutorial}
                  onChange={(e) => patch({ isTutorial: e.target.checked })}
                />
                Обучалка
              </label>
              <label className='poi-field-label'>
                Порядок
                <input
                  type='number'
                  value={draft.sortOrder}
                  onChange={(e) => patch({ sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>

            <label className='poi-field-label'>Персонаж</label>
            <select
              className='poi-select'
              value={draft.characterId ?? ''}
              onChange={(e) =>
                patch({ characterId: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value=''>— нет —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <DialogueSelect
              label='Диалог до игры'
              dialogues={dialogues}
              value={draft.preDialogueId}
              onChange={(v) => patch({ preDialogueId: v })}
            />
            <DialogueSelect
              label='Диалог после победы'
              dialogues={dialogues}
              value={draft.postWinDialogueId}
              onChange={(v) => patch({ postWinDialogueId: v })}
            />
            <DialogueSelect
              label='Диалог после поражения'
              dialogues={dialogues}
              value={draft.postLoseDialogueId}
              onChange={(v) => patch({ postLoseDialogueId: v })}
            />

            <label className='poi-field-label'>
              Диалоги по стилю прохождения (details.styleTag → диалог)
            </label>
            <div className='style-rows'>
              {styleRows.map((row, i) => (
                <div className='style-row' key={i}>
                  <input
                    placeholder='styleTag (напр. ghost)'
                    value={row.tag}
                    onChange={(e) =>
                      setStyleRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, tag: e.target.value } : r)),
                      )
                    }
                  />
                  <select
                    className='poi-select'
                    value={row.id}
                    onChange={(e) =>
                      setStyleRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, id: Number(e.target.value) } : r)),
                      )
                    }
                  >
                    {dialogues.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} (#{d.id})
                      </option>
                    ))}
                  </select>
                  <button onClick={() => setStyleRows((rows) => rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <button
                disabled={dialogues.length === 0}
                onClick={() =>
                  setStyleRows((rows) => [...rows, { tag: '', id: dialogues[0]?.id ?? 0 }])
                }
              >
                + строка
              </button>
            </div>

            <label className='poi-field-label'>Открывается после прохождения</label>
            <div className='poi-blockers'>
              {games
                .filter((g) => g.id !== draft.id)
                .map((g) => (
                  <label className='poi-blocker-row' key={g.id}>
                    <input
                      type='checkbox'
                      checked={draft.requiredGameIds.includes(g.id)}
                      onChange={(e) =>
                        patch({
                          requiredGameIds: e.target.checked
                            ? [...draft.requiredGameIds, g.id]
                            : draft.requiredGameIds.filter((id) => id !== g.id),
                        })
                      }
                    />
                    {g.title}
                  </label>
                ))}
              {games.filter((g) => g.id !== draft.id).length === 0 && (
                <span className='minigames-empty'>Других игр нет.</span>
              )}
            </div>

            <div className='poi-panel-actions'>
              <button
                disabled={draft.id === NEW_ID || !minigame}
                title={draft.id === NEW_ID ? 'Сначала сохраните игру' : ''}
                onClick={() => setConfigOpen(true)}
              >
                Конфиг мини-игры…
              </button>
              {minigame?.entryUrl != null && (
                <button
                  title='Изолированный запуск мини-игры с настройками этой игры, без диалогов'
                  onClick={() => setTestRun(true)}
                >
                  ▶ Тест
                </button>
              )}
              <button
                disabled={draft.id === NEW_ID && !draft.isTutorial}
                title='Полный прогон в плеере: диалоги, мини-игра, мета — без QR и без записи прогресса'
                onClick={() =>
                  window.open(
                    playerTestUrl(
                      draft.isTutorial || draft.minigameId === 'onboarding'
                        ? 'onboarding'
                        : `game:${draft.id}`,
                    ),
                    '_blank',
                  )
                }
              >
                ▶ Тест в плеере
              </button>
              <button disabled={draft.id === NEW_ID} onClick={() => setQrGame(draft)}>
                QR-код
              </button>
              <button className='modal-save-primary' disabled={saving || !draft.title} onClick={() => void save()}>
                {draft.id === NEW_ID ? 'Создать' : 'Сохранить'}
              </button>
              {draft.id !== NEW_ID && (
                <button className='poi-delete-btn' onClick={() => void remove()}>
                  Удалить игру
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {qrGame && <QrModal game={qrGame} onClose={() => setQrGame(null)} />}

      {/* Same effective config the player loader builds: defaults ⊕ override. */}
      {testRun && draft && minigame?.entryUrl != null && (
        <TestRunOverlay
          entryUrl={minigame.entryUrl}
          config={mergeTop((minigame.defaultConfig ?? {}) as Cfg, (draft.config ?? {}) as Cfg)}
          onClose={() => setTestRun(false)}
        />
      )}

      {configOpen && draft && minigame && (
        <MinigameConfigModal
          minigame={minigame}
          title={`${draft.title} — конфиг (${minigame.title})`}
          // Effective config the player sees = minigame defaults ⊕ this game's override.
          initialConfig={mergeTop(
            (minigame.defaultConfig ?? {}) as Cfg,
            (draft.config ?? {}) as Cfg,
          )}
          onClose={() => setConfigOpen(false)}
          onSave={async (config) => {
            const override = diffTop((minigame.defaultConfig ?? {}) as Cfg, config);
            const saved = await api.updateGame(draft.id, { config: override });
            setGames((prev) => prev.map((g) => (g.id === saved.id ? saved : g)));
            setDraft((cur) => (cur && cur.id === saved.id ? saved : cur));
          }}
        />
      )}
    </div>
  );
}
