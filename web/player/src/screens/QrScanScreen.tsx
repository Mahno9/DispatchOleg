import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type VerifiedGame } from '../api';
import { isDispatchCode } from '../camera/QrScanner';
import { ScanView } from '../ui/ScanView';
import { TEXTS, cameraErrorText } from './OnboardingScreen';

interface QrScanScreenProps {
  userId: string;
  onVerified: (game: VerifiedGame) => void;
  /** Refusal screens send the player back to meta. */
  onBack: () => void;
}

/**
 * qr-scan (docs/platform.md §2.3): big video, decode → POST /api/qr/verify.
 * Unrecognised codes only flash and scanning continues; `locked` stops the
 * scanner and shows why, so a held-up code cannot re-trigger the request.
 */
export function QrScanScreen({ userId, onVerified, onBack }: QrScanScreenProps) {
  const [locked, setLocked] = useState<string[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), TEXTS.scanFailFlashMs);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const onDecode = useCallback(
    (text: string) => {
      if (!isDispatchCode(text)) return showFlash(TEXTS.scanFailText);
      api.verifyQr({ payload: text, userId }).then(
        (res) => {
          if (res.ok) onVerified(res.game);
          else if (res.reason === 'locked') setLocked(res.requiredTitles);
          else showFlash(TEXTS.scanFailText);
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
          showFlash(name === 'DecoderUnavailable' ? TEXTS.decoderFailText : cameraErrorText(name))
        }
        paused={locked !== null}
        hint={TEXTS.scanPrompt}
        flash={flash}
      />

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
