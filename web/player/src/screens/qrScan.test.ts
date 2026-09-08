import { describe, expect, it } from 'vitest';
import type { QrVerifyResponse, VerifiedGame } from '../api';
import type { CameraState } from '../camera/camera';
import { TEXTS } from './OnboardingScreen';
import { TUTORIAL_DONE_TEXT, scanErrorText, verifyVerdict } from './QrScanScreen';

const game = (isTutorial: boolean): VerifiedGame => ({
  id: 4,
  title: 'Сейф',
  minigameId: 'safe-crack',
  isTutorial,
});

describe('verifyVerdict', () => {
  it('обычная операция запускается', () => {
    const res: QrVerifyResponse = { ok: true, game: game(false) };
    expect(verifyVerdict(res)).toEqual({ kind: 'start', game: game(false) });
  });

  // Коробочный код после онбординга: сервер его подтверждает, но у системной
  // игры нет бандла (entryUrl: null) — запуск дал бы «Сбой запуска».
  it('код обучалки отбивается флешем, а не запускается', () => {
    const res: QrVerifyResponse = { ok: true, game: game(true) };
    expect(verifyVerdict(res)).toEqual({ kind: 'flash', text: TUTORIAL_DONE_TEXT });
  });

  it('закрытая операция показывает, чего не хватает', () => {
    const res: QrVerifyResponse = { ok: false, reason: 'locked', requiredTitles: ['Кухня'] };
    expect(verifyVerdict(res)).toEqual({ kind: 'locked', titles: ['Кухня'] });
  });

  it('чужой или неизвестный код — флеш «код не опознан»', () => {
    expect(verifyVerdict({ ok: false, reason: 'not-found' })).toEqual({
      kind: 'flash',
      text: TEXTS.scanFailText,
    });
    expect(verifyVerdict({ ok: false, reason: 'bad-signature' })).toEqual({
      kind: 'flash',
      text: TEXTS.scanFailText,
    });
  });
});

describe('scanErrorText', () => {
  const live: CameraState = { status: 'live', stream: null as unknown as MediaStream };

  it('живая камера без сбоев — панели нет', () => {
    expect(scanErrorText(live, null)).toBeNull();
    expect(scanErrorText({ status: 'off' }, null)).toBeNull();
  });

  it('отказ в доступе показывает, что делать игроку', () => {
    expect(scanErrorText({ status: 'error', error: 'NotAllowedError' }, null)).toBe(
      TEXTS.deniedText,
    );
    expect(scanErrorText({ status: 'error', error: 'NotReadableError' }, null)).toBe(
      TEXTS.busyCameraText,
    );
  });

  // Стрим пропал посреди скана (камеру выдернули): панель, а не замерший кадр.
  it('потерянный стрим — та же панель', () => {
    expect(scanErrorText({ status: 'error', error: 'SignalLost' }, null)).toBe(TEXTS.noCameraText);
  });

  it('ошибка самого сканера доезжает до панели', () => {
    expect(scanErrorText(live, TEXTS.noCameraText)).toBe(TEXTS.noCameraText);
  });
});
