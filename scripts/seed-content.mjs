// Test content: аватарки-силуэты, персонажи, диалоги, игры, этапы меты.
//
//   node scripts/seed-content.mjs            # засеять (перезатирает прошлый посев)
//   node scripts/seed-content.mjs --clean    # только снести прошлый посев
//
// Повторный запуск сначала удаляет строки, вставленные прошлым запуском (их id
// лежат в settings.seed_content), поэтому дублей не будет, а руками заведённый
// контент — включая обучалку — не трогается.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const assetsDir = path.join(dataDir, 'assets');
const avatarsDir = path.join(root, 'content', 'avatars');
const dbFile = path.join(dataDir, 'app.sqlite');

if (!fs.existsSync(dbFile)) {
  console.error(`нет БД: ${dbFile} — сначала запустите сервер, он применит миграции`);
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Уборка прошлого посева
// ---------------------------------------------------------------------------

const SEED_KEY = 'seed_content';

function loadPrevious() {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(SEED_KEY);
  try {
    return row ? JSON.parse(row.value_json) : null;
  } catch {
    return null;
  }
}

function clean() {
  const prev = loadPrevious();
  if (!prev) return;
  // Порядок важен: games ссылаются на dialogues/characters, meta_stages — на characters.
  const del = (table, ids) => {
    const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of ids ?? []) stmt.run(id);
  };
  del('games', prev.games);
  del('meta_stages', prev.metaStages);
  del('characters', prev.characters);
  del('dialogues', prev.dialogues);
  for (const id of prev.assets ?? []) {
    const row = db.prepare('SELECT ext FROM assets WHERE id = ?').get(id);
    db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    if (row) fs.rmSync(path.join(assetsDir, `${id}.${row.ext}`), { force: true });
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(SEED_KEY);
  console.log('снесён прошлый посев');
}

if (process.argv.includes('--clean')) {
  db.transaction(clean)();
  console.log('готово');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Ассеты — SVG-силуэты из content/avatars/
// ---------------------------------------------------------------------------

/** Файл аватарки → URL, под которым его отдаёт сервер. Заполняется при посеве. */
const A = {};
const seeded = { assets: [], characters: [], dialogues: [], games: [], metaStages: [] };

function seedAssets() {
  fs.mkdirSync(assetsDir, { recursive: true });
  const insert = db.prepare(
    `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
     VALUES (?, 'image', 'image/svg+xml', 'svg', ?, ?, ?)`,
  );
  for (const file of fs.readdirSync(avatarsDir).filter((f) => f.endsWith('.svg'))) {
    const name = path.basename(file, '.svg');
    const id = `seed-${name}`;
    const svg = fs.readFileSync(path.join(avatarsDir, file));
    fs.writeFileSync(path.join(assetsDir, `${id}.svg`), svg);
    insert.run(id, file, svg.length, Date.now());
    seeded.assets.push(id);
    A[name] = `/assets-store/${id}.svg`;
  }
  console.log(`ассетов: ${seeded.assets.length}`);
}

// ---------------------------------------------------------------------------
// 2. Персонажи
// ---------------------------------------------------------------------------

const CHARACTERS = [
  { key: 'marina', name: 'Марина Соболь', avatar: 'civ-dispatcher', side: 'left' },
  { key: 'timur', name: 'Тимур Асланов', avatar: 'civ-cadet', side: 'left' },
  { key: 'vera', name: 'Вера Дробыш', avatar: 'civ-medic', side: 'left' },
  { key: 'kostya', name: 'Костя Гриб', avatar: 'civ-mechanic', side: 'left' },
  { key: 'lida', name: 'Лида Мороз', avatar: 'civ-cook', side: 'right' },
  { key: 'zinaida', name: 'Зинаида Петровна', avatar: 'civ-granny', side: 'right' },
  { key: 'vector', name: 'Вектор', avatar: 'hero-vector', side: 'right' },
  { key: 'pyrolina', name: 'Пиролина', avatar: 'hero-pyrolina', side: 'right' },
  { key: 'phantom', name: 'Фантом', avatar: 'hero-phantom', side: 'right' },
  { key: 'impulse', name: 'Импульс', avatar: 'hero-impulse', side: 'right' },
  { key: 'granit', name: 'Гранит', avatar: 'hero-granit', side: 'right' },
  { key: 'k9', name: 'К-9', avatar: 'hero-k9', side: 'left' },
  { key: 'nochnitsa', name: 'Ночница', avatar: 'hero-nochnitsa', side: 'right' },
];

/** ключ персонажа → id в БД (строкой — в диалогах speaker всегда строка) */
const C = {};

function seedCharacters() {
  const insert = db.prepare(
    'INSERT INTO characters (name, portrait_asset, meta_position) VALUES (?, ?, ?)',
  );
  for (const ch of CHARACTERS) {
    const id = Number(insert.run(ch.name, A[ch.avatar] ?? null, ch.side).lastInsertRowid);
    C[ch.key] = String(id);
    seeded.characters.push(id);
  }
  console.log(`персонажей: ${seeded.characters.length}`);
}

// ---------------------------------------------------------------------------
// 3. Диалоги
// ---------------------------------------------------------------------------

/** Линейная цепочка реплик: [кто, текст]. Олег слева, собеседник справа. */
function linear(lines) {
  const nodes = {};
  lines.forEach(([speaker, text], i) => {
    nodes[`n${i + 1}`] = {
      speaker,
      side: speaker === 'oleg' ? 'left' : 'right',
      text,
      next: i + 1 < lines.length ? `n${i + 2}` : null,
      choices: [],
    };
  });
  return { start: 'n1', nodes };
}

/** Явный узел для ветвящихся диалогов. */
function node(speaker, text, opts = {}) {
  return {
    speaker,
    side: speaker === 'oleg' ? 'left' : 'right',
    text,
    next: opts.next ?? null,
    choices: opts.choices ?? [],
  };
}

function buildDialogues() {
  const O = 'oleg';
  return {
    // ---- мета: болтовня по клику на персонажа ----------------------------
    'meta-marina': {
      title: 'Мета · Марина',
      nodes: {
        start: 'n1',
        nodes: {
          n1: node(
            C.marina,
            'Олег, я тебе оставила кофе. Он остыл ещё до того, как ты пришёл, но жест засчитан.',
            {
              choices: [
                { text: 'Спасибо. Как смена?', next: 'n2' },
                { text: 'Что по сводке?', next: 'n3' },
              ],
            },
          ),
          n2: node(C.marina, 'Тихо. Настолько тихо, что я начала нервничать.', { next: 'n4' }),
          n3: node(C.marina, 'Три вызова закрыты, два висят. Висят — это к тебе.', {
            next: 'n4',
          }),
          n4: node(O, 'Понял. Иди спать, Марина.'),
        },
      },
    },
    'meta-timur': {
      title: 'Мета · Тимур',
      nodes: linear([
        [C.timur, 'Олег Николаевич, а правда, что вы однажды посадили вертолёт по рации?'],
        [O, 'Правда. Только это был не вертолёт и не по рации.'],
        [C.timur, 'То есть неправда.'],
        [O, 'То есть учись разбирать входящие. Стопка сама себя не разложит.'],
      ]),
    },
    'meta-vera': {
      title: 'Мета · Вера',
      nodes: linear([
        [C.vera, 'Пять выездов за ночь. Из них четыре — «а можно просто поговорить».'],
        [O, 'Это тоже выезд.'],
        [C.vera, 'Это тоже выезд. Просто бинты не расходуются.'],
      ]),
    },
    'meta-kostya': {
      title: 'Мета · Костя',
      nodes: linear([
        [C.kostya, 'Твой пульт я не чинил. Я его уговорил.'],
        [O, 'И что он сказал?'],
        [
          C.kostya,
          'Что третья кнопка залипает, потому что ты по ней бьёшь. Не бей по третьей кнопке.',
        ],
      ]),
    },
    'meta-lida': {
      title: 'Мета · Лида',
      nodes: {
        start: 'n1',
        nodes: {
          n1: node(C.lida, 'Герои жрут больше, чем спасают. Это статистика, а не жалоба.', {
            choices: [
              { text: 'Кто хуже всех?', next: 'n2' },
              { text: 'А кто вежливый?', next: 'n3' },
            ],
          }),
          n2: node(C.lida, 'Гранит. Он не жуёт, он утилизирует.', { next: 'n4' }),
          n3: node(C.lida, 'К-9. Приносит миску обратно. Пустую, вымытую и на место.', {
            next: 'n4',
          }),
          n4: node(O, 'Запишу в сводку.'),
        },
      },
    },
    'meta-zinaida': {
      title: 'Мета · Зинаида Петровна',
      nodes: linear([
        [C.zinaida, 'Милок, кот опять на тополе.'],
        [O, 'Зинаида Петровна, кот на тополе четвёртый раз за неделю.'],
        [C.zinaida, 'Так и я звоню четвёртый раз за неделю. Система работает.'],
      ]),
    },
    'meta-vector': {
      title: 'Мета · Вектор',
      nodes: linear([
        [C.vector, 'Я был на месте за девять секунд.'],
        [O, 'Вызов пришёл двенадцать секунд назад.'],
        [C.vector, 'Знаю. Три секунды я ждал, пока ты дочитаешь адрес.'],
      ]),
    },
    'meta-pyrolina': {
      title: 'Мета · Пиролина',
      nodes: linear([
        [C.pyrolina, 'От меня пахнет гарью, не извиняйся заранее.'],
        [O, 'Я и не собирался.'],
        [C.pyrolina, 'Вот за это ты мне и нравишься, диспетчер.'],
      ]),
    },
    'meta-phantom': {
      title: 'Мета · Фантом',
      nodes: linear([
        [C.phantom, '…'],
        [O, 'Фантом, я вижу твою метку на схеме. Ты стоишь у меня за спиной.'],
        [C.phantom, 'Проверял, заметишь ли.'],
        [O, 'Заметил. Не делай так больше.'],
      ]),
    },
    'meta-granit': {
      title: 'Мета · Гранит',
      nodes: linear([
        [C.granit, 'Стена держит.'],
        [O, 'Какая стена?'],
        [C.granit, 'Любая, к которой я прислонился.'],
      ]),
    },
    'meta-k9': {
      title: 'Мета · К-9',
      nodes: linear([
        [C.k9, 'ЗАПРОС: ПОГЛАДИТЬ. ПРИОРИТЕТ НИЗКИЙ. ОЖИДАНИЕ.'],
        [O, 'Удовлетворён.'],
        [C.k9, 'ЖУРНАЛ ОБНОВЛЁН. СМЕНА ОЦЕНЕНА КАК ХОРОШАЯ.'],
      ]),
    },
    'meta-nochnitsa': {
      title: 'Мета · Ночница',
      nodes: linear([
        [C.nochnitsa, 'Ты сидишь спиной к окну. Это привычка или доверие?'],
        [O, 'Это восьмой этаж.'],
        [C.nochnitsa, 'Я тоже так думала. Пока не начала заходить через окна.'],
      ]),
    },

    // ---- игра 1: разбор смены (task-sort) --------------------------------
    'pre-shift': {
      title: 'Разбор смены · до',
      nodes: {
        start: 'n1',
        nodes: {
          n1: node(C.marina, 'Олег, я досиживаю последний час, и входящие не разобраны.', {
            next: 'n2',
          }),
          n2: node(O, 'Насколько не разобраны?', {
            choices: [
              { text: 'Насколько не разобраны?', next: 'n3' },
              { text: 'Оставь, я сам.', next: 'n4' },
            ],
          }),
          n3: node(
            C.marina,
            'Кот на тополе лежит в одной стопке с кайдзю на мосту. Оба помечены «срочно».',
            { next: 'n4' },
          ),
          n4: node(C.marina, 'И половина задач подписана мной, хотя делать их тебе.', {
            next: 'n5',
          }),
          n5: node(O, 'Понял. Разложу по приоритетам и исполнителям.'),
        },
      },
    },
    'win-shift': {
      title: 'Разбор смены · победа',
      nodes: linear([
        [C.marina, 'Стопка разобрана. Я даже не буду делать вид, что не удивлена.'],
        [O, 'Кайдзю наверху, кот внизу. Как и должно быть.'],
        [C.marina, 'Ухожу с чистой совестью. Смена твоя.'],
      ]),
    },
    'style-shift-flawless': {
      title: 'Разбор смены · без единой ошибки',
      nodes: linear([
        [C.marina, 'Ни одной ошибки. Олег, ты меня пугаешь.'],
        [O, 'Я просто читал текст задач, а не первые три слова.'],
        [C.marina, 'Я передам это Тимуру дословно.'],
      ]),
    },
    'lose-shift': {
      title: 'Разбор смены · провал',
      nodes: linear([
        [C.marina, 'Ты отправил Тимура на кайдзю, а кота поставил первым приоритетом.'],
        [O, 'Кот тоже живой.'],
        [C.marina, 'Кот переживёт мост. Мост кота — нет. Разбирай заново.'],
      ]),
    },

    // ---- игра 2: мост (rescue-catch) -------------------------------------
    'pre-bridge': {
      title: 'Восточный мост · до',
      nodes: linear([
        [C.pyrolina, 'Восточный мост, опора три. Людей выносит через окна, лестницы не достают.'],
        [O, 'Батут развёрнут. Я на кольце, веду точку ловли.'],
        [C.pyrolina, 'Не промахнись, диспетчер. Внизу асфальт, а не сюжет.'],
      ]),
    },
    'win-bridge': {
      title: 'Восточный мост · победа',
      nodes: linear([
        [C.pyrolina, 'Все внизу. Все дышат.'],
        [O, 'Двенадцать из двенадцати.'],
        [C.pyrolina, 'Мост всё равно сложится к утру. Но уже пустой.'],
      ]),
    },
    'lose-bridge': {
      title: 'Восточный мост · провал',
      nodes: linear([
        [C.vera, 'Три носилки. Двое стабильны, третий — как повезёт.'],
        [O, 'Я не успел довести кольцо.'],
        [C.vera, 'Знаю. Я не обвиняю, я докладываю. Разница есть.'],
      ]),
    },

    // ---- игра 3: подземка (three-mazes) ----------------------------------
    'pre-metro': {
      title: 'Подземка · до',
      nodes: linear([
        [C.phantom, 'Три уровня подземки. Ниже второго связь пропадает.'],
        [O, 'Веду по схеме. В стены не входим.'],
        [C.phantom, 'Стены — вопрос вкуса.'],
        [O, 'Стены — вопрос сметы. Пошли.'],
      ]),
    },
    'style-metro-ghost': {
      title: 'Подземка · ни одной стены',
      nodes: linear([
        [C.phantom, 'Ни одной стены. Тебе бы в проводники.'],
        [O, 'Мне бы в отпуск.'],
        [C.phantom, 'Одно другому не мешает.'],
      ]),
    },
    'style-metro-breaker': {
      title: 'Подземка · с проломами',
      nodes: linear([
        [C.kostya, 'Олег. Мне звонили из метрополитена.'],
        [O, 'Мы вышли. Все живы.'],
        [C.kostya, 'Живы все, кроме двух перегородок. Счёт придёт на диспетчерскую.'],
      ]),
    },
    'lose-metro': {
      title: 'Подземка · провал',
      nodes: linear([
        [C.phantom, 'Я в тупике на третьем уровне. Связь рвётся.'],
        [O, 'Стой на месте, перестраиваю маршрут.'],
        [C.phantom, 'Стою. У меня всё равно нет вариантов.'],
      ]),
    },

    // ---- игра 4: сейф (safe-crack) ---------------------------------------
    'pre-safe': {
      title: 'Сейф ломбарда · до',
      nodes: linear([
        [C.impulse, 'Ломбард на Заводской. Сейф закрыт, владелец «забыл» код.'],
        [O, 'А улики внутри.'],
        [C.impulse, 'А улики внутри. Вскрывать по закону — это к тебе, я только держу дверь.'],
      ]),
    },
    'win-safe': {
      title: 'Сейф ломбарда · победа',
      nodes: linear([
        [C.impulse, 'Открыл. Опись веду.'],
        [O, 'Что там?'],
        [
          C.impulse,
          'Три плазменных резака кустарной сборки и фотография Ночницы в рамке. Второе тревожнее.',
        ],
      ]),
    },
    'lose-safe': {
      title: 'Сейф ломбарда · провал',
      nodes: linear([
        [C.impulse, 'Ригели встали намертво. Сейф считает нас злоумышленниками.'],
        [O, 'Формально он прав.'],
        [C.impulse, 'Формально нам нужен ордер и вторая попытка. Ордер у меня есть.'],
      ]),
    },

    // ---- игра 5: кухня (cooking-orders) ----------------------------------
    'pre-kitchen': {
      title: 'Кухня · до',
      nodes: {
        start: 'n1',
        nodes: {
          n1: node(C.lida, 'Олег, у меня очередь из героев и одна плита. Встань к котлу.', {
            choices: [
              { text: 'Я диспетчер, а не повар.', next: 'n2' },
              { text: 'Где половник?', next: 'n3' },
            ],
          }),
          n2: node(C.lida, 'А я повар, а не диспетчер. Но ночью мы все универсалы.', {
            next: 'n3',
          }),
          n3: node(C.lida, 'Дозы соблюдай. У К-9 допуск по граммам, он не из вредности.', {
            next: 'n4',
          }),
          n4: node(O, 'Принял. Три ошибки — и смена заново, я помню.'),
        },
      },
    },
    'win-kitchen': {
      title: 'Кухня · победа',
      nodes: linear([
        [C.lida, 'Очередь ушла сытая. Даже Гранит сказал два слова.'],
        [O, 'Какие?'],
        [C.lida, '«Стена держит». Я решила, что это комплимент супу.'],
      ]),
    },
    'lose-kitchen': {
      title: 'Кухня · провал',
      nodes: linear([
        [C.lida, 'Всё сгорело. Буквально всё, включая то, что не должно гореть.'],
        [O, 'Пиролина не поможет?'],
        [C.lida, 'Пиролина уже съела котёл. Начинаем смену заново.'],
      ]),
    },

    // ---- игра 6: обшивка (tetris-fill) -----------------------------------
    'pre-hull': {
      title: 'Пробоина · до',
      nodes: linear([
        [C.granit, 'Пробоина в стене отсека. Плиты подаю я.'],
        [O, 'Укладываю я. Поворачивать успею?'],
        [C.granit, 'Плита падает. Ты решаешь. Я не тороплю, тороплю не я.'],
      ]),
    },
    'win-hull': {
      title: 'Пробоина · победа',
      nodes: linear([
        [C.granit, 'Стена держит.'],
        [O, 'Ни одного зазора.'],
        [C.granit, 'Стена держит.'],
      ]),
    },
    'style-hull-precise': {
      title: 'Пробоина · без ошибок',
      nodes: linear([
        [C.k9, 'ЗАМЕР: ОТКЛОНЕНИЙ НЕ ОБНАРУЖЕНО. ШОВ ИДЕАЛЕН.'],
        [O, 'Спасибо, К-9.'],
        [C.k9, 'В ЖУРНАЛ ЗАНЕСЕНО. ЗАПРОС: ПОГЛАДИТЬ.'],
      ]),
    },
    'lose-hull': {
      title: 'Пробоина · провал',
      nodes: linear([
        [C.granit, 'Плиты кончились. Дыра осталась.'],
        [O, 'Заварим временно.'],
        [C.granit, 'Временно — это до первого ветра. Соберём заново.'],
      ]),
    },
  };
}

/** ключ диалога → id в БД */
const D = {};

function seedDialogues() {
  const insert = db.prepare('INSERT INTO dialogues (title, nodes_json) VALUES (?, ?)');
  for (const [key, dlg] of Object.entries(buildDialogues())) {
    const id = Number(insert.run(dlg.title, JSON.stringify(dlg.nodes)).lastInsertRowid);
    D[key] = id;
    seeded.dialogues.push(id);
  }
  console.log(`диалогов: ${seeded.dialogues.length}`);
}

/** Кому какая мета-болталка — проставляется после вставки диалогов. */
const META_DIALOGUES = {
  marina: 'meta-marina',
  timur: 'meta-timur',
  vera: 'meta-vera',
  kostya: 'meta-kostya',
  lida: 'meta-lida',
  zinaida: 'meta-zinaida',
  vector: 'meta-vector',
  pyrolina: 'meta-pyrolina',
  phantom: 'meta-phantom',
  granit: 'meta-granit',
  k9: 'meta-k9',
  nochnitsa: 'meta-nochnitsa',
};

function linkMetaDialogues() {
  const stmt = db.prepare('UPDATE characters SET meta_dialogue_id = ? WHERE id = ?');
  for (const [chKey, dlgKey] of Object.entries(META_DIALOGUES))
    stmt.run(D[dlgKey], Number(C[chKey]));
}

// ---------------------------------------------------------------------------
// 4. Игры
// ---------------------------------------------------------------------------

function buildGames() {
  return [
    {
      key: 'shift',
      title: 'Разбор ночной смены',
      minigameId: 'task-sort',
      character: 'marina',
      pre: 'pre-shift',
      win: 'win-shift',
      lose: 'lose-shift',
      style: { flawless: 'style-shift-flawless' },
      requires: [],
      config: {
        playerName: 'Олег',
        attempts: 2,
        winThresholdPercent: 100,
        tasks: [
          {
            text: 'Кайдзю-краб класса B перекрыл Восточный мост и рвёт клешнями несущие опоры — снять полосу движения и вести героя на перехват до обрушения пролёта.',
            assignee: 'Олег',
            done: false,
            priority: 1,
          },
          {
            text: 'Пожар на 14-м этаже дома по Ленина, 40: лифты заблокированы, на этаже люди — вести Пиролину на поглощение огня, лестницу держать свободной.',
            assignee: 'Олег',
            done: false,
            priority: 1,
          },
          {
            text: 'Обрушение перекрытия в старом депо: под плитой двое рабочих, слышен стук — нужен Гранит на подъём и Вера на приём пострадавших.',
            assignee: 'Олег',
            done: false,
            priority: 1,
          },
          {
            text: 'Утечка на Химпроме: облако сносит ветром на жилой сектор — герой в герметичном костюме плюс оповещение по трём кварталам.',
            assignee: 'Марина',
            done: false,
            priority: 1,
          },
          {
            text: 'Ограбление ломбарда на Заводской: у налётчика кустарная плазменная пушка, заложников нет — вести Импульса, витрина уже списана.',
            assignee: 'Олег',
            done: false,
            priority: 2,
          },
          {
            text: 'В фонтане на Центральной дымится объект, похожий на исследовательский зонд — оцепить, вызвать техгруппу, зевак не подпускать.',
            assignee: 'Марина',
            done: false,
            priority: 2,
          },
          {
            text: 'Робот-курьер сошёл с маршрута и третий раз таранит витрины на Пушкина — отключить дистанционно, при отказе канала — физически.',
            assignee: 'Тимур',
            done: false,
            priority: 3,
          },
          {
            text: 'Прорыв теплотрассы затапливает паркинг ТЦ «Орбита», кипяток дошёл до порогов машин — эвакуация транспорта и перекрытие ветки.',
            assignee: 'Олег',
            done: false,
            priority: 3,
          },
          {
            text: 'Свести график ночных патрулей на следующую неделю и согласовать подмену с Мариной до конца смены.',
            assignee: 'Тимур',
            done: false,
            priority: 3,
          },
          {
            text: 'Кот Зинаиды Петровны снова на тополе во дворе Садовой, 12 — она звонит четвёртый раз за неделю и обещает пирожки.',
            assignee: 'Тимур',
            done: false,
            priority: 4,
          },
          {
            text: 'Костюм Импульса не вернулся из химчистки — уточнить сроки по накладной, запасной комплект уже выдан со склада.',
            assignee: 'Тимур',
            done: false,
            priority: 4,
          },
          {
            text: 'Заявка от жильцов Тополиной, 7: голубь-мутант отобрал шаурму на остановке, пострадавший требует компенсацию и «чтобы по телевизору».',
            assignee: 'Марина',
            done: false,
            priority: 4,
          },
          {
            text: 'Заменить залипающую третью кнопку на пульте диспетчера — Костя просил не бить по ней до замены.',
            assignee: 'Марина',
            done: true,
            priority: 4,
          },
          {
            text: 'Передать в архив сводку за прошлую смену — подписана, отсканирована, лежит в лотке «исходящие».',
            assignee: 'Олег',
            done: true,
            priority: 4,
          },
        ],
      },
    },
    {
      key: 'bridge',
      title: 'Восточный мост',
      minigameId: 'rescue-catch',
      character: 'pyrolina',
      pre: 'pre-bridge',
      win: 'win-bridge',
      lose: 'lose-bridge',
      requires: ['shift'],
      config: {
        controlVariant: 'bidirectional',
        rescueTarget: 12,
        lives: 3,
        spawnIntervalStart: 2.6,
        spawnIntervalMin: 1,
        fallTime: 1.9,
        hangTime: 1.1,
        maxAirborne: 2,
        pointsPerCatch: 100,
        streakStep: 3,
        maxMultiplier: 4,
      },
    },
    {
      key: 'metro',
      title: 'Три уровня подземки',
      minigameId: 'three-mazes',
      character: 'phantom',
      pre: 'pre-metro',
      win: 'style-metro-ghost',
      lose: 'lose-metro',
      style: { ghost: 'style-metro-ghost', breaker: 'style-metro-breaker' },
      requires: ['bridge'],
      config: {
        screamerImage: A['hero-phantom'] ?? null,
        screamerDurationMs: 900,
        followSpeed: 560,
        bounceSpeed: 420,
        breakAngleDeg: 40,
        breakerThreshold: 1,
        mazes: [
          {
            generatorParams: { type: 'square', size: 7, breakableDensity: 0.2, seed: 2201 },
            walls: [],
            scale: 1,
            scorePerMaze: 100,
          },
          {
            generatorParams: { type: 'hex', size: 7, breakableDensity: 0.15, seed: 2202 },
            walls: [],
            scale: 1,
            scorePerMaze: 120,
          },
          {
            generatorParams: { type: 'circular', size: 5, breakableDensity: 0.1, seed: 2203 },
            walls: [],
            scale: 1,
            scorePerMaze: 160,
          },
        ],
      },
    },
    {
      key: 'safe',
      title: 'Сейф ломбарда на Заводской',
      minigameId: 'safe-crack',
      character: 'impulse',
      pre: 'pre-safe',
      win: 'win-safe',
      lose: 'lose-safe',
      requires: ['shift'],
      config: {
        title: 'ЛОМБАРД «ЗАВОДСКАЯ, 6»',
        timeLimitSeconds: 240,
        maxAttempts: 6,
        errorPenalty: 15,
        prizeImage: A['hero-nochnitsa'] ?? null,
        locks: [
          {
            question: 'Владелец записал слово-ключ на обороте квитанции. Наберите его.',
            widget: 'shuffle-keyboard',
            answer: 'залог',
            points: 50,
            params: { targetWord: 'залог', shuffleEveryKey: true },
          },
          {
            question: 'Номер дела о краже в порту',
            widget: 'mega-slider',
            answer: '4471',
            points: 80,
            params: { min: 0, max: 10000, driftAmount: 2, driftIntervalMs: 700 },
          },
          {
            question: 'Сколько дней сейф не открывали?',
            widget: 'number-as-words',
            answer: '365',
            points: 70,
            params: { slots: 3, maxNumber: 999 },
          },
          {
            question: 'Фамилия оценщика из журнала приёмки',
            widget: 'haystack-dropdown',
            answer: 'Дробыш',
            points: 60,
            params: {
              options: [
                'Абрамцев',
                'Гриб',
                'Дробыш',
                'Асланов',
                'Соболь',
                'Мороз',
                'Зверев',
                'Пилипенко',
                'Ковтун',
                'Растопчин',
              ],
            },
          },
          {
            question: 'Выставьте номер ячейки на счётчике',
            widget: 'plus-minus',
            answer: '42',
            points: 60,
            params: { startMin: 0, startMax: 100, swapEveryNClicks: 4 },
          },
          {
            question: 'Держите ригель, пока не сработает механизм',
            widget: 'hold-button',
            answer: '',
            points: 100,
            params: { targetSeconds: 6, toleranceMs: 350, gaugeLagMs: 500 },
          },
        ],
      },
    },
    {
      key: 'kitchen',
      title: 'Кухня для героев',
      minigameId: 'cooking-orders',
      character: 'lida',
      pre: 'pre-kitchen',
      win: 'win-kitchen',
      lose: 'lose-kitchen',
      requires: [],
      config: {
        fillRatePerSec: 1.4,
        doseTolerancePct: 40,
        cookTolerancePct: 12,
        failsAllowed: 3,
        pointsPerStep: 10,
        pointsPerOrder: 50,
        ingredients: [
          { id: 'stardust', name: 'Звёздная пыль', image: '', unitName: 'щепотка' },
          { id: 'honey', name: 'Мёд', image: '', unitName: 'ложка' },
          { id: 'hero-milk', name: 'Молоко героя', image: '', unitName: 'мерка' },
          { id: 'cinnamon', name: 'Корица', image: '', unitName: 'щепотка' },
          { id: 'dragon-coal', name: 'Уголёк дракона', image: '', unitName: 'уголёк' },
          { id: 'sugar', name: 'Сахар', image: '', unitName: 'ложка' },
          { id: 'moon-mint', name: 'Лунная мята', image: '', unitName: 'листок' },
          { id: 'iron-bolt', name: 'Железный болт', image: '', unitName: 'болт' },
          { id: 'ash', name: 'Остывшая зола', image: '', unitName: 'щепотка' },
          { id: 'machine-oil', name: 'Машинное масло', image: '', unitName: 'капля' },
        ],
        characters: [
          {
            name: 'Вера',
            portrait: A['civ-medic'] ?? '',
            orderName: 'Какао для ночного дежурства',
            cookSeconds: 6,
            steps: [
              { ingredientId: 'hero-milk', amount: 3 },
              { ingredientId: 'sugar', amount: 2 },
              { ingredientId: 'cinnamon', amount: 1 },
            ],
          },
          {
            name: 'Пиролина',
            portrait: A['hero-pyrolina'] ?? '',
            orderName: 'Уголь на второе',
            cookSeconds: 8,
            steps: [
              { ingredientId: 'dragon-coal', amount: 0 },
              { ingredientId: 'ash', amount: 2 },
              { ingredientId: 'honey', amount: 4 },
              { ingredientId: 'moon-mint', amount: 0 },
            ],
          },
          {
            name: 'К-9',
            portrait: A['hero-k9'] ?? '',
            orderName: 'Суп для робота-напарника',
            cookSeconds: 10,
            steps: [
              { ingredientId: 'iron-bolt', amount: 0 },
              { ingredientId: 'machine-oil', amount: 2 },
              { ingredientId: 'hero-milk', amount: 2 },
              { ingredientId: 'stardust', amount: 3 },
            ],
          },
          {
            name: 'Гранит',
            portrait: A['hero-granit'] ?? '',
            orderName: 'Порция без затей',
            cookSeconds: 12,
            steps: [
              { ingredientId: 'hero-milk', amount: 5 },
              { ingredientId: 'sugar', amount: 5 },
              { ingredientId: 'iron-bolt', amount: 0 },
            ],
          },
          {
            name: 'Ночница',
            portrait: A['hero-nochnitsa'] ?? '',
            orderName: 'Настой лунной мяты',
            cookSeconds: 7,
            steps: [
              { ingredientId: 'moon-mint', amount: 0 },
              { ingredientId: 'stardust', amount: 2 },
              { ingredientId: 'honey', amount: 1 },
              { ingredientId: 'cinnamon', amount: 2 },
            ],
          },
        ],
      },
    },
    {
      key: 'hull',
      title: 'Пробоина в отсеке',
      minigameId: 'tetris-fill',
      character: 'granit',
      pre: 'pre-hull',
      win: 'win-hull',
      lose: 'lose-hull',
      style: { precise: 'style-hull-precise' },
      requires: ['metro'],
      config: {
        shape: {
          width: 8,
          height: 6,
          rows: ['..####..', '.######.', '########', '########', '.######.', '..####..'],
        },
        scoreThresholds: [
          { maxSeconds: 45, points: 300 },
          { maxSeconds: 120, points: 150 },
          { maxSeconds: 300, points: 0 },
        ],
        errorPenalty: 5,
        hintAfterErrors: 3,
        randomizeRotation: true,
        fallIntervalMs: 750,
        softDropFactor: 6,
        lockDelayMs: 500,
        spawnColumn: 'center',
      },
    },
  ];
}

/** ключ игры → id в БД */
const G = {};

function seedGames() {
  const games = buildGames();
  const insert = db.prepare(
    `INSERT INTO games (title, minigame_id, config_json, character_id, pre_dialogue_id,
                        post_win_dialogue_id, post_lose_dialogue_id, style_dialogues_json,
                        required_game_ids_json, sort_order, is_tutorial)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 0)`,
  );
  // Два прохода: requiredGameIds ссылается на игры из этого же списка.
  games.forEach((g, i) => {
    const styleMap = Object.fromEntries(
      Object.entries(g.style ?? {}).map(([tag, key]) => [tag, D[key]]),
    );
    const id = Number(
      insert.run(
        g.title,
        g.minigameId,
        JSON.stringify(g.config),
        Number(C[g.character]),
        D[g.pre] ?? null,
        D[g.win] ?? null,
        D[g.lose] ?? null,
        JSON.stringify(styleMap),
        (i + 1) * 10,
      ).lastInsertRowid,
    );
    G[g.key] = id;
    seeded.games.push(id);
  });

  const setRequired = db.prepare('UPDATE games SET required_game_ids_json = ? WHERE id = ?');
  for (const g of games) {
    if (g.requires.length === 0) continue;
    setRequired.run(JSON.stringify(g.requires.map((k) => G[k])), G[g.key]);
  }
  console.log(`игр: ${seeded.games.length}`);
}

// ---------------------------------------------------------------------------
// 5. Этапы меты
// ---------------------------------------------------------------------------

/** x/y — проценты сцены, точка = центр спрайта. */
const place = (key, x, y, scale = 1) => ({ characterId: Number(C[key]), x, y, scale });

function buildStages() {
  return [
    {
      title: 'Смена принята',
      trigger: { type: 'wonCount', value: 0 },
      characters: [place('marina', 22, 62), place('timur', 40, 66, 0.9), place('vera', 76, 60)],
    },
    {
      title: 'Город на связи',
      trigger: { type: 'wonCount', value: 2 },
      characters: [
        place('marina', 16, 64, 0.9),
        place('timur', 32, 68, 0.85),
        place('pyrolina', 55, 58, 1.1),
        place('phantom', 74, 62),
        place('kostya', 90, 66, 0.9),
      ],
    },
    {
      title: 'Полный расчёт',
      trigger: { type: 'wonCount', value: 4 },
      characters: [
        place('timur', 12, 68, 0.8),
        place('vera', 26, 64, 0.9),
        place('impulse', 42, 58),
        place('granit', 60, 54, 1.25),
        place('k9', 74, 70, 0.8),
        place('lida', 88, 62, 0.9),
      ],
    },
    {
      title: 'Ночь длинная',
      trigger: { type: 'games', ids: ['shift', 'bridge', 'metro', 'safe', 'kitchen', 'hull'] },
      characters: [
        place('zinaida', 10, 70, 0.85),
        place('lida', 24, 66, 0.9),
        place('vector', 38, 58, 1.05),
        place('pyrolina', 52, 56, 1.05),
        place('granit', 66, 54, 1.25),
        place('nochnitsa', 82, 50, 1.15),
        place('k9', 94, 70, 0.8),
      ],
    },
  ];
}

function seedStages() {
  const insert = db.prepare(
    `INSERT INTO meta_stages (title, sort_order, background_json, characters_json, trigger_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  buildStages().forEach((s, i) => {
    const trigger =
      s.trigger.type === 'games'
        ? { type: 'games', ids: s.trigger.ids.map((k) => G[k]) }
        : s.trigger;
    const id = Number(
      insert.run(
        s.title,
        (i + 1) * 10,
        JSON.stringify({ fit: 'cover', scale: 1, offset: { x: 0, y: 0 } }),
        JSON.stringify(s.characters),
        JSON.stringify(trigger),
      ).lastInsertRowid,
    );
    seeded.metaStages.push(id);
  });
  console.log(`этапов меты: ${seeded.metaStages.length}`);
}

// ---------------------------------------------------------------------------

db.transaction(() => {
  clean();
  seedAssets();
  seedCharacters();
  seedDialogues();
  linkMetaDialogues();
  seedGames();
  seedStages();
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run(
    SEED_KEY,
    JSON.stringify(seeded),
  );
})();

console.log('готово. Откройте админку — контент на месте.');
