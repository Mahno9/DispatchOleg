-- Сводка о персонаже: показывается игроку по наведению на портрет, правится в админке.
ALTER TABLE characters ADD COLUMN description TEXT NOT NULL DEFAULT '';
