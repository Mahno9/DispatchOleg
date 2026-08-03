// TODO: настройки платформы. Сейчас в БД только два ключа (repos/settings.ts):
// ui_click_sound_url — редактируется во вкладке «Ассеты», sync_interval_s — правится в БД.
// Когда ключей станет больше — форма на SchemaForm по списку SETTING_KEYS.

export function SettingsSection() {
  return (
    <div className='lb-section'>
      <h3 className='lb-block-title'>Настройки</h3>
      <p className='minigames-empty'>
        Заглушка. Звук нажатия кнопок настраивается во вкладке «Ассеты», интервал синхронизации —
        пока только в БД (settings.sync_interval_s).
      </p>
    </div>
  );
}
