import './style.css';
import { APP_NAME, WALL_ROOM_NAME } from './config.js';
import { loadSession, startLogin, finishLogin, getAuthResponse, clearSession, redirectUri } from './auth.js';
import { startMatrix, joinSpaceRooms, useRecoveryKey, isVerified, logout } from './matrix.js';

const $app = document.getElementById('app');
let client = null;
let view = null;   // текущий экран: { title, html, refresh?, arg }

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { location.hash = hash; };
const COLORS = ['#5b88bd', '#6a9e5b', '#c97b4a', '#9a6bb5', '#c45c6a', '#4a9a9a'];
function avatar(id, name) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const letter = (name || id).replace(/^@/, '').charAt(0).toUpperCase();
  return `<span class="ava" style="background:${COLORS[Math.abs(h) % COLORS.length]}">${esc(letter)}</span>`;
}
function time(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + hm;
}
const isMsg = (ev) => ['m.room.message', 'm.room.encrypted'].includes(ev.getType())
  && !ev.isRedacted() && ev.getRelation()?.rel_type !== 'm.replace';
function body(ev) {
  if (ev.isDecryptionFailure()) return '<i class="muted">🔒 Не удалось расшифровать. Введите ключ восстановления в «Настройках».</i>';
  if (ev.getType() === 'm.room.encrypted') return '<i class="muted">Расшифровка…</i>';
  const c = ev.getContent();
  if (c.msgtype === 'm.image') return '<i class="muted">[фото — будет в следующей версии]</i>';
  return esc(c.body);
}
const sender = (ev) => ev.sender?.name || ev.getSender();
const wallRoom = () => client.getRooms().find((r) => r.getMyMembership() === 'join' && r.name === WALL_ROOM_NAME);
const chatRooms = () => client.getRooms()
  .filter((r) => r.getMyMembership() === 'join' && !r.isSpaceRoom() && r.name !== WALL_ROOM_NAME)
  .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
const timeline = (room) => room.getLiveTimeline().getEvents().filter(isMsg);
const commentsCount = (ev) => ev.getThread()?.length ?? ev.getServerAggregatedRelation('m.thread')?.count ?? 0;

// ---------- экраны до входа ----------
function screen(html) { $app.innerHTML = `<div class="center">${html}</div>`; }
const LOGO = '<img class="logo" src="./icons/icon.svg" alt="">';
const loading = (t) => screen(`${LOGO}<p>${esc(t)}</p>`);
function showLogin(err) {
  screen(`
    ${LOGO}
    <h1>${esc(APP_NAME)}</h1>
    <p>Семейная сеть. Только для своих.</p>
    ${err ? `<p class="err">${esc(err)}</p>` : ''}
    <button class="btn" data-act="login">Войти</button>
    <p class="hint">Откроется страница matrix.org. Введите там логин (например, yurt02) и пароль, и вы вернётесь сюда.</p>`);
}

// ---------- каркас ----------
function layout() {
  $app.innerHTML = `
    <header class="top">
      <button class="burger" data-act="menu" aria-label="Меню">☰</button>
      <div class="title" id="title"></div>
    </header>
    <nav class="drawer" id="drawer">
      <div class="me">${avatar(client.getUserId(), client.getUser(client.getUserId())?.displayName)}
        <span>${esc(client.getUser(client.getUserId())?.displayName || client.getUserId())}</span></div>
      <a href="#/wall">Стена</a>
      <a href="#/chats">Сообщения <b id="unread"></b></a>
      <a href="#/settings">Настройки</a>
    </nav>
    <div class="shade" data-act="menu"></div>
    <main id="view"></main>`;
}
const toggleMenu = (open) => document.body.classList.toggle('menu-open', open);

