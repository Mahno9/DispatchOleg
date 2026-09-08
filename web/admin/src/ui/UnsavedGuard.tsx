import { useState } from 'react';

// ---------------------------------------------------------------------------
// Защита от потери несохранённых правок при закрытии/переключении редактора.
// Одна реализация на все секции: раньше вопрос был только в диалогах, а игры,
// персонажи, мета и конфиг мини-игры молча выбрасывали черновик.
// ---------------------------------------------------------------------------

/**
 * `run(action)` выполняет действие сразу, если правок нет, и откладывает его до
 * ответа на вопрос, если есть. Пара к `UnsavedChangesModal`.
 */
export function useUnsavedGuard(dirty: boolean) {
  const [pending, setPending] = useState<{ action: () => void } | null>(null);

  return {
    /** Показывать окно вопроса. */
    asking: pending !== null,
    /** Закрыть или переключить редактор с оглядкой на правки. */
    run(action: () => void) {
      if (dirty) setPending({ action });
      else action();
    },
    /** «Продолжить» — отложенное действие выполняется. */
    proceed() {
      const p = pending;
      setPending(null);
      p?.action();
    },
    /** «Отмена» — отложенное действие снимается. */
    dismiss() {
      setPending(null);
    },
  };
}

interface Props {
  /** Что редактируется — подставляется в вопрос: «В «...» есть правки». */
  subject: string;
  saving?: boolean;
  onSaveAndClose: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesModal({
  subject,
  saving,
  onSaveAndClose,
  onDiscard,
  onCancel,
}: Props) {
  return (
    <div className='modal-overlay' onClick={onCancel}>
      <div className='modal-card' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <span className='modal-title'>Несохранённые изменения</span>
        </div>
        <div className='modal-body'>
          <p>В «{subject}» есть несохранённые правки. Сохранить их перед закрытием?</p>
        </div>
        <div className='modal-actions'>
          <div className='modal-actions-spacer' />
          <button className='modal-save-primary' disabled={saving} onClick={onSaveAndClose}>
            Сохранить и закрыть
          </button>
          <button className='poi-delete-btn' onClick={onDiscard}>
            Закрыть без сохранения
          </button>
          <button onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
