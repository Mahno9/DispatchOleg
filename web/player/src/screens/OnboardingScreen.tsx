import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiError, api } from '../api';
import {
  getSnapshot as cameraSnapshot,
  getStream,
  subscribe as subscribeCamera,
} from '../camera/camera';
import { isDispatchCode } from '../camera/QrScanner';
import { localState } from '../state/localState';
import { testTarget } from '../testMode';
import { ScanView } from '../ui/ScanView';

// ---------------------------------------------------------------------------
// Onboarding — the platform-level intro scenario (docs/minigames/01-onboarding.md):
// boot splash → name (= registration) → camera permission → scan of the tutorial
// QR → onboarded. Not a minigame bundle: it needs the session API, the camera
// singleton and the bottom bar, all of which the minigame contract forbids.
// ---------------------------------------------------------------------------

/**
 * Fallbacks for every field of server/system-minigames/onboarding/schema.json.
 * The tutorial game's config_json (GET /api/games/:id/config) is merged on top —
 * these values are what runs when the tutorial row or a given field is missing.
 * Keep in sync with the schema's defaults.
 */
export const TEXTS = {
  bootText: [
    'ДИСПЕТЧЕРСКИЙ ТЕРМИНАЛ ОЛЕГ v1.7',
    'ПРОВЕРКА ПИТАНИЯ......... OK',
    'ПРОВЕРКА ПАМЯТИ.......... OK',
    'ВИДЕОКАНАЛ............... НЕ НАЙДЕН',
    'БАЗА ОПЕРАТОРОВ.......... OK',
    'ОЖИДАНИЕ ИДЕНТИФИКАЦИИ',
  ].join('\n'),
  namePrompt: 'ПРЕДСТАВЬТЕСЬ, ОПЕРАТОР',
  qrHintText: 'НА КОРОБКЕ НАПЕЧАТАН СЛУЖЕБНЫЙ КОД.\nВКЛЮЧИТЕ КАМЕРУ И ПОКАЖИТЕ ЕГО ТЕРМИНАЛУ.',
  scanFailText: 'КОД НЕ ОПОЗНАН',
  noCameraText: 'ВИДЕОУСТРОЙСТВО НЕ ОБНАРУЖЕНО. ПОДКЛЮЧИТЕ КАМЕРУ И ПОВТОРИТЕ.',
  deniedText: 'ДОСТУП К ВИДЕОКАНАЛУ ОТКЛОНЁН. РАЗРЕШИТЕ КАМЕРУ В НАСТРОЙКАХ БРАУЗЕРА И ПОВТОРИТЕ.',
  busyCameraText: 'ВИДЕОКАНАЛ ЗАНЯТ ДРУГОЙ ПРОГРАММОЙ. ЗАКРОЙТЕ ЕЁ И ПОВТОРИТЕ.',
  successText: 'ОПЕРАТОР ПОДКЛЮЧЁН. ДОБРО ПОЖАЛОВАТЬ В СМЕНУ.',
  netFailText: 'НЕТ СВЯЗИ С ЦЕНТРОМ',
  decoderFailText: 'МОДУЛЬ РАСПОЗНАВАНИЯ НЕ ЗАГРУЖЕН',
  nameTakenText: 'ИМЯ УЖЕ ЗАНЯТО. ВЫБЕРИТЕ ДРУГОЕ.',
  nameNetFailText: 'СВЯЗЬ С ЦЕНТРОМ ПОТЕРЯНА. ПОВТОРИТЕ.',
  scanPrompt: 'НАВЕДИТЕ КАМЕРУ НА КОД',
  /** Photo of the box with the QR — empty means the outline placeholder. */
  qrHintImage: '',
  /** Emergency lever (spec §2.4): finish onboarding without ever scanning. */
  allowSkipScan: false,
  bootLineDelayMs: 320,
  bootHoldMs: 900,
  bootSkipHintMs: 1500,
  scanFailFlashMs: 1200,
  successHoldMs: 1800,
  nameMinLength: 2,
  nameMaxLength: 24,
};

