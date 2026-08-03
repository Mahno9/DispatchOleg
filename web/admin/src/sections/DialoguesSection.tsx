import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type Character,
  type DialogueChoice,
  type DialogueDoc,
  type DialogueNode,
} from '../api';
import { showToast } from '../toast';
import { Segmented } from '../ui/Segmented';
import { DialogueGraph, autoLayout } from './DialogueGraph';

// ---------------------------------------------------------------------------
// Graph helpers — docs/dialogue-system.md §1, §4
// ---------------------------------------------------------------------------

/** BFS from `start` over next/choices[].next. */
function reachableIds(nodes: Record<string, DialogueNode>, start: string): Set<string> {
  const seen = new Set<string>();
  if (!(start in nodes)) return seen;
  seen.add(start);
  const queue = [start];
  while (queue.length > 0) {
    const node = nodes[queue.shift()!];
    if (!node) continue;
    const targets = [
      ...(Array.isArray(node.choices) ? node.choices.map((c) => c?.next) : []),
      node.next,
    ];
    for (const target of targets) {
      if (typeof target === 'string' && target in nodes && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** Repoint every reference to `from`; `to === null` drops the link (next → null, choice removed). */
function relink(node: DialogueNode, from: string, to: string | null): DialogueNode {
  const choices = Array.isArray(node.choices)
    ? node.choices.flatMap((c) =>
        c?.next === from ? (to === null ? [] : [{ ...c, next: to }]) : [c],
      )
    : node.choices;
  return { ...node, next: node.next === from ? to : (node.next ?? null), choices: choices ?? null };
}

function renameNode(doc: DialogueDoc, from: string, to: string): DialogueDoc {
  const nodes: Record<string, DialogueNode> = {};
  // Object.entries keeps insertion order → the node stays in place in the list.
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[id === from ? to : id] = relink(node, from, to);
  }
  return { start: doc.start === from ? to : doc.start, nodes };
}

function freeId(nodes: Record<string, DialogueNode>, base = 'n'): string {
  let i = 1;
  while (`${base}${i}` in nodes) i++;
  return `${base}${i}`;
}

function referrers(nodes: Record<string, DialogueNode>, id: string): string[] {
  return Object.entries(nodes)
    .filter(
      ([other, node]) =>
        other !== id &&
        (node.next === id ||
          (Array.isArray(node.choices) && node.choices.some((c) => c?.next === id))),
    )
    .map(([other]) => other);
}

/** Lenient parse for the editor tab: only structure matters, content is validated separately. */
function parseDoc(text: string): DialogueDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { start, nodes } = raw as { start?: unknown; nodes?: unknown };
  if (nodes !== undefined && (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes))) {
    return null;
  }
  return {
    start: typeof start === 'string' ? start : '',
    nodes: (nodes ?? {}) as Record<string, DialogueNode>,
  };
}

const serialize = (doc: DialogueDoc) => JSON.stringify(doc, null, 2);

const BLANK_NODE: DialogueNode = { speaker: 'oleg', side: 'left', text: '', next: null };

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
    const seen = reachableIds(map, start);
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
// Node form
// ---------------------------------------------------------------------------

interface NodeFormProps {
  id: string;
  node: DialogueNode;
  ids: string[];
  characters: Character[];
  onPatch: (patch: Partial<DialogueNode>) => void;
  /** Возвращает false, если переименование отклонено (тогда поле откатывается). */
  onRename: (nextId: string) => boolean;
  onCreateNext: () => void;
}

function NodeForm({ id, node, ids, characters, onPatch, onRename, onCreateNext }: NodeFormProps) {
  const choices = Array.isArray(node.choices) ? node.choices : [];
  const knownSpeaker =
    node.speaker === 'oleg' || characters.some((c) => String(c.id) === node.speaker);

  function patchChoice(index: number, patch: Partial<DialogueChoice>) {
    onPatch({ choices: choices.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  return (
    <div className='dlg-node-form'>
      <label className='poi-field-label'>id узла</label>
      <input
        key={id}
        defaultValue={id}
        spellCheck={false}
        onBlur={(e) => {
          if (!onRename(e.target.value.trim())) e.target.value = id;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />

      <label className='poi-field-label'>Говорит</label>
      <select
        className='poi-select'
        value={node.speaker}
        onChange={(e) => onPatch({ speaker: e.target.value })}
      >
        <option value='oleg'>Олег</option>
        {characters.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.name}
          </option>
        ))}
        {!knownSpeaker && <option value={node.speaker}>{node.speaker} (нет такого персонажа)</option>}
      </select>

      <label className='poi-field-label'>Сторона</label>
      <Segmented
        name={`dlg-side-${id}`}
        options={[
          { value: 'left', label: 'Слева' },
          { value: 'right', label: 'Справа' },
        ]}
        value={node.side}
        onChange={(v) => onPatch({ side: v as DialogueNode['side'] })}
      />

      <label className='poi-field-label'>Реплика</label>
      <textarea
        className='dlg-node-text'
        value={node.text ?? ''}
        onChange={(e) => onPatch({ text: e.target.value })}
      />

      {/* next и choices взаимоисключающие — docs/dialogue-system.md §1.2 */}
      {choices.length === 0 ? (
        <>
          <label className='poi-field-label'>Переход</label>
          <div className='dlg-next-row'>
            <select
              className='poi-select'
              value={node.next ?? ''}
              onChange={(e) => onPatch({ next: e.target.value || null })}
            >
              <option value=''>— конец —</option>
              {ids.map((other) => (
                <option key={other} value={other}>
                  {other}
                </option>
              ))}
            </select>
            <button onClick={onCreateNext}>+ узел и связать</button>
          </div>
        </>
      ) : (
        node.next != null && (
          <p className='dlg-warn'>
            Заданы варианты — next «{node.next}» игнорируется рендерером.{' '}
            <button className='dlg-inline-btn' onClick={() => onPatch({ next: null })}>
              очистить
            </button>
          </p>
        )
      )}

      <label className='poi-field-label'>Варианты ответа</label>
      <div className='dlg-choices'>
        {choices.map((choice, i) => (
          <div className='dlg-choice-row' key={i}>
            <input
              value={choice?.text ?? ''}
              placeholder='Текст варианта'
              onChange={(e) => patchChoice(i, { text: e.target.value })}
            />
            <select
              className='poi-select'
              value={choice?.next ?? ''}
              onChange={(e) => patchChoice(i, { next: e.target.value })}
            >
              <option value=''>— не задан —</option>
              {ids.map((other) => (
                <option key={other} value={other}>
                  {other}
                </option>
              ))}
            </select>
            <button
              className='poi-delete-btn'
              title='Удалить вариант'
              onClick={() => onPatch({ choices: choices.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className='foe-list-add'
          onClick={() => onPatch({ choices: [...choices, { text: '', next: '' }] })}
        >
          + вариант
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const EMPTY_DOC = serialize({
  start: 'n1',
  nodes: { n1: { speaker: 'oleg', side: 'left', text: 'Диспетчерская, слушаю.', next: null } },
});

export function DialoguesSection() {
  const [list, setList] = useState<{ id: number; title: string }[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [tab, setTab] = useState<'editor' | 'json'>('editor');
  const [selected, setSelected] = useState<string | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const report = useMemo(() => validateDialogue(text), [text]);
  const doc = useMemo(() => parseDoc(text), [text]);
  const ids = doc ? Object.keys(doc.nodes) : [];
  const reachable = useMemo(
    () => (doc ? reachableIds(doc.nodes, doc.start) : new Set<string>()),
    [doc],
  );
  const currentNode = selected !== null ? (doc?.nodes[selected] ?? null) : null;
  const currentNodeId = currentNode ? selected : null;

  useEffect(() => {
    api
      .getDialogues()
      .then(setList)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
    api.getCharacters().then(setCharacters).catch(() => undefined);
  }, []);

  function speakerLabel(speaker: string): string {
    if (speaker === 'oleg') return 'Олег';
    return characters.find((c) => String(c.id) === speaker)?.name ?? speaker;
  }

  function load(nodes: unknown) {
    // Auto-layout on open/import so every node has stable x/y from then on.
    const parsed = parseDoc(JSON.stringify(nodes ?? {}));
    const raw = parsed ? serialize(autoLayout(parsed)) : JSON.stringify(nodes ?? {}, null, 2);
    setText(raw);
    setImportErrors([]);
    setTab('editor');
    setSelected(parsed?.start ?? null);
  }

  async function open(id: number) {
    setError(null);
    try {
      const dialogue = await api.getDialogue(id);
      setCurrentId(dialogue.id);
      setTitle(dialogue.title);
      load(dialogue.nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  async function create() {
    const name = newTitle.trim();
    if (!name) return;
    try {
      const created = await api.createDialogue(name, JSON.parse(EMPTY_DOC));
      setNewTitle('');
      setList(await api.getDialogues());
      setCurrentId(created.id);
      setTitle(created.title);
      load(created.nodes);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка создания', 'error');
    }
  }

  // --- editor operations (doc is the parsed view of `text`; text stays the source of truth) ---

  function updateDoc(fn: (d: DialogueDoc) => DialogueDoc) {
    if (!doc) return;
    setText(serialize(fn(doc)));
    setImportErrors([]);
  }

  function addNode(x = 50, y = 50) {
    if (!doc) return;
    const id = freeId(doc.nodes);
    updateDoc((d) => ({
      start: d.start in d.nodes ? d.start : id,
      nodes: { ...d.nodes, [id]: { ...BLANK_NODE, x, y } },
    }));
    setSelected(id);
  }

  function duplicateNode() {
    if (!doc || !currentNodeId) return;
    const id = freeId(doc.nodes);
    const source = doc.nodes[currentNodeId];
    if (!source) return;
    updateDoc((d) => ({
      ...d,
      nodes: {
        ...d.nodes,
        [id]: {
          ...source,
          x: Math.min((source.x ?? 50) + 6, 98),
          y: Math.min((source.y ?? 50) + 6, 97),
          choices: Array.isArray(source.choices) ? source.choices.map((c) => ({ ...c })) : null,
        },
      },
    }));
    setSelected(id);
  }

  /** Port drag: plain `next`, or an extra choice when the node already branches. */
  function connect(from: string, to: string) {
    updateDoc((d) => {
      const node = d.nodes[from];
      if (!node) return d;
      const choices = Array.isArray(node.choices) ? node.choices : [];
      const patched: DialogueNode =
        choices.length > 0
          ? { ...node, choices: [...choices, { text: '', next: to }] }
          : { ...node, next: to };
      return { ...d, nodes: { ...d.nodes, [from]: patched } };
    });
    setSelected(from);
  }

  function moveNode(id: string, x: number, y: number) {
    updateDoc((d) => {
      const node = d.nodes[id];
      return node ? { ...d, nodes: { ...d.nodes, [id]: { ...node, x, y } } } : d;
    });
  }

  function removeNode() {
    if (!doc || !currentNodeId) return;
    const refs = referrers(doc.nodes, currentNodeId);
    const warn = refs.length > 0 ? `\nНа него ссылаются: ${refs.join(', ')} — ссылки будут сняты.` : '';
    if (!window.confirm(`Удалить узел «${currentNodeId}»?${warn}`)) return;
    updateDoc((d) => {
      const nodes: Record<string, DialogueNode> = {};
      for (const [id, node] of Object.entries(d.nodes)) {
        if (id !== currentNodeId) nodes[id] = relink(node, currentNodeId, null);
      }
      return { start: d.start === currentNodeId ? (Object.keys(nodes)[0] ?? '') : d.start, nodes };
    });
    setSelected(null);
  }

  function rename(nextId: string): boolean {
    if (!doc || !currentNodeId || nextId === currentNodeId) return true;
    if (nextId === '') {
      showToast('id не может быть пустым', 'error');
      return false;
    }
    if (nextId in doc.nodes) {
      showToast(`Узел «${nextId}» уже существует`, 'error');
      return false;
    }
    updateDoc((d) => renameNode(d, currentNodeId, nextId));
    setSelected(nextId);
    return true;
  }

  function createNext() {
    if (!doc || !currentNodeId) return;
    const id = freeId(doc.nodes);
    updateDoc((d) => {
      const node = d.nodes[currentNodeId];
      if (!node) return d;
      return {
        ...d,
        nodes: {
          ...d.nodes,
          [currentNodeId]: { ...node, next: id },
          [id]: { ...BLANK_NODE, x: Math.min((node.x ?? 40) + 20, 98), y: node.y ?? 50 },
        },
      };
    });
    setSelected(id);
  }

  function patchNode(patch: Partial<DialogueNode>) {
    if (!currentNodeId) return;
    updateDoc((d) => {
      const node = d.nodes[currentNodeId];
      if (!node) return d;
      return { ...d, nodes: { ...d.nodes, [currentNodeId]: { ...node, ...patch } } };
    });
  }

  function openEditor() {
    if (!parseDoc(text)) {
      showToast('Битый JSON — редактор недоступен, исправьте текст', 'error');
      return;
    }
    setTab('editor');
  }

  // --- persistence ---

  async function save() {
    if (currentId === null) return;
    if (report.errors.length > 0 || !report.doc) {
      showToast('Есть ошибки — не сохранено', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.updateDialogue(currentId, { title, nodes: report.doc });
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
      setSelected(null);
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
    if (validated.errors.length > 0) {
      setImportErrors(validated.errors);
      showToast('Импорт отклонён: файл не проходит валидацию', 'error');
      return;
    }
    // Import replaces the whole document (never merges) — docs/dialogue-system.md §3.1
    load(JSON.parse(raw));
    showToast('Импортировано — не забудьте сохранить');
  }

  return (
    <div className='lb-section'>
      <div className='poi-panel-header'>
        <h3 className='lb-block-title'>Диалоги</h3>
        <div className='dlg-create-row'>
          <input
            value={newTitle}
            placeholder='Название диалога'
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <button disabled={!newTitle.trim()} onClick={() => void create()}>
            + Новый диалог
          </button>
        </div>
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
          <div className='two-pane-panel poi-edit-panel dlg-panel'>
            <label className='poi-field-label'>Название</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />

            <div className='preview-tabs dlg-tabs'>
              <button
                className={`preview-tab-btn${tab === 'editor' ? ' preview-tab-btn--active' : ''}`}
                onClick={openEditor}
              >
                Граф
              </button>
              <button
                className={`preview-tab-btn${tab === 'json' ? ' preview-tab-btn--active' : ''}`}
                onClick={() => setTab('json')}
              >
                JSON
              </button>
            </div>

            {tab === 'json' ? (
              <textarea
                className='dlg-textarea'
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setImportErrors([]);
                }}
              />
            ) : doc ? (
              <div className='dlg-editor'>
                <div className='dlg-graph-pane'>
                  <DialogueGraph
                    doc={doc}
                    selected={currentNodeId}
                    reachable={reachable}
                    speakerLabel={speakerLabel}
                    onSelect={setSelected}
                    onMove={moveNode}
                    onConnect={connect}
                    onCreateAt={addNode}
                    onDelete={removeNode}
                  />
                  <p className='dlg-graph-hint'>
                    Тяните узлы · порт справа — связь · двойной клик по полю — новый узел · Delete —
                    удалить
                  </p>
                  <div className='dlg-node-actions'>
                    <button onClick={() => addNode()}>+ узел</button>
                    <button disabled={!currentNodeId} onClick={duplicateNode}>
                      Дублировать
                    </button>
                    <button
                      disabled={!currentNodeId || currentNodeId === doc?.start}
                      onClick={() => currentNodeId && updateDoc((d) => ({ ...d, start: currentNodeId }))}
                    >
                      Сделать стартовым
                    </button>
                    <button className='poi-delete-btn' disabled={!currentNodeId} onClick={removeNode}>
                      Удалить узел
                    </button>
                  </div>
                </div>

                {currentNodeId && currentNode ? (
                  <NodeForm
                    id={currentNodeId}
                    node={currentNode}
                    ids={ids}
                    characters={characters}
                    onPatch={patchNode}
                    onRename={rename}
                    onCreateNext={createNext}
                  />
                ) : (
                  <p className='minigames-empty'>Выберите узел слева.</p>
                )}
              </div>
            ) : (
              <p className='dlg-error'>Битый JSON — откройте вкладку «JSON» и исправьте.</p>
            )}

            <div className='dlg-report'>
              {importErrors.map((m) => (
                <p className='dlg-error' key={`imp-${m}`}>
                  ✕ импорт: {m}
                </p>
              ))}
              {report.errors.map((m) => (
                <p className='dlg-error' key={m}>
                  ✕ {m}
                </p>
              ))}
              {report.warnings.map((m) => (
                <p className='dlg-warn' key={m}>
                  ⚠ {m}
                </p>
              ))}
              {report.errors.length === 0 && report.warnings.length === 0 && (
                <p className='dlg-ok'>✓ Диалог корректен</p>
              )}
            </div>

            <div className='poi-panel-actions'>
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
