import { useEffect, useState } from 'react';
import { api, playerTestUrl, type Minigame } from '../api';
import { SchemaForm, missingRequired, type Schema } from '../schema-form/SchemaForm';
import { showToast } from '../toast';
import { UnsavedChangesModal, useUnsavedGuard } from '../ui/UnsavedGuard';

export type Cfg = Record<string, unknown>;

/** Top-level defaults declared by a schema. */
export function defaultsFromSchema(schema: Schema): Cfg {
  const out: Cfg = {};
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    if (sub.default !== undefined) out[key] = sub.default;
  }
  return out;
}

/** Effective config = defaults ⊕ override, merged by top-level key. */
export function mergeTop(defaults: Cfg, override: Cfg): Cfg {
  return { ...defaults, ...override };
}

/** Sparse override: only top-level keys of `config` that differ from `defaults`. */
export function diffTop(defaults: Cfg, config: Cfg): Cfg {
  const out: Cfg = {};
  for (const [key, value] of Object.entries(config)) {
    if (JSON.stringify(value) !== JSON.stringify(defaults[key])) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minigame module contract (see minigame_contract.md)
// ---------------------------------------------------------------------------

interface GameResult {
  score: number;
  won: boolean;
  details?: Record<string, number | string>;
}

interface GameHandle {
  destroy(): void;
}

interface GameModule {
  init(
    container: HTMLElement,
    config: Record<string, unknown> & { muted: boolean },
    callbacks: {
      onComplete: (result: GameResult) => void;
      onExit: () => void;
      onProgress?: (text: string, percent?: number) => void;
    },
  ): GameHandle;
}

// ---------------------------------------------------------------------------
// Test-run overlay — isolated fullscreen launch of a bundle, no meta around it
// ---------------------------------------------------------------------------

export function TestRunOverlay({
  entryUrl,
  config,
  onClose,
}: {
  entryUrl: string;
  config: Cfg;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  // Esc closes only the game (capture + preventDefault → the config modal's own
  // Esc handler sees defaultPrevented and stays open).
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

  useEffect(() => {
    let handle: GameHandle | null = null;
    let disposed = false;
    const container = document.getElementById('sf-test-container');

    function cleanup() {
      if (handle) {
        try {
          handle.destroy();
        } catch {
          // ignore destroy errors
        }
        handle = null;
      }
    }

    if (container) {
      import(/* @vite-ignore */ entryUrl)
        .then((mod: GameModule) => {
          if (disposed) return;
          handle = mod.init(
            container,
            { ...config, muted: false },
            {
              onComplete: (result) => {
                showToast(
                  `Итог: ${result.won ? 'победа' : 'поражение'}, счёт ${result.score}` +
                    (result.details ? ` · ${JSON.stringify(result.details)}` : ''),
                  result.won ? 'success' : 'error',
                );
                cleanup();
                onClose();
              },
              onExit: () => {
                cleanup();
                onClose();
              },
              onProgress: (text) => setProgress(text),
            },
          );
        })
        .catch((e: unknown) => {
          if (disposed) return;
          setError(e instanceof Error ? e.message : 'Не удалось загрузить игру');
        });
    }

    return () => {
      disposed = true;
      cleanup();
    };
  }, [entryUrl, config]);

  return (
    <div className='test-run-overlay'>
      <div className='test-run-banner'>
        <span>{progress || 'тестовый запуск — Esc закрывает'}</span>
        <button className='test-run-close' onClick={onClose}>
          ✕
        </button>
      </div>
      {error && <div className='test-run-error'>{error}</div>}
      <div id='sf-test-container' className='test-run-container' />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config modal — edits a config object for a minigame (defaults or per-game)
// ---------------------------------------------------------------------------

export interface MinigameConfigModalProps {
  minigame: Minigame;
  title: string;
  initialConfig: Cfg;
  onClose: () => void;
  onSave: (config: Cfg) => Promise<void>;
}

export function MinigameConfigModal({
  minigame,
  title,
  initialConfig,
  onClose,
  onSave,
}: MinigameConfigModalProps) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [config, setConfig] = useState<Cfg>(initialConfig);
  /** Snapshot of the last saved config — the yardstick for "has edits". */
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialConfig));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRun, setTestRun] = useState(false);

  const dirty = JSON.stringify(config) !== baseline;
  const guard = useUnsavedGuard(dirty);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(minigame.schemaUrl)
      .then((r) => r.json() as Promise<Schema>)
      .then((sch) => {
        if (cancelled) return;
        setSchema(sch);
        // Schema defaults fill the gaps the stored config doesn't cover.
        const merged = { ...defaultsFromSchema(sch), ...initialConfig };
        setConfig(merged);
        setBaseline(JSON.stringify(merged));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки схемы');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [minigame.schemaUrl]);

  // Esc closes the config window (nested modals intercept Esc first via a
  // capture-phase handler that preventDefaults, so it won't reach here).
  // With unsaved edits it asks first; a second Esc answers "cancel".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (guard.asking) guard.dismiss();
      else requestClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function requestClose() {
    guard.run(onClose);
  }

  async function handleSave(close: boolean): Promise<boolean> {
    // required из схемы раньше был декоративным: игра без обязательного поля
    // уходила на сервер и у игрока падала в аварийную панель.
    const missing = schema ? missingRequired(schema, config) : [];
    if (missing.length > 0) {
      const msg = `Не заполнены обязательные поля: ${missing.join(', ')}`;
      setError(msg);
      showToast(msg, 'error');
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(config);
      setBaseline(JSON.stringify(config));
      showToast('Сохранено');
      if (close) onClose();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения';
      setError(msg);
      showToast(msg, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    // Не сохранилось (обязательные поля, сеть) — вопрос остаётся на экране.
    if (await handleSave(false)) guard.proceed();
  }

  return (
    <>
      <div className='modal-overlay' onClick={requestClose}>
        <div className='modal-card modal-card--config' onClick={(e) => e.stopPropagation()}>
          <div className='modal-header'>
            <span className='modal-title'>
              {title}
              {dirty && ' •'}
            </span>
            <button className='modal-close' title='Закрыть' onClick={requestClose}>
              ✕
            </button>
          </div>

          <div className='modal-body'>
            {loading && <p>Загрузка…</p>}
            {error && <p className='sf-asset-error'>{error}</p>}
            {!loading && schema && (
              <SchemaForm schema={schema} value={config} onChange={setConfig} />
            )}
          </div>

          <div className='modal-actions'>
            {minigame.entryUrl !== null ? (
              <button className='modal-test-btn' disabled={loading} onClick={() => setTestRun(true)}>
                ▶ Запустить в тестовом режиме
              </button>
            ) : (
              // System pseudo-minigame (onboarding): no bundle to run in place —
              // the scenario lives in the player, so the test opens there.
              <button
                className='modal-test-btn'
                onClick={() => window.open(playerTestUrl('onboarding'), '_blank')}
              >
                ▶ Тест обучалки в плеере
              </button>
            )}
            <div className='modal-actions-spacer' />
            <button onClick={() => void handleSave(false)} disabled={saving || loading}>
              Сохранить
            </button>
            <button
              className='modal-save-primary'
              onClick={() => void handleSave(true)}
              disabled={saving || loading}
            >
              Сохранить и закрыть
            </button>
            <button onClick={requestClose}>Отмена</button>
          </div>
        </div>
      </div>

      {/* Сосед оверлея, а не потомок — клик по вопросу не должен всплыть
          в onClick оверлея и закрыть конфиг за спиной у вопроса. */}
      {guard.asking && (
        <UnsavedChangesModal
          subject={title}
          saving={saving}
          onSaveAndClose={() => void saveAndClose()}
          onDiscard={guard.proceed}
          onCancel={guard.dismiss}
        />
      )}

      {/* Sibling of the backdrop, not a child — so clicks inside the game don't
          bubble to the modal-overlay onClose and close everything. */}
      {testRun && minigame.entryUrl !== null && (
        <TestRunOverlay
          entryUrl={minigame.entryUrl}
          config={config}
          onClose={() => setTestRun(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Section — the minigame types themselves: default config + isolated test run
// ---------------------------------------------------------------------------

export function MinigamesSection() {
  const [minigames, setMinigames] = useState<Minigame[]>([]);
  const [current, setCurrent] = useState<Minigame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMinigames()
      .then(setMinigames)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }, []);

  return (
    <div className='minigames-section'>
      <h3 className='minigames-title'>Мини-игры</h3>
      <p className='minigames-empty'>
        Дефолтные конфиги типов мини-игр. Конкретная игра (вкладка «Игры») переопределяет их своим
        конфигом.
      </p>
      {error && <p className='sf-asset-error'>{error}</p>}

      <div className='minigames-list' style={{ marginTop: 16 }}>
        {minigames.map((mg) => (
          <button key={mg.id} className='minigames-row' onClick={() => setCurrent(mg)}>
            <span className='minigames-row-name'>{mg.title}</span>
            <span className='minigames-row-game'>{mg.id} · дефолтный конфиг ▸</span>
          </button>
        ))}
        {minigames.length === 0 && !error && (
          <p className='minigames-empty'>Нет собранных мини-игр (server/static/minigames пуст).</p>
        )}
      </div>

      {current && (
        <MinigameConfigModal
          minigame={current}
          title={`${current.title} — дефолтный конфиг`}
          initialConfig={(current.defaultConfig ?? {}) as Cfg}
          onClose={() => setCurrent(null)}
          onSave={async (config) => {
            await api.updateMinigameDefaults(current.id, config);
            setMinigames((prev) =>
              prev.map((m) => (m.id === current.id ? { ...m, defaultConfig: config } : m)),
            );
          }}
        />
      )}
    </div>
  );
}
