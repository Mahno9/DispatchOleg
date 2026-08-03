import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from '../api';
import {
  getSnapshot as cameraSnapshot,
  getStream,
  subscribe as subscribeCamera,
} from '../camera/camera';
import { isDispatchCode } from '../camera/QrScanner';
import { localState } from '../state/localState';
import { ScanView } from '../ui/ScanView';

// ---------------------------------------------------------------------------
// Onboarding — the platform-level intro scenario (docs/minigames/01-onboarding.md):
// boot splash → name (= registration) → camera permission → scan of the tutorial
// QR → onboarded. Not a minigame bundle: it needs the session API, the camera
// singleton and the bottom bar, all of which the minigame contract forbids.
// ---------------------------------------------------------------------------

/**
 * Defaults from the spec's schema.json table. They live here as constants until
 * the tutorial game's config is delivered with the bootstrap payload — the shape
 * is deliberately flat so it can be swapped for that config verbatim.
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
  bootLineDelayMs: 320,
  bootHoldMs: 900,
  bootSkipHintMs: 1500,
  scanFailFlashMs: 1200,
  successHoldMs: 1800,
  nameMinLength: 2,
  nameMaxLength: 24,
};

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
export function nameError(raw: string): string | null {
  const name = raw.trim();
  if (/\p{Cc}/u.test(name)) return 'НЕДОПУСТИМЫЕ СИМВОЛЫ';
  if (name.length < TEXTS.nameMinLength) return `МИНИМУМ ${TEXTS.nameMinLength} СИМВОЛА`;
  if (name.length > TEXTS.nameMaxLength) return `МАКСИМУМ ${TEXTS.nameMaxLength} СИМВОЛА`;
  return null;
}

/** getUserMedia failure → the text the player is supposed to act on (spec §6.1–6.3). */
export function cameraErrorText(name: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return TEXTS.deniedText;
    case 'NotReadableError':
    case 'AbortError':
      return TEXTS.busyCameraText;
    default:
      return TEXTS.noCameraText;
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
}

export function OnboardingScreen({ onDone, onStatus }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);

  // Stable callbacks: the boot/success screens run timers keyed on them.
  const toName = useCallback(() => setStep('name'), []);
  const toHint = useCallback(() => setStep('hint'), []);
  const toSuccess = useCallback(() => setStep('success'), []);

  useEffect(() => {
    onStatus?.(STEP_STATUS[step]);
  }, [step, onStatus]);

  switch (step) {
    case 'boot':
      return <BootScreen onSkip={toName} />;
    case 'name':
      return <NameEntry onRegistered={(onboarded) => (onboarded ? onDone() : toHint())} />;
    case 'hint':
      return <CameraHint onLive={() => setStep('scanning')} />;
    case 'scanning':
      return <Scanning onVerified={toSuccess} onCameraLost={toHint} />;
    case 'success':
      return <SuccessScreen onDone={onDone} />;
  }
}

// ---------------------------------------------------------------------------
// 1.1 boot
// ---------------------------------------------------------------------------

function BootScreen({ onSkip }: { onSkip: () => void }) {
  const lines = TEXTS.bootText.split('\n');
  const [shown, setShown] = useState(TEXTS.bootLineDelayMs > 0 ? 1 : lines.length);
  const [showHint, setShowHint] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), TEXTS.bootSkipHintMs);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    const done = shown >= lines.length;
    const timer = setTimeout(
      () => (done ? onSkip() : setShown((n) => n + 1)),
      done ? TEXTS.bootHoldMs : TEXTS.bootLineDelayMs,
    );
    return () => clearTimeout(timer);
  }, [shown, lines.length, onSkip]);

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
  const [name, setName] = useState(() => localState.getSnapshot().profile.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hint = nameError(name);

  async function submit() {
    if (hint || pending) return;
    setPending(true);
    setError(null);
    try {
      const { user } = await api.postSession(name.trim());
      localState.setProfile({ userId: user.id, name: user.name });
      onRegistered(user.onboarded);
    } catch (err) {
      setRetry(true);
      if (err instanceof ApiError && err.status === 409) {
        setError(TEXTS.nameTakenText);
        inputRef.current?.select();
      } else if (err instanceof ApiError && err.status === 400) {
        setError(nameError(name) ?? TEXTS.nameNetFailText);
      } else {
        setError(TEXTS.nameNetFailText);
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
        <h2>{TEXTS.namePrompt}</h2>
        <input
          ref={inputRef}
          className="field"
          type="text"
          autoFocus
          maxLength={TEXTS.nameMaxLength}
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
            {name.trim().length}/{TEXTS.nameMaxLength}
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

function CameraHint({ onLive }: { onLive: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    if (pending) return;
    setPending(true); // synchronous, before the await — double clicks do nothing
    setError(null);
    try {
      await getStream();
      onLive();
    } catch (err) {
      setError(cameraErrorText(err instanceof DOMException ? err.name : 'UnknownError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="screen screen-center">
      <div className="panel hint-panel">
        <div className="qr-placeholder" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="hint-body">
          {TEXTS.qrHintText.split('\n').map((line, i) => (
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
              {error === TEXTS.deniedText && (
                <span className="label dim">Значок камеры в адресной строке → разрешить</span>
              )}
            </div>
          )}
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
}: {
  onVerified: () => void;
  onCameraLost: () => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const camera = useSyncExternalStore(subscribeCamera, cameraSnapshot);

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), TEXTS.scanFailFlashMs);
  }, []);

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
      if (!isDispatchCode(text)) return showFlash(TEXTS.scanFailText);
      const userId = localState.getSnapshot().profile.userId;
      api.verifyQr({ payload: text, userId }).then(
        (res) => {
          // Only the tutorial game opens this gate — a valid code of any other
          // game must not skip registration/camera setup.
          if (res.ok && res.game.isTutorial) onVerified();
          else showFlash(TEXTS.scanFailText);
        },
        () => showFlash(TEXTS.netFailText),
      );
    },
    [onVerified, showFlash],
  );

  return (
    <div className="screen">
      <ScanView
        onDecode={onDecode}
        onError={(name) =>
          name === 'DecoderUnavailable' ? showFlash(TEXTS.decoderFailText) : onCameraLost()
        }
        hint={TEXTS.scanPrompt}
        flash={flash}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1.5 success
// ---------------------------------------------------------------------------

function SuccessScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, TEXTS.successHoldMs);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="screen screen-center success-flash">
      <h1 className="success-text">{TEXTS.successText}</h1>
    </div>
  );
}
