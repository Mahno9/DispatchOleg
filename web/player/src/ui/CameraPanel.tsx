import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSnapshot, getStream, subscribe } from '../camera/camera';

/** Bottom-bar slot 1: live webcam feed, or a NO SIGNAL / SIGNAL LOST plate. */
export function CameraPanel() {
  const cam = useSyncExternalStore(subscribe, getSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (cam.status !== 'live') return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = cam.stream;
    void video.play().catch(() => {
      // Autoplay refused (no gesture yet) — the placeholder stays visible.
    });
    return () => {
      video.srcObject = null;
    };
  }, [cam]);

  // The stream is normally started by onboarding; reconnecting here covers the
  // case where the device came back after a SIGNAL LOST.
  useEffect(() => {
    if (cam.status === 'off') void getStream().catch(() => {});
  }, [cam.status]);

  if (cam.status === 'live') {
    return <video ref={videoRef} className="camera-video" muted playsInline />;
  }

  const lost = cam.status === 'error' && cam.error === 'SignalLost';
  const requesting = cam.status === 'requesting';

  return (
    <div className="camera-placeholder">
      <span className={`status ${lost ? 'status-alert' : 'status-warn'}`}>
        <i className="marker marker-blink" />
        {requesting ? 'ЗАПРОС' : lost ? 'SIGNAL LOST' : 'NO SIGNAL'}
      </span>
      {cam.status === 'error' && (
        <button
          type="button"
          className="btn"
          style={{ minHeight: 26, padding: '4px 10px', fontSize: '0.8rem' }}
          onClick={() => void getStream().catch(() => {})}
        >
          Переподключить
        </button>
      )}
    </div>
  );
}
