import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type QrVerifyResponse, type VerifiedGame } from '../api';
import {
  getSnapshot as cameraSnapshot,
  getStream,
  subscribe as subscribeCamera,
  type CameraState,
} from '../camera/camera';
import { isDispatchCode } from '../camera/QrScanner';
import { ScanView } from '../ui/ScanView';
import { TEXTS, cameraErrorText } from './OnboardingScreen';

interface QrScanScreenProps {
  userId: string;
  onVerified: (game: VerifiedGame) => void;
  /** Refusal screens send the player back to meta. */
  onBack: () => void;
}

/** Коробочный код уже отработал на онбординге — системную игру не запустить. */
export const TUTORIAL_DONE_TEXT = 'ОБУЧЕНИЕ УЖЕ ПРОЙДЕНО';

/** Что делать с ответом `/api/qr/verify`. */
export type ScanVerdict =
  | { kind: 'start'; game: VerifiedGame }
  | { kind: 'locked'; titles: string[] }
  | { kind: 'flash'; text: string };

/**
 * Разбор ответа сервера. Код обучалки валиден и после онбординга, но у
 * системной игры нет бандла (`entryUrl: null`), и запуск обернулся бы «Сбоем
 * запуска» — здесь он просто отбивается.
 */
export function verifyVerdict(res: QrVerifyResponse): ScanVerdict {
  if (res.ok) {
    if (res.game.isTutorial) return { kind: 'flash', text: TUTORIAL_DONE_TEXT };
    return { kind: 'start', game: res.game };
  }
  if (res.reason === 'locked') return { kind: 'locked', titles: res.requiredTitles };
  return { kind: 'flash', text: TEXTS.scanFailText };
}

/**
 * Текст панели ошибки камеры: `null` — панели нет. Пропавший посреди скана
 * стрим (`SignalLost` в camera.ts) — та же беда, что и отказ на старте, иначе
 * игрок остался бы смотреть на замерший кадр.
 */
export function scanErrorText(camera: CameraState, scanError: string | null): string | null {
  if (camera.status === 'error') return cameraErrorText(camera.error);
  return scanError;
}

/**
 * qr-scan (docs/platform.md §2.3): big video, decode → POST /api/qr/verify.
 * Unrecognised codes only flash and scanning continues; `locked` stops the
 * scanner and shows why, so a held-up code cannot re-trigger the request.
 */
export function QrScanScreen({ userId, onVerified, onBack }: QrScanScreenProps) {
  const [locked, setLocked] = useState<string[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** Ошибка от самого сканера; потеря стрима приезжает снапшотом камеры. */
  const [scanError, setScanError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const camera = useSyncExternalStore(subscribeCamera, cameraSnapshot);

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), TEXTS.scanFailFlashMs);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const cameraError = scanErrorText(camera, scanError);

  const onDecode = useCallback(
    (text: string) => {
      if (!isDispatchCode(text)) return showFlash(TEXTS.scanFailText);
      api.verifyQr({ payload: text, userId }).then(
        (res) => {
          const verdict = verifyVerdict(res);
          if (verdict.kind === 'start') onVerified(verdict.game);
          else if (verdict.kind === 'locked') setLocked(verdict.titles);
          else showFlash(verdict.text);
        },
        () => showFlash(TEXTS.netFailText),
      );
    },
    [userId, onVerified, showFlash],
  );

  return (
    <div className="screen">
      <ScanView
        onDecode={onDecode}
        onError={(name) =>
          name === 'DecoderUnavailable'
            ? showFlash(TEXTS.decoderFailText)
            : setScanError(cameraErrorText(name))
        }
        // Пока висит панель, кадры не разбираем: сканеру всё равно нечего читать.
        paused={locked !== null || cameraError !== null}
        hint={TEXTS.scanPrompt}
        flash={flash}
      />

      {cameraError && (
        <div className="scan-refusal">
          <div className="panel error-panel">
            <span className="label error-line">
              <i className="marker marker-blink" />
              {cameraError}
            </span>
            <button
              type="button"
              className="btn btn-amber"
              onClick={() => {
                // Снимаем свою ошибку и просим стрим заново: не дали — снапшот
                // камеры снова станет `error`, и панель вернётся сама.
                setScanError(null);
                void getStream().catch(() => {});
              }}
            >
              ПЕРЕПОДКЛЮЧИТЬ
            </button>
          </div>
        </div>
      )}

      {locked && (
        <div className="scan-refusal">
          <div className="panel">
            <h2 className="error-line">Доступ запрещён</h2>
            <p className="label">Требуется прогресс в: {locked.join(', ')}</p>
            <button type="button" className="btn" onClick={onBack}>
              ОК
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
