import { useEffect, useRef, useState } from 'react';
import { api, type DialogueDoc, type DialogueNode } from '../api';
import { showToast } from '../toast';

// TODO: полноценный редактор узлов (список узлов + форма спикер/сторона/текст/переходы/варианты,
// см. docs/dialogue-system.md §3) — отдельная задача. Пока — JSON + импорт/экспорт/валидация.

// ---------------------------------------------------------------------------
// Validation — docs/dialogue-system.md §4
// ---------------------------------------------------------------------------

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  doc: DialogueDoc | null;
}

export function validateDialogue(text: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: [`Некорректный JSON: ${(e as Error).message}`], warnings, doc: null };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { errors: ['Ожидается объект { start, nodes }'], warnings, doc: null };
  }

  const { start, nodes } = raw as { start?: unknown; nodes?: unknown };
  if (typeof start !== 'string' || start === '') errors.push('Поле «start» должно быть строкой');
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) {
    errors.push('Поле «nodes» должно быть объектом');
    return { errors, warnings, doc: null };
  }

  const map = nodes as Record<string, DialogueNode>;
  const ids = Object.keys(map);
  if (ids.length === 0) errors.push('Диалог не содержит ни одного узла');
  if (typeof start === 'string' && !(start in map)) {
    errors.push(`Стартовый узел «${start}» отсутствует в nodes`);
  }

  for (const [id, node] of Object.entries(map)) {
    if (typeof node !== 'object' || node === null) {
      errors.push(`Узел «${id}»: ожидается объект`);
      continue;
    }
    if (typeof node.speaker !== 'string' || node.speaker === '') {
      errors.push(`Узел «${id}»: нужен speaker («oleg» или id персонажа)`);
    }
    if (node.side !== 'left' && node.side !== 'right') {
      errors.push(`Узел «${id}»: side должен быть "left" или "right"`);
    }
    if (typeof node.text !== 'string') errors.push(`Узел «${id}»: нужен текст реплики`);

    const choices = node.choices ?? null;
    if (choices !== null && !Array.isArray(choices)) {
      errors.push(`Узел «${id}»: choices должен быть массивом или null`);
    } else if (Array.isArray(choices)) {
      choices.forEach((choice, i) => {
        if (typeof choice?.text !== 'string') {
          errors.push(`Узел «${id}», вариант ${i + 1}: нужен текст`);
        }
        if (typeof choice?.next !== 'string' || !(choice.next in map)) {
          errors.push(`Узел «${id}», вариант ${i + 1}: переход на несуществующий узел`);
        }
      });
      if (choices.length > 0 && node.next != null) {
        warnings.push(`Узел «${id}»: заданы и next, и choices — next игнорируется рендерером`);
      }
    }

    const hasChoices = Array.isArray(choices) && choices.length > 0;
    if (!hasChoices && node.next != null && !(node.next in map)) {
      errors.push(`Узел «${id}»: next указывает на несуществующий узел «${node.next}»`);
    }
  }

  // Reachability from start — unreachable nodes are a warning, not an error.
  if (typeof start === 'string' && start in map) {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const node = map[queue.shift()!];
      if (!node) continue;
      const targets = [
        ...(Array.isArray(node.choices) ? node.choices.map((c) => c?.next) : []),
        node.next,
      ];
      for (const target of targets) {
        if (typeof target === 'string' && target in map && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    const orphans = ids.filter((id) => !seen.has(id));
    if (orphans.length > 0) warnings.push(`Недостижимые узлы: ${orphans.join(', ')}`);
  }

  return {
    errors,
    warnings,
    doc: errors.length === 0 ? ({ start, nodes: map } as DialogueDoc) : null,
  };
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const EMPTY_DOC = JSON.stringify(
  {
    start: 'n1',
    nodes: {
      n1: { speaker: 'oleg', side: 'left', text: 'Диспетчерская, слушаю.', next: null },
    },
  },
  null,
  2,
);

export function DialoguesSection() {
  const [list, setList] = useState<{ id: number; title: string }[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getDialogues()
      .then(setList)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }, []);

  async function open(id: number) {
    setError(null);
    setResult(null);
    try {
      const dialogue = await api.getDialogue(id);
      setCurrentId(dialogue.id);
      setTitle(dialogue.title);
      setText(JSON.stringify(dialogue.nodes ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  async function create() {
    const name = window.prompt('Название диалога');
    if (!name) return;
    try {
      const created = await api.createDialogue(name, JSON.parse(EMPTY_DOC));
      setList(await api.getDialogues());
      setCurrentId(created.id);
      setTitle(created.title);
      setText(JSON.stringify(created.nodes ?? {}, null, 2));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка создания', 'error');
    }
  }

  async function save() {
    if (currentId === null) return;
    const validated = validateDialogue(text);
    setResult(validated);
    if (validated.errors.length > 0 || !validated.doc) {
      showToast('Есть ошибки — не сохранено', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.updateDialogue(currentId, { title, nodes: validated.doc });
      setList(await api.getDialogues());
      showToast('Сохранено');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (currentId === null) return;
    if (!window.confirm(`Удалить диалог «${title}»?`)) return;
    try {
      await api.deleteDialogue(currentId);
      setList(await api.getDialogues());
      setCurrentId(null);
      setText('');
      setTitle('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  function exportJson() {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'dialogue'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    const raw = await file.text();
    const validated = validateDialogue(raw);
    setResult(validated);
    if (validated.errors.length > 0) {
      showToast('Импорт отклонён: файл не проходит валидацию', 'error');
      return;
    }
    // Import replaces the whole document (never merges) — docs/dialogue-system.md §3.1
    setText(JSON.stringify(JSON.parse(raw), null, 2));
    showToast('Импортировано — не забудьте сохранить');
  }

  return (
    <div className='lb-section'>
      <div className='poi-panel-header'>
        <h3 className='lb-block-title'>Диалоги</h3>
        <button onClick={() => void create()}>+ Новый диалог</button>
      </div>
      {error && <p className='sf-asset-error'>{error}</p>}

      <div className='two-pane'>
        <div className='two-pane-list'>
          {list.map((d) => (
            <button
              key={d.id}
              className={`minigames-row${currentId === d.id ? ' minigames-row--active' : ''}`}
              onClick={() => void open(d.id)}
            >
              <span className='minigames-row-name'>{d.title}</span>
              <span className='minigames-row-game'>#{d.id}</span>
            </button>
          ))}
          {list.length === 0 && <p className='minigames-empty'>Диалогов пока нет.</p>}
        </div>

        {currentId !== null && (
          <div className='two-pane-panel poi-edit-panel'>
            <label className='poi-field-label'>Название</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />

            <label className='poi-field-label'>Узлы (JSON)</label>
            <textarea
              className='dlg-textarea'
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            {result && (
              <div className='dlg-report'>
                {result.errors.map((m) => (
                  <p className='dlg-error' key={m}>
                    ✕ {m}
                  </p>
                ))}
                {result.warnings.map((m) => (
                  <p className='dlg-warn' key={m}>
                    ⚠ {m}
                  </p>
                ))}
                {result.errors.length === 0 && result.warnings.length === 0 && (
                  <p className='dlg-ok'>✓ Диалог корректен</p>
                )}
              </div>
            )}

            <div className='poi-panel-actions'>
              <button onClick={() => setResult(validateDialogue(text))}>Проверить</button>
              <button onClick={() => fileRef.current?.click()}>Импорт JSON</button>
              <input
                ref={fileRef}
                type='file'
                accept='application/json,.json'
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importJson(file);
                  e.target.value = '';
                }}
              />
              <button onClick={exportJson}>Экспорт</button>
              <button className='modal-save-primary' disabled={saving} onClick={() => void save()}>
                Сохранить
              </button>
              <button className='poi-delete-btn' onClick={() => void remove()}>
                Удалить диалог
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
