import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSnapshot, getStream, subscribe, type CameraState } from '../camera/camera';

/** Плашка в слоте камеры вместо кадра: что написано и что предлагается нажать. */
export interface CameraPlate {
  text: string;
  /** Красный, а не жёлтый: камера была и пропала посреди смены. */
  alert: boolean;
  /** `null` — кнопки нет: запрос уже летит. */
  button: 'connect' | 'retry' | null;
}

/**
 * Что показать в слоте камеры. `null` — есть живой кадр, плашка не нужна.
 * В состоянии `off` стоит именно кнопка: `getUserMedia` обязан вызываться из
 * жеста игрока (camera/camera.ts), иначе Safari и iOS отвечают отказом ещё до
 * того, как игрок увидит вопрос, и камера мертва до ручного переподключения.
 */
export function cameraPlate(cam: CameraState): CameraPlate | null {
  switch (cam.status) {
    case 'live':
      return null;
    case 'requesting':
      return { text: 'ЗАПРОС', alert: false, button: null };
    case 'error':
      return {
        text: cam.error === 'SignalLost' ? 'SIGNAL LOST' : 'NO SIGNAL',
        alert: cam.error === 'SignalLost',
        button: 'retry',
      };
    case 'off':
      return { text: 'NO SIGNAL', alert: false, button: 'connect' };
  }
}

/**
 * Разрешение на камеру уже выдано (десктопный Chrome после онбординга): стрим
 * можно поднять и без жеста — браузер ни о чём не спросит. Где Permissions API
 * нет или он не знает про камеру (Safari, часть Firefox), отвечаем «нет»:
 * лишняя кнопка безобиднее отказа, который потом не переспросить.
 */
async function cameraGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

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

  // Сам стрим не поднимаем: getUserMedia без жеста игрока — это отказ в Safari
  // и на iOS. Исключение — уже выданное разрешение: промпта не будет, и после
  // перезагрузки страницы камера включается сама, как и раньше.
  useEffect(() => {
    if (cam.status !== 'off') return;
    let live = true;
    void cameraGranted().then((granted) => {
      if (live && granted) void getStream().catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [cam.status]);

  if (cam.status === 'live') {
    return <video ref={videoRef} className="camera-video" muted playsInline />;
  }

  const plate = cameraPlate(cam);

  return (
    <div className="camera-placeholder">
      <span className={`status ${plate?.alert ? 'status-alert' : 'status-warn'}`}>
        <i className="marker marker-blink" />
        {plate?.text}
      </span>
      {plate?.button && (
        <button
          type="button"
          className="btn"
          style={{ minHeight: 26, padding: '4px 10px', fontSize: '0.8rem' }}
          onClick={() => void getStream().catch(() => {})}
        >
          {plate.button === 'connect' ? 'Включить' : 'Переподключить'}
        </button>
      )}
    </div>
  );
}
