import { useEffect, useState } from 'react';
import { api, type AdminUser, type Game } from '../api';
import { showToast } from '../toast';

function formatDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString('ru-RU');
}

export function PlayersSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return api
      .getUsers()
      .then(setUsers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }

  useEffect(() => {
    void reload();
    api.getGames().then(setGames).catch(() => undefined);
  }, []);

  async function resetGame(user: AdminUser, gameId: number) {
    if (!window.confirm(`Сбросить прогресс игры #${gameId} у «${user.name}»?`)) return;
    try {
      await api.resetUserGame(user.id, gameId);
      await reload();
      showToast('Прогресс сброшен');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка сброса', 'error');
    }
  }

  async function removeUser(user: AdminUser) {
    if (!window.confirm(`Удалить игрока «${user.name}» вместе с прогрессом?`)) return;
    try {
      await api.deleteUser(user.id);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка удаления', 'error');
    }
  }

  return (
    <div className='lb-section'>
      <h3 className='lb-block-title'>Игроки</h3>
      {error && <p className='sf-asset-error'>{error}</p>}

      <table className='lb-table'>
        <thead>
          <tr>
            <th>Имя</th>
            <th>Обучен</th>
            <th>Пройдено</th>
            <th>Регистрация</th>
            <th>Последний sync</th>
            <th className='lb-actions'>Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const results = Object.entries(u.gameResults);
            const won = results.filter(([, r]) => r.won).length;
            return [
              <tr key={u.id} className='lb-row lb-row--clickable'>
                <td onClick={() => setOpenId(openId === u.id ? null : u.id)}>
                  {openId === u.id ? '▾ ' : '▸ '}
                  {u.name}
                </td>
                <td>{u.onboarded ? 'да' : 'нет'}</td>
                <td>
                  {won} / {results.length}
                </td>
                <td>{formatDate(u.createdAt)}</td>
                <td>{formatDate(u.syncedAt)}</td>
                <td className='lb-actions'>
                  <button className='poi-delete-btn' onClick={() => void removeUser(u)}>
                    Удалить
                  </button>
                </td>
              </tr>,
              openId === u.id ? (
                <tr key={`${u.id}-progress`} className='lb-row'>
                  <td colSpan={6}>
                    {results.length === 0 ? (
                      <span className='minigames-empty'>Прогресса нет.</span>
                    ) : (
                      <div className='pl-progress'>
                        {results.map(([gameId, r]) => (
                          <div className='pl-progress-row' key={gameId}>
                            <span className='pl-progress-name'>
                              {games.find((g) => String(g.id) === gameId)?.title ?? `игра #${gameId}`}
                            </span>
                            <span className='minigames-row-game'>
                              {r.won ? 'пройдена' : 'не пройдена'} · счёт {r.bestScore} · попыток{' '}
                              {r.attempts}
                              {r.details ? ` · ${JSON.stringify(r.details)}` : ''}
                            </span>
                            <button onClick={() => void resetGame(u, Number(gameId))}>Сброс</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {users.length === 0 && !error && <p className='lb-empty'>Игроков пока нет.</p>}
    </div>
  );
}
