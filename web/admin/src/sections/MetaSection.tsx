import { useEffect, useRef, useState } from 'react';
import {
  api,
  type Character,
  type Game,
  type MetaStage,
  type MetaStageBackground,
  type MetaStageCharacter,
  type MetaStageTrigger,
} from '../api';
import { AssetPickerModal } from '../schema-form/AssetPickerModal';
import { BG_SIZE } from '../schema-form/BgPreviewBox';
import { showToast } from '../toast';

const NEW_ID = 0;

type StageFit = NonNullable<MetaStageBackground['fit']>;

const FIT_LABELS: { value: StageFit; label: string }[] = [
  { value: 'cover', label: 'Заполнить' },
  { value: 'contain', label: 'Вписать' },
  { value: 'fill-x', label: 'По ширине' },
  { value: 'fill-y', label: 'По высоте' },
  { value: 'center', label: 'По центру' },
  { value: 'tile', label: 'Плитка' },
];

function blankStage(sortOrder: number): MetaStage {
  return {
    id: NEW_ID,
    title: '',
    sortOrder,
    background: { fit: 'cover', scale: 1, offset: { x: 0, y: 0 } },
    characters: [],
    trigger: { type: 'wonCount', value: 0 },
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function triggerSummary(t: MetaStageTrigger, games: Game[]): string {
  if (t.type === 'wonCount') return `от ${t.value} побед`;
  if (t.ids.length === 0) return 'после: —';
  const titles = t.ids.map((id) => games.find((g) => g.id === id)?.title ?? `#${id}`);
  return `после: ${titles.join(', ')}`;
}

// ---------------------------------------------------------------------------
// StageCanvas — 16:7 сцена: фон (как в BgPreviewBox) + перетаскиваемые спрайты
// ---------------------------------------------------------------------------

interface StageCanvasProps {
  stage: MetaStage;
  roster: Character[];
  onCharacterMove: (index: number, x: number, y: number) => void;
  onCharacterReset: (index: number) => void;
  onOffsetChange: (o: { x: number; y: number }) => void;
}

function StageCanvas({
  stage,
  roster,
  onCharacterMove,
  onCharacterReset,
  onOffsetChange,
}: StageCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [grabbing, setGrabbing] = useState(false);
  // размер бокса нужен для перевода % смещения фона в px (как в BgPreviewBox)
  const [size, setSize] = useState({ w: 600, h: 263 });
  // spriteIndex === null → тащим фон
  const drag = useRef<{
    clientX: number;
    clientY: number;
    ox: number;
    oy: number;
    spriteIndex: number | null;
    w: number;
    h: number;
  } | null>(null);

  const bg = stage.background;
  const fit = bg.fit ?? 'cover';
  const scale = bg.scale ?? 1;
  const offset = { x: bg.offset?.x ?? 0, y: bg.offset?.y ?? 0 };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const sync = () => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = (offset.x / 100) * size.w;
  const py = (offset.y / 100) * size.h;
  const bgPos =
    fit === 'fill-x'
      ? `center calc(50% + ${py}px)`
      : fit === 'fill-y'
        ? `calc(50% + ${px}px) center`
        : fit === 'tile'
          ? `${px}px ${py}px`
          : `calc(50% + ${px}px) calc(50% + ${py}px)`;

  // Size math mirrors bgStyle() in web/player/src/screens/metaStage.ts — the
  // canvas must show exactly what the player will render.
  const bgSize =
    scale === 1
      ? (BG_SIZE[fit] ?? 'cover')
      : fit === 'contain' || fit === 'fill-y'
        ? `auto ${100 * scale}%`
        : `${100 * scale}% auto`;

  function startDrag(e: React.PointerEvent, spriteIndex: number | null) {
    const el = boxRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGrabbing(true);
    const base =
      spriteIndex === null
        ? offset
        : { x: stage.characters[spriteIndex]?.x ?? 50, y: stage.characters[spriteIndex]?.y ?? 85 };
    drag.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      ox: base.x,
      oy: base.y,
      spriteIndex,
      w: el.clientWidth || 1,
      h: el.clientHeight || 1,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const nx = d.ox + ((e.clientX - d.clientX) / d.w) * 100;
    const ny = d.oy + ((e.clientY - d.clientY) / d.h) * 100;
    if (d.spriteIndex === null) onOffsetChange({ x: nx, y: ny });
    else onCharacterMove(d.spriteIndex, clamp(nx, 0, 100), clamp(ny, 0, 100));
  }

  function endDrag() {
    setGrabbing(false);
    drag.current = null;
  }

  return (
    <div
      ref={boxRef}
      className={`meta-ed-canvas${grabbing ? ' meta-ed-canvas--grabbing' : ''}`}
      title='Перетащите фон или персонажа. Двойной клик — сброс.'
      onPointerDown={(e) => startDrag(e, null)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onOffsetChange({ x: 0, y: 0 })}
    >
      {bg.image && (
        <div
          className='meta-ed-canvas-bg'
          style={{
            backgroundImage: `url(${bg.image})`,
            backgroundSize: bgSize,
            backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
            backgroundPosition: bgPos,
          }}
        />
      )}

      {stage.characters.map((sc, i) => {
        const ch = roster.find((c) => c.id === sc.characterId);
        const name = ch?.name ?? `#${sc.characterId}`;
        return (
          <div
            key={`${sc.characterId}-${i}`}
            className='meta-ed-sprite'
            style={{
              left: `${sc.x}%`,
              top: `${sc.y}%`,
              transform: `translate(-50%, -50%) scale(${sc.scale ?? 1})`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              startDrag(e, i);
            }}
            onPointerMove={(e) => {
              e.stopPropagation();
              moveDrag(e);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              endDrag();
            }}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onCharacterReset(i);
            }}
          >
            {ch?.portraitAsset ? (
              <img className='meta-ed-sprite-img' src={ch.portraitAsset} alt='' draggable={false} />
            ) : (
              <span className='meta-ed-sprite-ph'>{name.charAt(0).toUpperCase() || '?'}</span>
            )}
            <span className='meta-ed-sprite-name'>{name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaSection
// ---------------------------------------------------------------------------

export function MetaSection() {
  const [stages, setStages] = useState<MetaStage[]>([]);
  const [roster, setRoster] = useState<Character[]>([]);
  const [dialogues, setDialogues] = useState<{ id: number; title: string }[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [draft, setDraft] = useState<MetaStage | null>(null);
  const [picking, setPicking] = useState(false);
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Каждый источник грузим независимо: падение одного не должно гасить секцию.
    api
      .getMetaStages()
      .then(setStages)
      .catch((e: unknown) => {
        setStages([]);
        const msg = e instanceof Error ? e.message : 'Ошибка загрузки этапов';
        setError(msg);
        showToast(msg, 'error');
      });
    Promise.all([api.getCharacters(), api.getDialogues(), api.getGames()])
      .then(([c, d, g]) => {
        setRoster(c);
        setDialogues(d);
        setGames(g);
      })
      .catch((e: unknown) =>
        showToast(e instanceof Error ? e.message : 'Ошибка загрузки справочников', 'error'),
      );
  }, []);

  function patch(p: Partial<MetaStage>) {
    setDraft((cur) => (cur ? { ...cur, ...p } : cur));
  }

  function patchBg(p: Partial<MetaStage['background']>) {
    setDraft((cur) => (cur ? { ...cur, background: { ...cur.background, ...p } } : cur));
  }

  /** exactOptionalPropertyTypes: image нельзя выставить в undefined — ключ удаляем. */
  function clearBg() {
    setDraft((cur) => {
      if (!cur) return cur;
      const rest: MetaStageBackground = { ...cur.background };
      delete rest.image;
      return { ...cur, background: rest };
    });
  }

  function patchChar(index: number, p: Partial<MetaStageCharacter>) {
    setDraft((cur) =>
      cur
        ? {
            ...cur,
            characters: cur.characters.map((c, i) => (i === index ? { ...c, ...p } : c)),
          }
        : cur,
    );
  }

  const sorted = [...stages].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const nonTutorialGames = games.filter((g) => !g.isTutorial);

  async function reload() {
    try {
      setStages(await api.getMetaStages());
    } catch {
      /* список обновится при следующей загрузке секции */
    }
  }

  async function save() {
    if (!draft) return;
    const { id, ...body } = draft;
    setSaving(true);
    setError(null);
    try {
      const saved =
        id === NEW_ID ? await api.createMetaStage(body) : await api.updateMetaStage(id, body);
      await reload();
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
    if (!window.confirm(`Удалить этап «${draft.title || draft.id}»?`)) return;
    try {
      await api.deleteMetaStage(draft.id);
      await reload();
      setDraft(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  const available = draft
    ? roster.filter((c) => !draft.characters.some((sc) => sc.characterId === c.id))
    : [];

  return (
    <div className='lb-section'>
      <div className='poi-panel-header'>
        <h3 className='lb-block-title'>Мета</h3>
        <button
          onClick={() => {
            setDraft(blankStage(sorted.length));
            setAddId('');
          }}
        >
          + Новый этап
        </button>
      </div>
      {error && <p className='sf-asset-error'>{error}</p>}

      <div className='two-pane'>
        <div className='two-pane-list'>
          {sorted.map((s, i) => (
            <button
              key={s.id}
              className={`minigames-row${draft?.id === s.id ? ' minigames-row--active' : ''}`}
              onClick={() => {
                setDraft(s);
                setAddId('');
              }}
            >
              <span className='minigames-row-name'>{s.title || `Этап ${i + 1}`}</span>
              <span className='minigames-row-game'>{triggerSummary(s.trigger, games)}</span>
            </button>
          ))}
          {sorted.length === 0 && <p className='minigames-empty'>Этапов пока нет.</p>}
        </div>

        {draft && (
          <div className='two-pane-panel poi-edit-panel meta-ed-panel'>
            <div className='poi-panel-header'>
              <strong>{draft.id === NEW_ID ? 'Новый этап' : `Этап #${draft.id}`}</strong>
              <button className='poi-close-btn' onClick={() => setDraft(null)}>
                ✕
              </button>
            </div>

            <label className='poi-field-label'>Название</label>
            <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />

            <label className='poi-field-label'>Порядок</label>
            <input
              type='number'
              value={draft.sortOrder}
              onChange={(e) => patch({ sortOrder: Number(e.target.value) || 0 })}
            />

            <label className='poi-field-label'>Условие появления</label>
            <select
              className='poi-select'
              value={draft.trigger.type}
              onChange={(e) =>
                patch({
                  trigger:
                    e.target.value === 'wonCount'
                      ? { type: 'wonCount', value: 0 }
                      : { type: 'games', ids: [] },
                })
              }
            >
              <option value='wonCount'>Побед не меньше…</option>
              <option value='games'>Выиграны игры…</option>
            </select>

            {draft.trigger.type === 'wonCount' ? (
              <input
                type='number'
                min={0}
                value={draft.trigger.value}
                onChange={(e) =>
                  patch({ trigger: { type: 'wonCount', value: Number(e.target.value) || 0 } })
                }
              />
            ) : (
              <div className='poi-blockers'>
                {nonTutorialGames.map((g) => {
                  const ids = draft.trigger.type === 'games' ? draft.trigger.ids : [];
                  return (
                    <label className='poi-blocker-row' key={g.id}>
                      <input
                        type='checkbox'
                        checked={ids.includes(g.id)}
                        onChange={(e) =>
                          patch({
                            trigger: {
                              type: 'games',
                              ids: e.target.checked
                                ? [...ids, g.id]
                                : ids.filter((id) => id !== g.id),
                            },
                          })
                        }
                      />
                      {g.title}
                    </label>
                  );
                })}
                {nonTutorialGames.length === 0 && (
                  <span className='minigames-empty'>Игр нет.</span>
                )}
              </div>
            )}

            <label className='poi-field-label'>Фон</label>
            <div className='char-portrait-row'>
              {draft.background.image ? (
                <img className='char-portrait' src={draft.background.image} alt='' />
              ) : (
                <span className='minigames-empty'>не выбран</span>
              )}
              <button onClick={() => setPicking(true)}>Выбрать…</button>
              {draft.background.image && (
                <button onClick={clearBg}>Убрать фон</button>
              )}
            </div>

            <div className='meta-ed-bg-opts'>
              <label className='poi-field-label'>
                Вписывание
                <select
                  className='poi-select'
                  value={draft.background.fit ?? 'cover'}
                  onChange={(e) => patchBg({ fit: e.target.value as StageFit })}
                >
                  {FIT_LABELS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='poi-field-label'>
                Масштаб
                <input
                  type='number'
                  step={0.1}
                  min={0.1}
                  value={draft.background.scale ?? 1}
                  onChange={(e) => patchBg({ scale: Number(e.target.value) || 1 })}
                />
              </label>
            </div>

            <label className='poi-field-label'>Сцена</label>
            <StageCanvas
              stage={draft}
              roster={roster}
              onCharacterMove={(i, x, y) => patchChar(i, { x, y })}
              onCharacterReset={(i) => patchChar(i, { x: 50, y: 85 })}
              onOffsetChange={(o) => patchBg({ offset: o })}
            />

            <label className='poi-field-label'>Персонажи на сцене</label>
            <div className='meta-ed-chars'>
              {draft.characters.map((sc, i) => {
                const ch = roster.find((c) => c.id === sc.characterId);
                return (
                  <div className='meta-ed-char-row' key={`${sc.characterId}-${i}`}>
                    <span className='meta-ed-char-name'>{ch?.name ?? `#${sc.characterId}`}</span>
                    <input
                      type='number'
                      min={0}
                      max={100}
                      step={1}
                      title='X, %'
                      value={Math.round(sc.x)}
                      onChange={(e) => patchChar(i, { x: clamp(Number(e.target.value) || 0, 0, 100) })}
                    />
                    <input
                      type='number'
                      min={0}
                      max={100}
                      step={1}
                      title='Y, %'
                      value={Math.round(sc.y)}
                      onChange={(e) => patchChar(i, { y: clamp(Number(e.target.value) || 0, 0, 100) })}
                    />
                    <input
                      type='number'
                      min={0.5}
                      max={2}
                      step={0.1}
                      title='Масштаб'
                      value={sc.scale ?? 1}
                      onChange={(e) =>
                        patchChar(i, { scale: clamp(Number(e.target.value) || 1, 0.5, 2) })
                      }
                    />
                    <select
                      className='poi-select'
                      value={sc.dialogueId == null ? '' : sc.dialogueId}
                      onChange={(e) =>
                        patchChar(i, {
                          dialogueId: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    >
                      <option value=''>— как у персонажа —</option>
                      {dialogues.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title} (#{d.id})
                        </option>
                      ))}
                    </select>
                    <button
                      className='poi-close-btn'
                      onClick={() =>
                        patch({ characters: draft.characters.filter((_, j) => j !== i) })
                      }
                    >
                      Убрать
                    </button>
                  </div>
                );
              })}
              {draft.characters.length === 0 && (
                <span className='minigames-empty'>Персонажей на сцене нет.</span>
              )}
            </div>

            <div className='meta-ed-char-add'>
              <select
                className='poi-select'
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              >
                <option value=''>— выберите персонажа —</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                disabled={addId === ''}
                onClick={() => {
                  patch({
                    characters: [
                      ...draft.characters,
                      { characterId: Number(addId), x: 50, y: 80, scale: 1 },
                    ],
                  });
                  setAddId('');
                }}
              >
                + Добавить персонажа
              </button>
            </div>

            <div className='poi-panel-actions'>
              <button
                className='modal-save-primary'
                disabled={saving}
                onClick={() => void save()}
              >
                {draft.id === NEW_ID ? 'Создать' : 'Сохранить'}
              </button>
              {draft.id !== NEW_ID && (
                <button className='poi-delete-btn' onClick={() => void remove()}>
                  Удалить этап
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
            patchBg({ image: url });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
