import type { Database } from 'better-sqlite3';

/**
 * Одна точка использования ассета — админка показывает их перед удалением.
 * Та же форма, что у DialogueUsage, только id настройки — строковый ключ.
 */
export interface AssetUsage {
  kind: 'game' | 'character' | 'dialogue' | 'metaStage' | 'setting';
  id: number | string;
  title: string;
  /** Человекочитаемое место ссылки: «портрет», «конфиг: sounds.move[0].url». */
  field: string;
}

function parse<T>(json: unknown, fallback: T): T {
  try {
    return JSON.parse(String(json)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Пути внутри разобранного JSON, где строка равна url. Обход тот же, что в
 * scripts/check-content.mjs (walk по config_json), только с запоминанием пути:
 * ссылка на ассет может лежать на любой глубине и внутри массивов — например
 * взвешенные звуки вида [{ url, weight }].
 */
function findPaths(value: unknown, url: string, at: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value === url) out.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findPaths(v, url, `${at}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findPaths(v, url, at ? `${at}.${k}` : k, out);
  }
}

/** Подписи полей персонажа; остальные колонки показываем как есть. */
const CHARACTER_FIELDS: Record<string, string> = { portrait_asset: 'портрет' };

/**
 * Кто ссылается на ассет по его url (`/assets-store/<id>.<ext>`). Места те же,
 * что обходит check-content, плюс те, до которых он не доходит: узлы диалогов,
 * мета-этапы и настройки (meta_music_url, ui_click_sound_url).
 */
export function assetUsage(db: Database, url: string): AssetUsage[] {
  const usage: AssetUsage[] = [];
  const push = (
    kind: AssetUsage['kind'],
    id: number | string,
    title: string,
    label: string,
    value: unknown,
  ) => {
    const paths: string[] = [];
    findPaths(value, url, '', paths);
    for (const p of paths) usage.push({ kind, id, title, field: p ? `${label}: ${p}` : label });
  };

  for (const g of db.prepare('SELECT id, title, config_json FROM games ORDER BY id').all() as {
    id: number;
    title: string;
    config_json: string;
  }[]) {
    push('game', g.id, g.title, 'конфиг', parse<unknown>(g.config_json, {}));
  }

  // Все текстовые колонки персонажа, а не только портрет: ассет может быть
  // прописан в любом строковом поле.
  for (const c of db.prepare('SELECT * FROM characters ORDER BY id').all() as Record<
    string,
    unknown
  >[]) {
    for (const [col, value] of Object.entries(c)) {
      if (value !== url) continue;
      usage.push({
        kind: 'character',
        id: c.id as number,
        title: String(c.name),
        field: CHARACTER_FIELDS[col] ?? col,
      });
    }
  }

  for (const d of db.prepare('SELECT id, title, nodes_json FROM dialogues ORDER BY id').all() as {
    id: number;
    title: string;
    nodes_json: string;
  }[]) {
    push('dialogue', d.id, d.title, 'узлы', parse<unknown>(d.nodes_json, {}));
  }

  for (const s of db.prepare('SELECT * FROM meta_stages ORDER BY id').all() as {
    id: number;
    title: string;
    background_json: string;
    characters_json: string;
    trigger_json: string;
  }[]) {
    push('metaStage', s.id, s.title, 'фон', parse<unknown>(s.background_json, {}));
    push('metaStage', s.id, s.title, 'персонажи', parse<unknown>(s.characters_json, []));
    push('metaStage', s.id, s.title, 'триггер', parse<unknown>(s.trigger_json, {}));
  }

  for (const s of db.prepare('SELECT key, value_json FROM settings ORDER BY key').all() as {
    key: string;
    value_json: string;
  }[]) {
    push('setting', s.key, s.key, 'значение', parse<unknown>(s.value_json, null));
  }

  return usage;
}
