-- Финал смены: игра, которую запускают не по QR из ростера, а кнопкой
-- «Закрыть смену» с победного экрана, когда остальные игры пройдены.
-- Флаг ровно один на всю смену, как is_tutorial.
ALTER TABLE games ADD COLUMN is_finale INTEGER NOT NULL DEFAULT 0;
