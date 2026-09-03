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

  const silent = prefs.muted || (prefs.musicVolume === 0 && prefs.sfxVolume === 0);

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

      {open && (
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
            label="Музыка"
            value={prefs.musicVolume}
            disabled={prefs.muted}
            onChange={(musicVolume) => localState.setAudioPrefs({ musicVolume })}
          />
          <Slider
            label="Эффекты"
            value={prefs.sfxVolume}
            disabled={prefs.muted}
            onChange={(sfxVolume) => localState.setAudioPrefs({ sfxVolume })}
          />
        </div>
      )}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, disabled, onChange }: SliderProps) {
  return (
    <label className={`audio-row ${disabled ? 'audio-row-off' : ''}`}>
      <span className="audio-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="audio-val">{value}</span>
    </label>
  );
}
