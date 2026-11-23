'use strict';
// submove.js — ПЕРЕЕЗД ВКЛАДКИ НА ДРУГУЮ ПОДПИСКУ: тот же разговор, другой аккаунт Клода.
//
// Зачем. Подписка вкладке давалась один раз — при открытии, и дальше сменить её было нечем.
// Живой случай 22.11: у «личной» не прошла оплата, и вкладка на каждый ход отвечала «Claude
// Code can't use your Claude subscription… payment is past due». Вкладка жива, разговор цел, а
// работать она не может, и перевести её на «рабочую» можно было только руками: закрыть, открыть
// новую, пересказать задачу.
//
// Как. Разговор Клода — файл стенограммы в папке конфига аккаунта (<home>/projects/<слаг>/<id>.jsonl).
// Аккаунт он не помнит: тот же файл, положенный в папку другого аккаунта, поднимается там по
// `--resume <id>`. Поэтому переезд — это: закрыть агента, ПЕРЕНЕСТИ файл (и папку с его
// сабагентами) в конфиг новой подписки, переставить в оболочке переменные прокси и запустить
// строку новой подписки с `--resume`. Перенести, а не скопировать: две копии одного id в двух
// аккаунтах — это две расходящиеся истории, и вкладка привязалась бы к той, где её уже нет.
//
// Здесь только решения и тексты: куда ехать, что печатать в оболочку, когда ехать самим.
// Файлы, процессы и pty — в main.js.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SWARM_SUBMOVE = api;
})(typeof self !== 'undefined' ? self : this, function () {

// Сами переезжаем не чаще раза в полчаса на вкладку. Если умерли обе подписки, вкладка иначе
// металась бы между ними на каждый ход, сжигая попытки и засыпая человека сообщениями.
const AUTO_GAP_MS = 30 * 60_000;
// Подписка, на которой мы видели смерть, считается мёртвой час: на неё сами не едем. Оплатил —
// через час Svarmo снова готов на неё переезжать, а руками можно сразу.
const DEAD_FOR_MS = 60 * 60_000;

// Куда переезжать самим. Только на карточку с выученной папкой конфига: без неё некуда
// перенести разговор. Мёртвые подписки пропускаем; текущую — тоже, это не переезд.
//   cards — список карточек подписок (subs.cards), current — индекс текущей (-1 — не знаем),
//   dead — { [home]: когда видели смерть }, now — сейчас.
function pickTarget(cards, current, dead, now) {
  const list = Array.isArray(cards) ? cards : [];
  const cur = list[current] || null;
  const d = dead || {};
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (i === current || !c || !c.home) continue;
    if (cur && cur.home && c.home === cur.home) continue;   // та же подписка другой строкой
    const at = Number(d[c.home]) || 0;
    if (at && now - at < DEAD_FOR_MS) continue;
    return i;
  }
  return -1;
}

// Ехать ли самим. Повод — экран сказал «подписка не работает» (screen.subDeadHit). Остальное —
// чтобы не наломать: переезд не ко времени портит больше, чем стоящая вкладка.
// mark — считать ли ТЕКУЩУЮ подписку мёртвой (на неё сами не едем час). Не считаем, когда
// баннер старый: иначе вкладка, переехавшая на живую подписку, тут же объявила бы мёртвой и её.
function autoDecision(c) {
  if (!c.dead) return { act: 'skip', why: 'подписка жива', mark: false };
  // Баннер остался на экране от прошлой жизни: после переезда Клод перерисовывает историю, и
  // старое «payment is past due» снова видно. Новость — только то, что случилось в ходе,
  // начатом ПОСЛЕ переезда.
  if (c.movedAt && !(c.turnAt > c.movedAt)) return { act: 'skip', why: 'баннер от прошлой подписки', mark: false };
  if (c.moving) return { act: 'skip', why: 'уже переезжает', mark: true };
  if (c.busyWith) return { act: 'skip', why: c.busyWith, mark: true };
  if (c.movedAt && c.now - c.movedAt < AUTO_GAP_MS) return { act: 'stand', why: 'недавно уже переезжала', mark: true };
  if (c.target === -1) return { act: 'stand', why: 'ехать некуда', mark: true };
  return { act: 'move', why: 'подписка не работает', mark: true };
}

// Переменные прокси новой подписки — строкой, которую печатаем в оболочку перед запуском.
// Прокси подписки кладётся в окружение оболочки при её рождении (launch-line.proxyEnv), а
// оболочку мы не пересоздаём: переставляем те же переменные на месте. Без прокси — снимаем,
// иначе новая подписка поехала бы через прокси старой. Адрес — локального посредника, без
// логина и пароля: строка видна на экране.
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
function envPrefix(family, url, all, noProxy) {
  const u = String(url || '').trim();
  const np = String(noProxy || '').trim();
  if (family === 'cmd') {
    if (!u) return PROXY_VARS.slice(0, 2).map((n) => `set ${n}=`).join('&') + '&set SWARM_PROXY_ALL=&';
    return PROXY_VARS.slice(0, 2).map((n) => `set ${n}=${u}`).join('&')
      + `&set SWARM_PROXY_ALL=${all ? '1' : ''}` + (np ? `&set NO_PROXY=${np}` : '') + '&';
  }
  if (family === 'powershell') {
    if (!u) return PROXY_VARS.map((n) => `Remove-Item Env:${n} -ErrorAction SilentlyContinue`).join('; ')
      + '; $env:SWARM_PROXY_ALL=\'\'; ';
    return PROXY_VARS.map((n) => `$env:${n}='${u}'`).join('; ')
      + `; $env:SWARM_PROXY_ALL='${all ? '1' : ''}'` + (np ? `; $env:NO_PROXY='${np}'; $env:no_proxy='${np}'` : '') + '; ';
  }
  if (!u) return `unset ${PROXY_VARS.join(' ')}; export SWARM_PROXY_ALL=; `;
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  return `export ${PROXY_VARS.map((n) => `${n}=${q(u)}`).join(' ')} SWARM_PROXY_ALL=${all ? '1' : "''"}`
    + (np ? ` NO_PROXY=${q(np)} no_proxy=${q(np)}` : '') + '; ';
}

// Строка запуска на новой подписке. База — строка ЭТОЙ вкладки (cur, уже без меток разговора):
// в ней ссылки на окружение её оболочки (--settings, правила), собрать их заново неоткуда.
// Меняем только то, что принадлежит подписке: слово запуска и флаги из строки прежней карточки
// (`claude-my --model opus` → `claude`). Флаги карточки ищем по месту, а не только в начале:
// режим разрешений Svarmo вставляет сразу за словом запуска. Присваивания перед словом
// (`CLAUDE_CONFIG_DIR=… claude`) выбрасываем — в них и сидит папка прежнего конфига.
// Всё ПОСЛЕ слова запуска. По позиции токена, а не поиском слова в строке: «claude» сидит и
// внутри `CLAUDE_CONFIG_DIR=/u/.claude-my`, и поиск нашёл бы его там.
function afterLauncher(cmd) {
  const text = String(cmd || '');
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    if (!/^\w+=/.test(m[0])) return { word: m[0], rest: text.slice(m.index + m[0].length) };
  }
  return null;
}
function baseLine(cur, fromLine, toLine) {
  const to = String(toLine || '').trim();
  const head = afterLauncher(cur);
  if (!head || !to) return '';
  let rest = head.rest;
  const fromHead = afterLauncher(fromLine);
  const fromFlags = fromHead ? fromHead.rest.trim() : '';
  if (fromFlags) {
    const at = (rest + ' ').indexOf(' ' + fromFlags + ' ');
    if (at !== -1) rest = rest.slice(0, at) + rest.slice(at + 1 + fromFlags.length);
  }
  return (to + ' ' + rest.trim()).trim();
}

// Строка в журнал вкладки и в телегу. Сам переехал — говорим почему: человек должен понять,
// что вкладка теперь тратит другую подписку.
function noteText(o) {
  const to = o.to || 'другую подписку';
  const from = o.from ? ` с «${o.from}»` : '';
  if (o.fresh) {
    return `переехала${from} на «${to}» свежей сессией: прежний разговор перенести не вышло (${o.why || 'нет файла'}),`
      + ' задачу подхватит по файлу работы';
  }
  return o.auto
    ? `подписка${from ? ` «${o.from}»` : ''} не работает — сам перевёл вкладку на «${to}», разговор тот же`
    : `переехала${from} на «${to}», разговор тот же`;
}

return { AUTO_GAP_MS, DEAD_FOR_MS, PROXY_VARS, pickTarget, autoDecision, envPrefix, baseLine, noteText };

});
