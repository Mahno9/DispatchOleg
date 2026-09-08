import { describe, expect, it } from 'vitest';
import type { CameraState } from '../camera/camera';
import { cameraPlate } from './CameraPanel';

const live: CameraState = { status: 'live', stream: null as unknown as MediaStream };

describe('cameraPlate', () => {
  it('живой кадр плашки не требует', () => {
    expect(cameraPlate(live)).toBeNull();
  });

  // Раньше панель дёргала getStream сама при монтировании — то есть на каждой
  // перезагрузке страницы после онбординга. Safari и iOS отвечают на запрос без
  // жеста отказом, и камера была мертва до ручного «Переподключить».
  it('выключенная камера предлагает кнопку, а не молчит', () => {
    expect(cameraPlate({ status: 'off' })).toEqual({
      text: 'NO SIGNAL',
      alert: false,
      button: 'connect',
    });
  });

  it('пока запрос летит, нажимать нечего', () => {
    expect(cameraPlate({ status: 'requesting' })).toEqual({
      text: 'ЗАПРОС',
      alert: false,
      button: null,
    });
  });

  it('отказ и пропавший стрим различимы, и оба переподключаются', () => {
    expect(cameraPlate({ status: 'error', error: 'NotAllowedError' })).toEqual({
      text: 'NO SIGNAL',
      alert: false,
      button: 'retry',
    });
    expect(cameraPlate({ status: 'error', error: 'SignalLost' })).toEqual({
      text: 'SIGNAL LOST',
      alert: true,
      button: 'retry',
    });
  });
});
