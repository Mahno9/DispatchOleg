import { useEffect, useRef, useState } from 'react';
import type { Game } from '../api';
import './SandboxLauncher.css';

interface SandboxLauncherProps {
  games: Game[];
  onSelect: (game: Game) => void;
}

export function SandboxLauncher({ games, onSelect }: SandboxLauncherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="sandbox-launcher" ref={rootRef}>
      <button
        type="button"
        className="btn btn-key"
        aria-expanded={open}
        aria-controls="sandbox-games"
        onClick={() => setOpen((value) => !value)}
      >
        START
      </button>
      {open && <SandboxGameList games={games} onSelect={onSelect} />}
    </div>
  );
}

export function SandboxGameList({ games, onSelect }: SandboxLauncherProps) {
  return (
    <div id="sandbox-games" className="sandbox-games" role="group" aria-label="Мини-игры">
      {games.map((game) => (
        <button
          key={game.id}
          type="button"
          className="btn sandbox-game"
          onClick={() => onSelect(game)}
        >
          {game.title}
        </button>
      ))}
    </div>
  );
}