// ---------- экраны ----------
const views = {
  wall: () => ({
    title: 'Стена',
    html: `
      <form class="card newpost" data-form="post">
        <textarea name="text" rows="2" placeholder="Что у вас нового?"></textarea>
        <button class="btn">Опубликовать</button>
      </form>
      <div id="list"></div>
      <button class="more" data-act="more">Показать ещё</button>`,
    refresh() {
      const room = wallRoom();
      if (!room) return `<div class="card muted">Комната «${esc(WALL_ROOM_NAME)}» не найдена. Попросите, чтобы вас пригласили в пространство семьи.</div>`;
      const posts = timeline(room).reverse();
      if (!posts.length) return '<div class="card muted">Пока пусто. Напишите первый пост!</div>';
      return posts.map((ev) => post(ev, true)).join('');
    },
  }),

  post: (id) => ({
    title: 'Комментарии',
    html: `<div id="list"></div>
      <form class="writebar" data-form="comment"><input name="text" autocomplete="off" placeholder="Комментарий…"><button>➤</button></form>`,
    async load() {
      const room = wallRoom(); if (!room) return;
      const r = await client.relations(room.roomId, id, 'm.thread', null, { limit: 100 });
      await Promise.all(r.events.map((e) => client.decryptEventIfNeeded(e)));
      this.root = room.findEventById(id) || r.originalEvent;
      if (this.root) await client.decryptEventIfNeeded(this.root);
      this.comments = r.events.filter(isMsg).sort((a, b) => a.getTs() - b.getTs());
      this.seen = this.root?.getThread()?.length;
      scheduleRefresh();
    },
    refresh() {
      if (!this.comments) { this.load(); return '<div class="card muted">Загрузка…</div>'; }
      if (this.root?.getThread()?.length !== this.seen) this.load();
      const head = this.root ? post(this.root, false) : '';
      const list = this.comments.map((ev) => `
        <div class="comment">${avatar(ev.getSender(), sender(ev))}
          <div><b>${esc(sender(ev))}</b> <small>${time(ev.getTs())}</small><div class="text">${body(ev)}</div></div>
        </div>`).join('');
      return head + `<div class="card comments">${list || '<span class="muted">Комментариев пока нет</span>'}</div>`;
    },
  }),

  chats: () => ({
    title: 'Сообщения',
    html: `
      <form class="card newchat" data-form="newchat">
        <input name="text" autocomplete="off" autocapitalize="off" placeholder="Логин, например yurt02">
        <button class="btn">Написать</button>
      </form>
      <div id="list"></div>`,
    refresh() {
      const invites = client.getRooms().filter((r) => r.getMyMembership() === 'invite').map((r) => `
        <div class="row invite">${avatar(r.roomId, r.name)}<div class="grow"><b>${esc(r.name)}</b><small>Приглашение</small></div>
          <button class="btn sm" data-act="join" data-id="${esc(r.roomId)}">Принять</button>
          <button class="btn sm gray" data-act="leave" data-id="${esc(r.roomId)}">✕</button></div>`).join('');
      const rooms = chatRooms().map((r) => {
        const last = timeline(r).at(-1);
        const n = r.getUnreadNotificationCount('total');
        return `<a class="row" href="#/chat/${encodeURIComponent(r.roomId)}">${avatar(r.roomId, r.name)}
          <div class="grow"><b>${esc(r.name)}</b><small>${last ? esc(sender(last)) + ': ' + (last.getContent().body ? esc(last.getContent().body) : '…') : ''}</small></div>
          ${n ? `<span class="cnt">${n}</span>` : ''}</a>`;
      }).join('');
      return invites + (rooms || '<div class="card muted">Диалогов пока нет</div>');
    },
  }),

  chat: (id) => ({
    title: client.getRoom(id)?.name || 'Чат',
    html: `<div id="list" class="chat"></div>
      <form class="writebar" data-form="msg"><input name="text" autocomplete="off" placeholder="Сообщение…"><button>➤</button></form>`,
    refresh() {
      const room = client.getRoom(id);
      if (!room) return '<div class="card muted">Загрузка…</div>';
      document.getElementById('title').textContent = room.name;
      const evs = timeline(room);
      const last = evs.at(-1);
      if (last) client.sendReadReceipt(last).catch(() => {});
      const me = client.getUserId();
      return `<button class="more" data-act="more">Ранее</button>` + evs.map((ev) => `
        <div class="bubble ${ev.getSender() === me ? 'mine' : ''}">
          ${ev.getSender() === me ? '' : `<b>${esc(sender(ev))}</b>`}
          <div class="text">${body(ev)}</div><small>${time(ev.getTs())}</small></div>`).join('');
    },
    scrollBottom: true,
  }),

  settings: () => ({
    title: 'Настройки',
    html: `
      <form class="card" data-form="name">
        <h3>Моё имя</h3>
        <p class="muted">Его видят родные. Логин: ${esc(client.getUserId())}</p>
        <input name="text" value="${esc(client.getUser(client.getUserId())?.displayName || '')}" placeholder="Например: Папа">
        <button class="btn">Сохранить</button>
      </form>
      <form class="card" data-form="recovery">
        <h3>Ключ восстановления</h3>
        <p class="muted">Нужен, чтобы читать старые зашифрованные сообщения на этом телефоне. Ключ выдаёт Element X при настройке «Восстановления». Храните его в надёжном месте.</p>
        <p id="verified" class="muted">Проверяем устройство…</p>
        <input name="text" autocomplete="off" placeholder="EsTc 1234 …">
        <button class="btn">Применить ключ</button>
      </form>
      <div class="card"><button class="btn gray" data-act="logout">Выйти</button></div>`,
    async after() {
      const ok = await isVerified(client);
      const el = document.getElementById('verified');
      if (el) el.textContent = ok ? '✅ Устройство подтверждено' : '⚠️ Устройство не подтверждено — введите ключ.';
    },
  }),
};

