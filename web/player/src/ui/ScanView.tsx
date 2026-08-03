import { useEffect, useRef } from 'react';
import { startScan } from '../camera/QrScanner';

interface ScanViewProps {
  onDecode: (text: string) => void;
  /** Stream or decoder failure — name of the DOMException, or 'DecoderUnavailable'. */
  onError?: (name: string) => void;
  /** Freezes the loop (refusal screen on top of the scanner). */
  paused?: boolean;
  /** One-liner under the reticle. */
  hint?: string;
  /** Transient rejection plate over the reticle ('КОД НЕ ОПОЗНАН'). */
  flash?: string | null;
}

/**
 * Live camera feed with the targeting reticle — the visual half of the scanner,
 * shared by onboarding and the qr-scan screen.
 */
export function ScanView({ onDecode, onError, paused, hint, flash }: ScanViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Latched so a re-render with a fresh closure doesn't restart the decode loop.
  const decodeRef = useRef(onDecode);
  const errorRef = useRef(onError);
  decodeRef.current = onDecode;
  errorRef.current = onError;

  useEffect(() => {
    const video = videoRef.current;
    if (paused || !video) return;
    const handle = startScan(
      video,
      (text) => decodeRef.current(text),
      (name) => errorRef.current?.(name),
    );
    return handle.stop;
  }, [paused]);

  return (
    <div className="scanview">
      <video ref={videoRef} className="scan-video" muted playsInline />
      <div className="scan-frame">
        <i className="scan-corner tl" />
        <i className="scan-corner tr" />
        <i className="scan-corner bl" />
        <i className="scan-corner br" />
        {!paused && <div className="scan-line" />}
        {flash && <div className="scan-flash">{flash}</div>}
      </div>
      {hint && <span className="label scan-hint">{hint}</span>}
    </div>
  );
}