export type OnboardingTexts = typeof TEXTS;

/**
 * Tutorial `config_json` ⊕ defaults, by top-level key. Unknown keys, type
 * mismatches and blank strings are dropped: a text the admin cleared is a slip,
 * not a request for an empty screen. A list of lines (how the schema makes
 * multi-line text editable in the admin form) collapses to a '\n' string.
 */
export function mergeTexts(config: Record<string, unknown> | null | undefined): OnboardingTexts {
  const out: Record<string, unknown> = { ...TEXTS };
  for (const [key, raw] of Object.entries(config ?? {})) {
    if (!(key in TEXTS)) continue;
    const value = Array.isArray(raw)
      ? raw.filter((line): line is string => typeof line === 'string').join('\n')
      : raw;
    if (value === '' || value === null || value === undefined) continue;
    if (typeof value !== typeof out[key]) continue;
    out[key] = value;
  }
  return out as OnboardingTexts;
}

const TextsCtx = createContext<OnboardingTexts>(TEXTS);
const useTexts = () => useContext(TextsCtx);

export type OnboardingStep = 'boot' | 'name' | 'hint' | 'scanning' | 'success';

/** Slot 2 of the bottom bar, per step (spec §1.1–1.5 tables). */
export const STEP_STATUS: Record<OnboardingStep, string> = {
  boot: 'СИСТЕМА: ИНИЦИАЛИЗАЦИЯ',
  name: 'ИДЕНТИФИКАЦИЯ ОПЕРАТОРА',
  hint: 'ТРЕБУЕТСЯ ВИДЕОКАНАЛ',
  scanning: 'ПОИСК КОДА…',
  success: 'ОПЕРАТОР ПОДКЛЮЧЁН',
};

/** Client-side name check (UX only — the server repeats it). Null = acceptable. */
export function nameError(raw: string, t: OnboardingTexts = TEXTS): string | null {
  const name = raw.trim();
  if (/\p{Cc}/u.test(name)) return 'НЕДОПУСТИМЫЕ СИМВОЛЫ';
  if (name.length < t.nameMinLength) return `МИНИМУМ ${t.nameMinLength} СИМВОЛА`;
  if (name.length > t.nameMaxLength) return `МАКСИМУМ ${t.nameMaxLength} СИМВОЛА`;
  return null;
}

/** getUserMedia failure → the text the player is supposed to act on (spec §6.1–6.3). */
export function cameraErrorText(name: string, t: OnboardingTexts = TEXTS): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return t.deniedText;
    case 'NotReadableError':
    case 'AbortError':
      return t.busyCameraText;
    default:
      return t.noCameraText;
  }
}

/** Where a reload lands: name already registered → straight back to the camera. */
function initialStep(): OnboardingStep {
  if (!localState.getSnapshot().profile.userId) return 'boot';
  // A page reload loses the stream and getUserMedia needs a fresh gesture, so
  // 'hint' is the honest resume point unless the stream is somehow still live.
  return cameraSnapshot().status === 'live' ? 'scanning' : 'hint';
}

interface OnboardingScreenProps {
  onDone: () => void;
  /** Lets the shell mirror the current step into bottom-bar slot 2. */
  onStatus?: (status: string) => void;
  /** config_json of the is_tutorial game; undefined until loaded (or forever, if
   *  the DB has no tutorial row) — the defaults carry the flow either way. */
  config?: Record<string, unknown> | null;
}

