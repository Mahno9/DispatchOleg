/**
 * Подтверждение выхода из мини-игры. Кнопка «Выйти» стоит вплотную к игровому
 * полю, а один её клик уничтожает игру: попытка не засчитывается, прогресс
 * раунда пропадает молча. Разметка — та же, что у отказов сканера
 * (`scan-refusal`), чтобы панель читалась как остальные панели терминала.
 */
export function ExitConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="scan-refusal">
      <div className="panel">
        <h2 className="error-line">Прервать операцию?</h2>
        <p className="label">Попытка не засчитается, всё сделанное в раунде пропадёт.</p>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          ПРЕРВАТЬ
        </button>
        <button type="button" className="btn btn-amber" onClick={onCancel}>
          ПРОДОЛЖИТЬ
        </button>
      </div>
    </div>
  );
}
