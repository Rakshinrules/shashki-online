'use strict';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('game-player-token');
if (fragment.has('token')) {
  sessionStorage.setItem('game-player-token', token);
  history.replaceState(null, '', location.pathname);
}
const pendingKey = `game-pending:${token || ''}`;
let queue;
try { queue = JSON.parse(sessionStorage.getItem(pendingKey) || '[]'); } catch { queue = []; }
let cursor = 0, flushing = false, connected = false, fatal = false;
const events = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function persist() { sessionStorage.setItem(pendingKey, JSON.stringify(queue)); }
function controls() { $('ping').disabled = $('send').disabled = !token || fatal || queue.length >= 100; }
function draw(event, pending = false) {
  let bubble = document.getElementById(`event-${event.id}`);
  if (!bubble) { bubble = document.createElement('div'); bubble.id = `event-${event.id}`; $('messages').append(bubble); }
  bubble.className = `bubble ${event.actor}${pending ? ' pending' : ''}`;
  const label = document.createElement('small');
  label.textContent = `${event.actor === 'player' ? 'Ты' : 'GPT'} · ${pending ? 'отправляется' : new Date(event.created).toLocaleTimeString()}`;
  bubble.replaceChildren(label, document.createTextNode(event.text));
  $('messages').scrollTop = $('messages').scrollHeight;
}
function accept(event) {
  events.set(event.id, event); draw(event);
  queue = queue.filter(item => item.id !== event.id); persist(); controls();
  if (event.reply_to && events.has(event.reply_to)) {
    const seconds = (event.created - events.get(event.reply_to).created) / 1000;
    $('receipt').textContent = `Ответ получен через ${seconds.toFixed(1)} с после приёма события сервером.`;
  }
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(35000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (response.status === 401) { fatal = true; controls(); throw new Error('Нужна действующая ссылка подключения.'); }
  if (!response.ok) throw new Error(`Сервер вернул ${response.status}`);
  return response.json();
}
async function flush() {
  if (flushing || fatal) return;
  flushing = true;
  let delay = 500;
  try {
    while (queue.length && !fatal) {
      const next = queue[0], started = performance.now();
      try {
        const result = await request('/api/events', { method: 'POST', body: JSON.stringify({ id: next.id, text: next.text }) });
        accept(result.event);
        $('status').textContent = `Сервер принял событие за ${Math.round(performance.now() - started)} мс. Ожидаем GPT.`;
        delay = 500;
      } catch (error) {
        $('status').textContent = fatal ? error.message : 'Связь прервалась. Событие сохранено, повторяем отправку…';
        if (fatal) break;
        await pause(delay); delay = Math.min(delay * 2, 5000);
      }
    }
  } finally { flushing = false; }
}
function send(text) {
  if (!text.trim() || queue.length >= 100 || fatal) return;
  const event = { id: crypto.randomUUID(), actor: 'player', text: text.trim(), created: Date.now() };
  queue.push(event); persist(); draw(event, true); controls(); void flush();
}
async function listen() {
  let delay = 500;
  while (!fatal) {
    try {
      const result = await request(`/api/events?after=${cursor}&wait=${connected ? 20000 : 0}`);
      for (const event of result.events) { accept(event); cursor = Math.max(cursor, event.seq); }
      if (!connected) $('status').textContent = 'Связь с сервером установлена.';
      connected = true; delay = 500;
      $('agent').textContent = result.agentWaiting ? 'GPT ожидает событие.' : result.agentSeen ?
        `Последнее обращение GPT: ${new Date(result.agentSeen).toLocaleTimeString()}` : 'Подключение GPT ещё не подтверждено.';
    } catch (error) {
      connected = false;
      $('status').textContent = fatal ? error.message : 'Восстанавливаем соединение…';
      if (fatal) break;
      await pause(delay); delay = Math.min(delay * 2, 5000);
    }
  }
}
$('ping').onclick = () => send('Проверка связи: нажал кнопку. Ответь здесь коротким сообщением.');
$('form').onsubmit = event => { event.preventDefault(); send($('message').value); $('message').value = ''; };
window.addEventListener('online', () => void flush());
controls();
if (token) { for (const event of queue) draw(event, true); void listen(); void flush(); }
else $('status').textContent = 'Открой страницу по личной ссылке подключения.';