function post(ev, withLink) {
  const n = commentsCount(ev);
  return `<div class="card post">
    <div class="head">${avatar(ev.getSender(), sender(ev))}<div><b>${esc(sender(ev))}</b><small>${time(ev.getTs())}</small></div></div>
    <div class="text">${body(ev)}</div>
    ${withLink ? `<a class="foot" href="#/post/${encodeURIComponent(ev.getId())}">💬 Комментарии${n ? ' (' + n + ')' : ''}</a>` : ''}
  </div>`;
}

// ---------- маршрутизация и обновление ----------
function route() {
  toggleMenu(false);
  const [, name, ...rest] = location.hash.split('/');
  const make = views[name] || views.wall;
  view = make(decodeURIComponent(rest.join('/')));
  document.getElementById('title').textContent = view.title;
  document.getElementById('view').innerHTML = view.html;
  document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('sel', a.getAttribute('href') === '#/' + (name || 'wall')));
  refresh(true);
  view.after?.();
}

let timer = null;
function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => refresh(false), 150); }
function refresh(first) {
  const unread = chatRooms().reduce((s, r) => s + r.getUnreadNotificationCount('total'), 0);
  const u = document.getElementById('unread'); if (u) u.textContent = unread || '';
  const list = document.getElementById('list');
  if (!list || !view?.refresh) return;
  const el = document.documentElement;
  const atBottom = el.scrollHeight - scrollY - innerHeight < 80;
  list.innerHTML = view.refresh();
  if (view.scrollBottom && (first || atBottom)) scrollTo(0, el.scrollHeight);
}

// ---------- действия ----------
const currentRoom = () => (location.hash.startsWith('#/chat/') ? client.getRoom(view_arg()) : wallRoom());
const view_arg = () => decodeURIComponent(location.hash.split('/').slice(2).join('/'));

const actions = {
  login: () => startLogin().catch((e) => showLogin('Не получилось: ' + e.message)),
  menu: () => toggleMenu(!document.body.classList.contains('menu-open')),
  more: async () => { const r = currentRoom(); if (r) { await client.scrollback(r, 30); refresh(false); } },
  join: async (el) => { await client.joinRoom(el.dataset.id); await joinSpaceRooms(client); },
  leave: (el) => client.leave(el.dataset.id),
  logout: () => confirm('Выйти из аккаунта на этом устройстве?') && logout(client),
};