export function OnboardingScreen({ onDone, onStatus, config }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const texts = useMemo(() => mergeTexts(config), [config]);

  // Step transitions, kept stable to avoid needless re-renders. Correctness no
  // longer rides on it: the boot/success screens hold their callbacks in refs,
  // so their timers survive an unstable prop from anywhere up the tree.
  const toName = useCallback(() => setStep('name'), []);
  const toHint = useCallback(() => setStep('hint'), []);
  const toSuccess = useCallback(() => setStep('success'), []);

  useEffect(() => {
    onStatus?.(STEP_STATUS[step]);
  }, [step, onStatus]);

  return <TextsCtx.Provider value={texts}>{renderStep()}</TextsCtx.Provider>;

  function renderStep() {
    switch (step) {
      case 'boot':
        return <BootScreen onSkip={toName} />;
      case 'name':
        return <NameEntry onRegistered={(onboarded) => (onboarded ? onDone() : toHint())} />;
      case 'hint':
        return <CameraHint onLive={() => setStep('scanning')} onSkip={toSuccess} />;
      case 'scanning':
        return <Scanning onVerified={toSuccess} onCameraLost={toHint} onSkip={toSuccess} />;
      case 'success':
        return <SuccessScreen onDone={onDone} />;
    }
  }
}

/** Emergency lever (spec §2.4): shown only when the admin turned it on. */
function SkipScanButton({ onSkip }: { onSkip: () => void }) {
  const t = useTexts();
  if (!t.allowSkipScan) return null;
  return (
    <button type="button" className="btn btn-danger onboarding-skip" onClick={onSkip}>
      Пропустить сканирование
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1.1 boot
// ---------------------------------------------------------------------------

function BootScreen({ onSkip }: { onSkip: () => void }) {
  const t = useTexts();
  const lines = t.bootText.split('\n');
  const [shown, setShown] = useState(t.bootLineDelayMs > 0 ? 1 : lines.length);
  const [showHint, setShowHint] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Same guard as SuccessScreen: the line-feed timer must not depend on the
  // identity of a callback the parent may recreate on every render.
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), t.bootSkipHintMs);
    return () => clearTimeout(timer);
  }, [t.bootSkipHintMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') skipRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    const done = shown >= lines.length;
    const timer = setTimeout(
      () => (done ? skipRef.current() : setShown((n) => n + 1)),
      done ? t.bootHoldMs : t.bootLineDelayMs,
    );
    return () => clearTimeout(timer);
  }, [shown, lines.length, t.bootHoldMs, t.bootLineDelayMs]);

  return (
    <div className="screen boot" onClick={onSkip}>
      <div className="boot-log mono" ref={logRef}>
        {lines.slice(0, shown).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        <span className="boot-cursor" />
      </div>
      {showHint && <span className="label boot-skip">Пробел — пропустить</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1.2 name-entry = registration
// ---------------------------------------------------------------------------

function NameEntry({ onRegistered }: { onRegistered: (onboarded: boolean) => void }) {
  const t = useTexts();
  const [name, setName] = useState(() => localState.getSnapshot().profile.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hint = nameError(name, t);

  async function submit() {
    if (hint || pending) return;
    // Test run: no real registration — a DB player per test would be junk.
    // Empty userId also keeps sync off; the tutorial QR verify still passes.
    if (testTarget) {
      localState.setProfile({ userId: '', name: name.trim() });
      return onRegistered(false);
    }
    setPending(true);
    setError(null);
    try {
      const { user } = await api.postSession(name.trim());
      localState.setProfile({ userId: user.id, name: user.name });
      onRegistered(user.onboarded);
    } catch (err) {
      setRetry(true);
      if (err instanceof ApiError && err.status === 409) {
        setError(t.nameTakenText);
        inputRef.current?.select();
      } else if (err instanceof ApiError && err.status === 400) {
        setError(nameError(name, t) ?? t.nameNetFailText);
      } else {
        setError(t.nameNetFailText);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="screen screen-center">
      <form
        className="panel form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t.namePrompt}</h2>
        <input
          ref={inputRef}
          className="field"
          type="text"
          autoFocus
          maxLength={t.nameMaxLength}
          disabled={pending}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="form-foot">
          {/* Reserved line: the panel must not jump when an error appears. */}
          <span className={`label ${error ? 'error-line' : ''}`}>
            {error ? (
              <>
                <i className="marker marker-blink" />
                {error}
              </>
            ) : (
              (hint ?? ' ')
            )}
          </span>
          <span className="label">
            {name.trim().length}/{t.nameMaxLength}
          </span>
        </div>
        <button type="submit" className="btn" disabled={!!hint || pending}>
          {pending ? '…Проверка' : retry ? 'Повторить' : 'Подтвердить'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1.3 camera-hint
// ---------------------------------------------------------------------------

function CameraHint({ onLive, onSkip }: { onLive: () => void; onSkip: () => void }) {
  const t = useTexts();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Spec §6.14: a broken asset must not take the panel down with it.
  const [imageBroken, setImageBroken] = useState(false);

  async function enable() {
    if (pending) return;
    setPending(true); // synchronous, before the await — double clicks do nothing
    setError(null);
    try {
      await getStream();
      onLive();
    } catch (err) {
      setError(cameraErrorText(err instanceof DOMException ? err.name : 'UnknownError', t));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="screen screen-center">
      <div className="panel hint-panel">
        {t.qrHintImage && !imageBroken ? (
          <img
            className="hint-image"
            src={t.qrHintImage}
            alt=""
            onError={() => setImageBroken(true)}
          />
        ) : (
          <div className="qr-placeholder" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        <div className="hint-body">
          {t.qrHintText.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          <button
            type="button"
            className="btn btn-amber"
            disabled={pending}
            onClick={() => void enable()}
          >
            {pending ? '…Запрос доступа' : error ? 'Повторить' : 'Включить камеру'}
          </button>
          {error && (
            <div className="error-panel">
              <span className="label error-line">
                <i className="marker marker-blink" />
                {error}
              </span>
              {error === t.deniedText && (
                <span className="label dim">Значок камеры в адресной строке → разрешить</span>
              )}
            </div>
          )}
          <SkipScanButton onSkip={onSkip} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1.4 scanning
// ---------------------------------------------------------------------------

function Scanning({
  onVerified,
  onCameraLost,
  onSkip,
}: {
  onVerified: () => void;
  onCameraLost: () => void;
  onSkip: () => void;
}) {
  const t = useTexts();
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const camera = useSyncExternalStore(subscribeCamera, cameraSnapshot);

  const showFlash = useCallback(
    (text: string) => {
      setFlash(text);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), t.scanFailFlashMs);
    },
    [t.scanFailFlashMs],
  );

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Device unplugged / grabbed by another app mid-scan (spec §6.10): back to the
  // hint screen, where the button already reads ПОВТОРИТЬ.
  useEffect(() => {
    if (camera.status === 'error') onCameraLost();
  }, [camera.status, onCameraLost]);

  const onDecode = useCallback(
    (text: string) => {
      // Foreign QRs are rejected locally: the player still gets feedback, the
      // server does not get the traffic (spec §6.4).
      if (!isDispatchCode(text)) return showFlash(t.scanFailText);
      const userId = localState.getSnapshot().profile.userId;
      api.verifyQr({ payload: text, userId }).then(
        (res) => {
          // Only the tutorial game opens this gate — a valid code of any other
          // game must not skip registration/camera setup.
          if (res.ok && res.game.isTutorial) onVerified();
          else showFlash(t.scanFailText);
        },
        () => showFlash(t.netFailText),
      );
    },
    [onVerified, showFlash, t.scanFailText, t.netFailText],
  );

  return (
    <div className="screen">
      <ScanView
        onDecode={onDecode}
        onError={(name) =>
          name === 'DecoderUnavailable' ? showFlash(t.decoderFailText) : onCameraLost()
        }
        hint={t.scanPrompt}
        flash={flash}
      />
      <SkipScanButton onSkip={onSkip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1.5 success
// ---------------------------------------------------------------------------

function SuccessScreen({ onDone }: { onDone: () => void }) {
  const t = useTexts();
  // The hold timer must survive an unstable parent callback: App re-renders once
  // a second (the clock), so an inline `onDone` in the deps would restart the
  // timeout before it ever fires and strand the player on this screen. The ref
  // keeps the latest callback without making it a dependency.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), t.successHoldMs);
    return () => clearTimeout(timer);
  }, [t.successHoldMs]);

  return (
    <div className="screen screen-center success-flash">
      <h1 className="success-text">{t.successText}</h1>
    </div>
  );
}
