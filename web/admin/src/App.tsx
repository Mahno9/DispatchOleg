import { useEffect, useState } from 'react';
import { api } from './api';
import { LoginScreen } from './auth/LoginScreen';
import { GamesSection } from './sections/GamesSection';
import { CharactersSection } from './sections/CharactersSection';
import { MetaSection } from './sections/MetaSection';
import { DialoguesSection } from './sections/DialoguesSection';
import { PlayersSection } from './sections/PlayersSection';
import { MinigamesSection } from './sections/MinigamesSection';
import { AssetsSection } from './sections/AssetsSection';
import { SettingsSection } from './sections/SettingsSection';
import { ToastHost } from './toast';

type Section =
  | 'games'
  | 'characters'
  | 'meta'
  | 'dialogues'
  | 'players'
  | 'minigames'
  | 'assets'
  | 'settings';

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'games', title: 'Игры' },
  { id: 'characters', title: 'Персонажи' },
  { id: 'meta', title: 'Мета' },
  { id: 'dialogues', title: 'Диалоги' },
  { id: 'players', title: 'Игроки' },
  { id: 'minigames', title: 'Мини-игры' },
  { id: 'assets', title: 'Ассеты' },
  { id: 'settings', title: 'Настройки' },
];

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>('games');

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <>
      <div className='layout'>
        <nav className='sidebar'>
          <h2>CALL OF DOODY // ADMIN</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={section === s.id ? 'active' : ''}
              onClick={() => setSection(s.id)}
            >
              {s.title}
            </button>
          ))}
          <div className='sidebar-spacer' />
          <button
            onClick={() => {
              api.logout().then(() => setAuthed(false));
            }}
          >
            Выйти
          </button>
        </nav>
        <main className='content'>
          {section === 'games' && <GamesSection />}
          {section === 'characters' && <CharactersSection />}
          {section === 'meta' && <MetaSection />}
          {section === 'dialogues' && <DialoguesSection />}
          {section === 'players' && <PlayersSection />}
          {section === 'minigames' && <MinigamesSection />}
          {section === 'assets' && <AssetsSection />}
          {section === 'settings' && <SettingsSection />}
        </main>
      </div>
      <ToastHost />
    </>
  );
}