const forms = {
  post: (text) => client.sendTextMessage(wallRoom().roomId, text),
  comment: async (text) => {
    await client.sendMessage(wallRoom().roomId, view_arg(), { msgtype: 'm.text', body: text });
    view.load();
  },
  msg: (text) => client.sendTextMessage(view_arg(), text),
  newchat: async (text) => {
    let id = text.trim().toLowerCase().replace(/^@/, '');
    if (!id.includes(':')) id += ':matrix.org';
    id = '@' + id;
    if (id === client.getUserId()) throw new Error('это ваш собственный логин');
    try { await client.getProfileInfo(id); }
    catch (e) { if (e.errcode === 'M_NOT_FOUND') throw new Error('пользователь ' + id + ' не найден'); }
    // уже есть диалог с ним — просто открываем
    const direct = client.getAccountData('m.direct')?.getContent() || {};
    const existing = (direct[id] || []).find((rid) => client.getRoom(rid)?.getMyMembership() === 'join');
    if (existing) return go('#/chat/' + encodeURIComponent(existing));
    const { room_id } = await client.createRoom({
      is_direct: true, invite: [id], preset: 'trusted_private_chat',
      initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
    });
    await client.setAccountData('m.direct', { ...direct, [id]: [...(direct[id] || []), room_id] });
    go('#/chat/' + encodeURIComponent(room_id));
  },
  name: async (text) => { await client.setDisplayName(text); alert('Сохранено'); },
  recovery: async (text) => {
    try { await useRecoveryKey(client, text); alert('Готово! Ключ применён.'); route(); }
    catch (e) { alert('Ошибка: ' + e.message); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) { e.preventDefault(); actions[el.dataset.act]?.(el); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const input = f.elements.text;
  const text = input.value.trim();
  if (!text) return;
  const btn = f.querySelector('button'); btn.disabled = true;
  try {
    await forms[f.dataset.form](text);
    if (!['name'].includes(f.dataset.form)) input.value = '';
  } catch (err) { alert('Не отправлено: ' + err.message); }
  btn.disabled = false;
});

// ---------- автообновление: если на сайте новая версия — перезагружаемся ----------
async function checkUpdate() {
  try {
    const html = await (await fetch('./?v=' + Date.now(), { cache: 'no-store' })).text();
    const fresh = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    const mine = document.querySelector('script[src*="assets/index-"]')?.getAttribute('src');
    if (fresh && mine && !mine.includes(fresh)) hardReload();
  } catch {}
}
// перезагрузка мимо кэша телефона
function hardReload() { location.replace(location.pathname + '?r=' + Date.now() + location.hash); }
if (new URLSearchParams(location.search).has('r')) history.replaceState(null, '', location.pathname + location.hash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
checkUpdate();

// ---------- потянуть вниз — обновить ----------
const ptr = document.createElement('div');
ptr.className = 'ptr';
document.body.prepend(ptr);
let startY = null, pull = 0;
addEventListener('touchstart', (e) => {
  startY = scrollY <= 0 && !document.body.classList.contains('menu-open') ? e.touches[0].clientY : null;
}, { passive: true });
addEventListener('touchmove', (e) => {
  if (startY === null) return;
  pull = Math.max(0, e.touches[0].clientY - startY);
  ptr.style.height = Math.min(pull / 2, 60) + 'px';
  ptr.textContent = pull > 120 ? '↻ Отпустите — обновим' : '↓ Потяните, чтобы обновить';
}, { passive: true });
addEventListener('touchend', () => {
  if (pull > 120) { ptr.textContent = 'Обновляем…'; hardReload(); }
  else ptr.style.height = '0';
  startY = null; pull = 0;
});

// ---------- запуск ----------
async function boot() {
  document.title = APP_NAME;
  try {
    const resp = getAuthResponse();
    if (resp) {
      loading('Входим…');
      await finishLogin(resp);
      history.replaceState(null, '', redirectUri);
    }
    const s = loadSession();
    if (!s) return showLogin();
    loading('Загружаем…');
    client = await startMatrix(s);
  } catch (e) {
    console.error(e);
    return showLogin('Ошибка входа: ' + e.message);
  }
  client.on('Session.logged_out', () => { clearSession(); location.href = redirectUri; });
  for (const ev of ['Room.timeline', 'Event.decrypted', 'Room', 'Room.myMembership', 'Room.name', 'Room.receipt', 'Thread.update', 'Thread.new'])
    client.on(ev, scheduleRefresh);
  client.on('Room.myMembership', () => joinSpaceRooms(client));
  joinSpaceRooms(client);
  layout();
  window.addEventListener('hashchange', route);
  route();
}
boot();
