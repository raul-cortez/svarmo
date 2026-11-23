// Переезд вкладки на другую подписку (submove.js): куда ехать, когда ехать самим, что печатать.
// Ошибка в «когда» стоит дорого в обе стороны: не поехали — вкладка мертва до утра; поехали не
// вовремя — разговор мечется между подписками и засыпает человека сообщениями.
const assert = require('assert');
const M = require('../submove.js');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const NOW = 1_700_000_000_000;
const CARDS = [
  { line: 'claude', name: 'рабочая', home: '/u/.claude' },
  { line: 'claude-my', name: 'личная', home: '/u/.claude-my' },
  { line: 'claude --model opus', name: 'рабочая опус', home: '/u/.claude' },
  { line: 'glm', name: 'чужая', home: '' },
];

test('куда ехать: другая подписка с выученной папкой, не та же другой строкой', () => {
  assert.strictEqual(M.pickTarget(CARDS, 1, {}, NOW), 0);
  assert.strictEqual(M.pickTarget(CARDS, 0, {}, NOW), 1, 'опус — тот же аккаунт, это не переезд');
  assert.strictEqual(M.pickTarget(CARDS, -1, {}, NOW), 0);
});

test('куда ехать: мёртвую подписку пропускаем час, потом снова можно', () => {
  assert.strictEqual(M.pickTarget(CARDS, 1, { '/u/.claude': NOW - 5000 }, NOW), -1);
  assert.strictEqual(M.pickTarget(CARDS, 1, { '/u/.claude': NOW - M.DEAD_FOR_MS - 1 }, NOW), 0);
  assert.strictEqual(M.pickTarget([CARDS[0], CARDS[3]], 0, {}, NOW), -1, 'без папки конфига ехать некуда');
});

function auto(o) {
  return M.autoDecision(Object.assign({ dead: true, moving: false, busyWith: '', movedAt: 0, turnAt: NOW - 1000, now: NOW, target: 0 }, o));
}

test('сами едем, когда подписка мертва и есть куда', () => {
  assert.strictEqual(auto({}).act, 'move');
  assert.strictEqual(auto({ dead: false }).act, 'skip');
  assert.strictEqual(auto({ target: -1 }).act, 'stand');
  assert.strictEqual(auto({ moving: true }).act, 'skip');
  assert.strictEqual(auto({ busyWith: 'идёт перезапуск' }).act, 'skip');
});

test('баннер от прошлой подписки после переезда — не повод ехать снова', () => {
  assert.strictEqual(auto({ movedAt: NOW - 2000, turnAt: NOW - 3000 }).act, 'skip');
  assert.strictEqual(auto({ movedAt: NOW - 2000, turnAt: NOW - 3000 }).mark, false, 'живую подписку мёртвой не объявляем');
  assert.strictEqual(auto({}).mark, true);
  // Ход после переезда и снова смерть — значит, умерла и эта; но не чаще раза в полчаса.
  assert.strictEqual(auto({ movedAt: NOW - 60_000, turnAt: NOW - 1000 }).act, 'stand');
  assert.strictEqual(auto({ movedAt: NOW - M.AUTO_GAP_MS - 5000, turnAt: NOW - 1000 }).act, 'move');
});

test('переменные прокси: ставим новой подписки или снимаем старые', () => {
  assert.strictEqual(M.envPrefix('posix', '', false), 'unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; export SWARM_PROXY_ALL=; ');
  const on = M.envPrefix('posix', 'http://127.0.0.1:5555', true, 'localhost,127.0.0.1');
  assert.ok(on.startsWith("export HTTP_PROXY='http://127.0.0.1:5555' "), on);
  assert.ok(on.includes('SWARM_PROXY_ALL=1'), on);
  assert.ok(on.includes("NO_PROXY='localhost,127.0.0.1'"), on);
  assert.ok(on.endsWith('; '), on);
  assert.ok(M.envPrefix('cmd', 'http://x:1', false).startsWith('set HTTP_PROXY=http://x:1&'));
  assert.ok(M.envPrefix('powershell', '', false).includes('Remove-Item Env:HTTPS_PROXY'));
});

test('строка запуска: меняем только то, что от подписки', () => {
  const tail = '--settings "$SWARM_SETTINGS" --append-system-prompt "$SWARM_ASK_RULE"';
  // Живая форма: режим разрешений встал между словом и флагами карточки.
  assert.strictEqual(M.baseLine(`claude-my --permission-mode auto --model opus ${tail}`, 'claude-my --model opus', 'claude'),
    `claude --permission-mode auto ${tail}`);
  assert.strictEqual(M.baseLine(`claude ${tail}`, 'claude', 'claude-my --model sonnet'), `claude-my --model sonnet ${tail}`);
  assert.strictEqual(M.baseLine(`CLAUDE_CONFIG_DIR=/u/.claude-my claude ${tail}`, '', 'claude'), `claude ${tail}`);
  assert.strictEqual(M.baseLine('claude-my', 'claude-my', 'claude'), 'claude');
  // Флаг карточки не путаем с похожим длиннее: --model opus не режет --model opus-4.
  assert.strictEqual(M.baseLine('claude-my --model opus-4', 'claude-my --model opus', 'claude'), 'claude --model opus-4');
  assert.strictEqual(M.baseLine('', 'claude', 'claude-my'), '');
});

test('текст человеку называет, откуда и куда', () => {
  assert.strictEqual(M.noteText({ from: 'личная', to: 'рабочая', auto: true }),
    'подписка «личная» не работает — сам перевёл вкладку на «рабочая», разговор тот же');
  assert.strictEqual(M.noteText({ from: 'личная', to: 'рабочая' }), 'переехала с «личная» на «рабочая», разговор тот же');
  assert.ok(M.noteText({ to: 'рабочая', fresh: true, why: 'нет файла' }).includes('свежей сессией'));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.message || e)); process.exitCode = 1; }
  }
  console.log(`\nsubmove: ${passed}/${tests.length} ok`);
})();
