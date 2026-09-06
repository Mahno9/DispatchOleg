import { useEffect, useRef, useState } from 'react';
import { localState, type AudioPrefs } from '../state/localState';

interface AudioSettingsProps {
  prefs: AudioPrefs;
}

/**
 * Общий для всей игры регулятор звука. Живёт в терминальной панели, а не
 * внутри мини-игры: настройка одна на игрока, а игровая зона целиком отдана
 * бандлу (docs/platform.md §2.5), класть туда чужой виджет нельзя.
 *
 * Свёрнутый вид — одна кнопка-динамик, поэтому в шапке он занимает не больше
 * места, чем индикатор сети рядом.
 */
export function AudioSettings({ prefs }: AudioSettingsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const voiceOff = prefs.voiceMuted || prefs.voiceVolume === 0;
  const silent =
    prefs.muted || (prefs.musicVolume === 0 && prefs.sfxVolume === 0 && voiceOff);

  return (
    <div className="audio" ref={rootRef}>
      <button
        type="button"
        className={`audio-btn ${silent ? 'audio-btn-off' : ''}`}
        aria-expanded={open}
        aria-label={silent ? 'Звук выключен — открыть настройки' : 'Звук — открыть настройки'}
        onClick={() => setOpen((v) => !v)}
      >
        {silent ? '🔇' : '🔊'}
      </button>

      {open && <AudioPanel prefs={prefs} />}
    </div>
  );
}

/**
 * Содержимое раскрытой панели. Отдельным компонентом, потому что vitest в
 * плеере рендерит разметку через SSR: у свёрнутой `AudioSettings` панели в
 * выводе нет вовсе, и проверять в ней было бы нечего.
 */
export function AudioPanel({ prefs }: AudioSettingsProps) {
  return (
    <div className="audio-panel" role="group" aria-label="Настройки звука">
      <button
        type="button"
        className={`audio-toggle ${prefs.muted ? 'audio-toggle-off' : ''}`}
        aria-pressed={!prefs.muted}
        onClick={() => localState.setAudioPrefs({ muted: !prefs.muted })}
      >
        {prefs.muted ? 'Звук выключен' : 'Звук включён'}
      </button>

      <Slider
        id="audio-music"
        label="Музыка"
        value={prefs.musicVolume}
        disabled={prefs.muted}
        onChange={(musicVolume) => localState.setAudioPrefs({ musicVolume })}
      />
      <Slider
        id="audio-sfx"
        label="Эффекты"
        value={prefs.sfxVolume}
        disabled={prefs.muted}
        onChange={(sfxVolume) => localState.setAudioPrefs({ sfxVolume })}
      />
      {/* Голос — свой канал: ползунок независим от «Эффектов», а мьют рядом
          гасит только бубнёж, оставляя музыку и эффекты играть. */}
      <Slider
        id="audio-voice"
        label="Голос"
        value={prefs.voiceVolume}
        disabled={prefs.muted || prefs.voiceMuted}
        onChange={(voiceVolume) => localState.setAudioPrefs({ voiceVolume })}
        mute={{
          on: prefs.voiceMuted,
          label: prefs.voiceMuted ? 'Включить голос' : 'Выключить голос',
          onToggle: () => localState.setAudioPrefs({ voiceMuted: !prefs.voiceMuted }),
        }}
      />
    </div>
  );
}

interface SliderProps {
  /** id ползунка: строка — уже не <label>, подпись связана через htmlFor. */
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  /** Свой мьют канала (пока только у голоса). Без него ячейка кнопки пустая. */
  mute?: { on: boolean; label: string; onToggle: () => void };
}

/**
 * Строка регулятора. Именно `div`, а не `label`: кнопка мьюта внутри `label`
 * ловила бы ещё и клик по подписи и переключалась бы дважды.
 */
function Slider({ id, label, value, disabled, onChange, mute }: SliderProps) {
  return (
    <div className={`audio-row ${disabled ? 'audio-row-off' : ''}`}>
      <label className="audio-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="audio-val">{value}</span>
      {mute ? (
        <button
          type="button"
          className={`audio-mute ${mute.on ? 'audio-mute-off' : ''}`}
          aria-pressed={mute.on}
          aria-label={mute.label}
          title={mute.label}
          onClick={mute.onToggle}
        >
          {mute.on ? '🔇' : '🔉'}
        </button>
      ) : null}
    </div>
  );
}
