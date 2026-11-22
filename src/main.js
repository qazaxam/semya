import './style.css';
import { APP_NAME, WALL_ROOM_NAME, STATIONS } from './config.js';
import { loadSession, startLogin, finishLogin, getAuthResponse, clearSession, redirectUri } from './auth.js';
import { startMatrix, joinSpaceRooms, useRecoveryKey, isVerified, logout } from './matrix.js';
import { unlockAudio, sound, soundOn, setSound, toast, notifyState, askNotify, systemNotify, registerSW, setBadge, enablePush, pushStatus, testPush } from './notify.js';
import { PUSH_GATEWAY, VAPID_PUBLIC, DEVICE_NAME } from './config.js';
const turnOnPush = () => enablePush(client, { gateway: PUSH_GATEWAY, vapidKey: VAPID_PUBLIC, appName: APP_NAME, deviceName: DEVICE_NAME });

const $app = document.getElementById('app');
let client = null;
let view = null;   // текущий экран: { title, html, refresh?, arg }

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { location.hash = hash; };
const COLORS = ['#5b88bd', '#6a9e5b', '#c97b4a', '#9a6bb5', '#c45c6a', '#4a9a9a'];
const userLink = (id) => '#/user/' + encodeURIComponent(id);
function avatar(id, name, cls = '') {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const letter = (name || id).replace(/^@/, '').charAt(0).toUpperCase();
  return `<span class="ava ${cls}" style="background:${COLORS[Math.abs(h) % COLORS.length]}">${esc(letter)}</span>`;
}
function time(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + hm;
}
const hm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts).toDateString(), now = new Date();
  if (d === now.toDateString()) return 'Сегодня';
  now.setDate(now.getDate() - 1);
  if (d === now.toDateString()) return 'Вчера';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
// ключ сообщения не меняется, когда «отправляется» превращается в «отправлено»
const evKey = (ev) => ev.getUnsigned()?.transaction_id || ev.getTxnId?.() || ev.getId();
const isMsg = (ev) => ['m.room.message', 'm.room.encrypted'].includes(ev.getType())
  && !ev.isRedacted() && ev.getRelation()?.rel_type !== 'm.replace';
function body(ev) {
  if (ev.isDecryptionFailure()) return '<i class="muted">🔒 Не удалось расшифровать. Введите ключ восстановления в «Настройках».</i>';
  if (ev.getType() === 'm.room.encrypted') return '<i class="muted">Расшифровка…</i>';
  const c = ev.getContent();
  if (c.msgtype === 'm.image') return '<i class="muted">[фото — будет в следующей версии]</i>';
  return esc(stripReply(c.body));
}
// старые клиенты добавляют к ответу цитату строками «> …» — убираем её, цитату рисуем сами
function stripReply(s) {
  if (!s?.startsWith('> ')) return s;
  const lines = s.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('>')) i++;
  if (lines[i] === '') i++;
  return lines.slice(i).join('\n');
}
const plain = (ev) => (ev.isDecryptionFailure() ? '🔒 сообщение' : stripReply(ev.getContent().body || ''));
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
    <div class="sticky">
      <header class="top">
        <button class="burger" data-act="menu" aria-label="Меню">☰</button>
        <div class="title"><span id="title"></span><small id="subtitle"></small></div>
        <a class="hbtn" href="#/search" aria-label="Поиск">${ICON_SEARCH}</a>
        <button class="hbtn" data-act="reload" aria-label="Обновить">${ICON_RELOAD}</button>
      </header>
      <div id="player" class="player" hidden></div>
    </div>
    <nav class="drawer" id="drawer">
      <a class="me" href="#/user/me">${avatar(client.getUserId(), client.getUser(client.getUserId())?.displayName)}
        <span>${esc(client.getUser(client.getUserId())?.displayName || client.getUserId())}</span></a>
      <a href="#/user/me">Моя страница</a>
      <a href="#/wall">Стена</a>
      <a href="#/friends">Друзья <b id="requests"></b></a>
      <a href="#/chats">Сообщения <b id="unread"></b></a>
      <a href="#/radio">Радио</a>
      <a href="#/search">Поиск</a>
      <a href="#/settings">Настройки</a>
    </nav>
    <div class="shade" data-act="menu"></div>
    <main id="view"></main>
    <div id="bar"></div>
    <div id="toast" class="toast"></div>`;
}
function setTitle(t, sub = '') {
  document.getElementById('title').textContent = t;
  document.getElementById('subtitle').textContent = sub;
}
const toggleMenu = (open) => document.body.classList.toggle('menu-open', open);
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
const ICON_RELOAD = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

// ---------- друзья = личные диалоги (m.direct) ----------
function normId(t) {
  let id = t.trim().toLowerCase().replace(/^@/, '');
  if (!id.includes(':')) id += ':matrix.org';
  return '@' + id;
}
const directMap = () => client.getAccountData('m.direct')?.getContent() || {};
async function rememberDirect(id, roomId) {
  const d = directMap();
  if ((d[id] || []).includes(roomId)) return;
  await client.setAccountData('m.direct', { ...d, [id]: [...(d[id] || []), roomId] });
}
// [{ id, name, room, status: 'friend' | 'sent' }]
function friends() {
  const out = [];
  for (const [id, rooms] of Object.entries(directMap())) {
    const room = rooms.map((r) => client.getRoom(r)).find((r) => r?.getMyMembership() === 'join');
    const m = room?.getMember(id);
    if (!m || !['join', 'invite'].includes(m.membership)) continue;
    out.push({ id, name: m.name || id, room, status: m.membership === 'join' ? 'friend' : 'sent' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const friendRequests = () => client.getRooms().filter((r) => r.getMyMembership() === 'invite' && r.getDMInviter());
async function addFriend(id) {
  const ex = friends().find((f) => f.id === id);
  if (ex) return ex.room.roomId;
  const { room_id } = await client.createRoom({
    is_direct: true, invite: [id], preset: 'trusted_private_chat',
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });
  await rememberDirect(id, room_id);
  return room_id;
}
async function searchPeople(term) {
  const res = new Map();
  try {
    const r = await client.searchUserDirectory({ term, limit: 20 });
    r.results.forEach((u) => res.set(u.user_id, u.display_name || u.user_id));
  } catch {}
  if (/^@?[\w.=\-/]+(:[\w.-]+)?$/.test(term.trim())) {
    const id = normId(term);
    if (!res.has(id)) {
      try { const p = await client.getProfileInfo(id); res.set(id, p.displayname || id); } catch {}
    }
  }
  res.delete(client.getUserId());
  return [...res];
}
function personRow(id, name, right) {
  return `<div class="row"><a class="who" href="${userLink(id)}">${avatar(id, name)}<div class="grow"><b>${esc(name)}</b><small>${esc(id)}</small></div></a>${right}</div>`;
}

// ---------- радио: играет, пока переходишь по разделам ----------
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const audio = new Audio();
let station = null;
function playStation(i) {
  if (i === null || i === undefined) return;
  if (station === i && !audio.paused) audio.pause();
  else {
    if (station !== i) { audio.src = STATIONS[i][1]; station = i; setMediaInfo(); }
    audio.play().catch((e) => alert('Станция не играет: ' + e.message));
  }
  updatePlayer();
}
// экран блокировки / Пункт управления iPhone
function setMediaInfo() {
  if (!('mediaSession' in navigator) || station === null) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: STATIONS[station][0],
    artist: 'Радио · ' + APP_NAME,
    artwork: [{ src: new URL('./icons/icon-square-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const step = (d) => station !== null && playStation((station + d + STATIONS.length) % STATIONS.length);
  const set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  set('play', () => { if (audio.paused) playStation(station); });
  set('pause', () => audio.pause());
  set('previoustrack', () => step(-1));
  set('nexttrack', () => step(1));
  set('seekbackward', null);
  set('seekforward', null);
}
function updatePlayer() {
  const p = document.getElementById('player');
  if (p) {
    p.hidden = station === null;
    if (station !== null) p.innerHTML = `
      <button data-act="radiotoggle">${audio.paused ? ICON_PLAY : ICON_PAUSE}</button>
      <a href="#/radio">${esc(STATIONS[station][0])}</a>
      <button data-act="radiostop">✕</button>`;
  }
  scheduleRefresh();
}
['playing', 'pause', 'error'].forEach((e) => audio.addEventListener(e, updatePlayer));

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
    html: '<div id="list"></div>',
    bar: `<form class="writebar" data-form="comment"><input name="text" autocomplete="off" enterkeyhint="send" placeholder="Комментарий…"><button aria-label="Отправить">${ICON_SEND}</button></form>`,
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
    html: '<div id="list"></div>',
    refresh() {
      const invites = client.getRooms().filter((r) => r.getMyMembership() === 'invite' && !r.getDMInviter()).map((r) => `
        <div class="row invite">${avatar(r.roomId, r.name)}<div class="grow"><b>${esc(r.name)}</b><small>Приглашение</small></div>
          <button class="btn sm" data-act="join" data-id="${esc(r.roomId)}">Принять</button>
          <button class="btn sm gray" data-act="leave" data-id="${esc(r.roomId)}">✕</button></div>`).join('');
      const rooms = chatRooms().map((r) => {
        const last = timeline(r).at(-1);
        const n = r.getUnreadNotificationCount('total');
        return `<a class="row" href="#/chat/${encodeURIComponent(r.roomId)}">${avatar(r.roomId, r.name)}
          <div class="grow"><b>${esc(r.name)}</b><small>${last ? esc(sender(last)) + ': ' + (last.getContent().body ? esc(plain(last)) : '…') : ''}</small></div>
          ${n ? `<span class="cnt">${n}</span>` : ''}</a>`;
      }).join('');
      return invites + (rooms || '<div class="card muted">Диалогов пока нет. <a href="#/search">Найти друзей</a></div>');
    },
  }),

  friends: () => ({
    title: 'Друзья',
    html: '<div id="list"></div>',
    refresh() {
      const req = friendRequests().map((r) => {
        const id = r.getDMInviter();
        return personRow(id, r.getMember(id)?.name || id, `
          <button class="btn sm" data-act="acceptfriend" data-id="${esc(r.roomId)}">Принять</button>
          <button class="btn sm gray" data-act="leave" data-id="${esc(r.roomId)}">✕</button>`);
      }).join('');
      const list = friends().map((f) => personRow(f.id, f.name, f.status === 'friend'
        ? `<a class="btn sm" href="#/chat/${encodeURIComponent(f.room.roomId)}">Написать</a>`
        : '<small>заявка отправлена</small>')).join('');
      return (req ? `<h4 class="sect">Заявки в друзья</h4>${req}` : '')
        + `<h4 class="sect">Мои друзья</h4>`
        + (list || '<div class="card muted">Пока никого. <a href="#/search">Найти друзей</a></div>');
    },
  }),

  user: (arg) => ({
    title: 'Профиль',
    html: '<div id="list"></div>',
    refresh() {
      const me = client.getUserId();
      const id = !arg || arg === 'me' ? me : arg;
      const isMe = id === me;
      if (!this.name) {
        this.name = client.getUser(id)?.displayName || id;
        client.getProfileInfo(id).then((p) => { this.name = p.displayname || id; scheduleRefresh(); }).catch(() => {});
      }
      document.getElementById('title').textContent = isMe ? 'Моя страница' : this.name;
      const f = friends().find((x) => x.id === id);
      const req = friendRequests().find((r) => r.getDMInviter() === id);
      const btn = isMe ? '<a class="btn gray" href="#/settings">Редактировать</a>'
        : f?.status === 'friend' ? `<a class="btn" href="#/chat/${encodeURIComponent(f.room.roomId)}">Написать сообщение</a><small>✓ У вас в друзьях</small>`
        : f?.status === 'sent' ? '<small>Заявка отправлена</small>'
        : req ? `<button class="btn" data-act="acceptfriend" data-id="${esc(req.roomId)}">Принять заявку</button>`
        : `<button class="btn" data-act="addfriend" data-id="${esc(id)}">Добавить в друзья</button>`;
      const room = wallRoom();
      const posts = room ? timeline(room).filter((e) => e.getSender() === id).reverse() : [];
      const nFriends = friends().filter((x) => x.status === 'friend').length;
      return `
        <div class="card profile">${avatar(id, this.name, 'big')}
          <div class="grow"><h2>${esc(this.name)}</h2><small>${esc(id)}</small><div class="pbtns">${btn}</div></div>
        </div>
        ${isMe ? `<a class="card counter" href="#/friends"><b>${nFriends}</b> ${nFriends === 1 ? 'друг' : 'друзей'}</a>` : ''}
        <h4 class="sect">Записи на стене</h4>
        ${posts.map((p) => post(p, true)).join('') || '<div class="card muted">Записей пока нет</div>'}`;
    },
  }),

  radio: () => ({
    title: 'Радио',
    html: '<div id="list"></div>',
    refresh() {
      return STATIONS.map(([name], i) => {
        const on = station === i && !audio.paused;
        return `<button class="row station ${on ? 'on' : ''}" data-act="radio" data-id="${i}">
          <span class="ava" style="background:${COLORS[i % COLORS.length]}">${on ? ICON_PAUSE : ICON_PLAY}</span>
          <div class="grow"><b>${esc(name)}</b><small>${on ? 'Играет' : 'Турция'}</small></div></button>`;
      }).join('') + '<p class="muted pad">Музыка продолжает играть, пока вы переходите по разделам.</p>';
    },
  }),

  search: () => ({
    title: 'Поиск',
    html: `
      <form class="card newchat" data-form="search">
        <input name="text" type="search" autocomplete="off" autocapitalize="off" placeholder="Имя или логин, например yurt02">
        <button class="btn">Найти</button>
      </form>
      <div id="list"></div>`,
    refresh() {
      if (!this.results) return '<p class="muted pad">Введите логин родственника, например <b>yurt02</b>.</p>';
      if (!this.results.length) return '<div class="card muted">Никого не нашли. Проверьте логин.</div>';
      const fr = friends();
      return this.results.map(([id, name]) => {
        const f = fr.find((x) => x.id === id);
        const right = f?.status === 'friend' ? `<a class="btn sm" href="#/chat/${encodeURIComponent(f.room.roomId)}">Написать</a>`
          : f?.status === 'sent' ? '<small>заявка отправлена</small>'
          : `<button class="btn sm" data-act="addfriend" data-id="${esc(id)}">Добавить в друзья</button>`;
        return personRow(id, name, right);
      }).join('');
    },
  }),

  chat: (id) => ({
    title: client.getRoom(id)?.name || 'Чат',
    html: '<div id="list" class="chat"></div>',
    bar: `<div id="replybar" class="replybar" hidden><div class="grow"><b></b><span></span></div><button type="button" data-act="cancelreply">✕</button></div>
      <form class="writebar" data-form="msg"><input name="text" autocomplete="off" enterkeyhint="send" placeholder="Сообщение…"><button aria-label="Отправить">${ICON_SEND}</button></form>`,
    scrollBottom: true,
    refresh() {
      const room = client.getRoom(id);
      if (!room) return '<div class="card muted">Загрузка…</div>';
      const me = client.getUserId();
      const group = room.getJoinedMemberCount() > 2;
      const typing = room.getMembers().filter((m) => m.typing && m.userId !== me);
      setTitle(room.name, typing.length ? (group ? typing.map((m) => m.name).join(', ') + ' печатает…' : 'печатает…') : '');
      const evs = timeline(room);
      const lastIn = [...evs].reverse().find((e) => !e.status);
      if (lastIn && !document.hidden) client.sendReadReceipt(lastIn).catch(() => {});
      // реакции: id сообщения → { эмодзи: [события] }
      const reacts = {};
      for (const e of room.getLiveTimeline().getEvents()) {
        const r = e.getRelation();
        if (e.getType() !== 'm.reaction' || e.isRedacted() || r?.rel_type !== 'm.annotation') continue;
        ((reacts[r.event_id] ||= {})[r.key] ||= []).push(e);
      }
      let html = '<button class="more" data-act="more">Показать раньше</button>', day = '', prev = '';
      for (const ev of evs) {
        const d = dayLabel(ev.getTs());
        if (d !== day) { html += `<div class="day"><span>${d}</span></div>`; day = d; prev = ''; }
        const mine = ev.getSender() === me, first = ev.getSender() !== prev;
        prev = ev.getSender();
        const st = ev.status; // null = доставлено на сервер
        const isNew = this.keys && !this.keys.has(evKey(ev));
        const tick = !mine || st === 'not_sent' ? ''
          : st ? `<i class="tick">${ICON_CLOCK}</i>`
          : room.getUsersReadUpTo(ev).some((u) => u !== me) ? '<i class="tick read">✓✓</i>' : '<i class="tick">✓</i>';
        const replyId = ev.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id;
        const q = replyId && room.findEventById(replyId);
        const quote = replyId ? `<div class="quote" data-act="jump" data-id="${esc(replyId)}"><b>${q ? esc(sender(q)) : 'Сообщение'}</b><span>${q ? esc(plain(q)) : '…'}</span></div>` : '';
        const rx = reacts[ev.getId()];
        const rxHtml = rx ? `<div class="reacts">${Object.entries(rx).map(([k, list]) =>
          `<button class="react ${list.some((x) => x.getSender() === me) ? 'me' : ''}" data-act="react" data-id="${esc(ev.getId())}" data-key="${esc(k)}">${esc(k)}${list.length > 1 ? ' ' + list.length : ''}</button>`).join('')}</div>` : '';
        html += `<div class="bubble ${mine ? 'mine' : ''} ${first ? 'first' : ''} ${isNew ? 'new' : ''} ${st === 'not_sent' ? 'failed' : ''}" data-id="${esc(ev.getId())}">
          ${!mine && first && group ? `<b>${esc(sender(ev))}</b>` : ''}${quote}<span class="text">${body(ev)}</span><small>${hm(ev.getTs())}${tick}</small>
          ${st === 'not_sent' ? `<button class="resend" data-act="resend" data-id="${esc(ev.getId())}">Не отправлено · повторить</button>` : ''}</div>${rxHtml ? `<div class="rxwrap ${mine ? 'mine' : ''}">${rxHtml}</div>` : ''}`;
      }
      if (!evs.length) html += '<p class="muted empty">Сообщений пока нет. Напишите первым!</p>';
      this.keys = new Set(evs.map(evKey));
      return html;
    },
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
      <div class="card">
        <h3>Уведомления и звуки</h3>
        <p class="muted" id="notifstate"></p>
        <p class="muted" id="pushstate"></p>
        <button class="btn" data-act="notify" id="notifbtn">Включить уведомления</button>
        <button class="btn gray" data-act="testpush" id="testbtn" hidden>Прислать тестовое уведомление</button>
        <label class="switch"><input type="checkbox" id="soundtoggle" ${soundOn() ? 'checked' : ''}> Звуки сообщений</label>
      </div>
      <div class="card"><button class="btn gray" data-act="logout">Выйти</button></div>`,
    async after() {
      const st = notifyState();
      const ns = document.getElementById('notifstate');
      ns.textContent = {
        granted: '✅ Уведомления включены — приходят, даже когда «Юрт» закрыт.',
        denied: 'Уведомления запрещены. Включите: Настройки iPhone → Уведомления → Юрт.',
        unsupported: 'Чтобы включить уведомления, добавьте «Юрт» на экран «Домой» и откройте с иконки.',
        default: 'Звук и плашка сверху работают всегда, пока приложение открыто.',
      }[st];
      document.getElementById('notifbtn').hidden = st !== 'default';
      if (st === 'granted') {
        const ps = document.getElementById('pushstate');
        ps.textContent = 'Проверяем рассыльщик…';
        let ok = await pushStatus(client).catch(() => false);
        if (!ok) { await turnOnPush().catch(() => {}); ok = await pushStatus(client).catch(() => false); }
        ps.textContent = ok ? '📡 Телефон подключён к рассыльщику' : '⚠️ Рассыльщик не подключён — нажмите «Включить уведомления» ещё раз';
        document.getElementById('testbtn').hidden = !ok;
        document.getElementById('notifbtn').hidden = ok;
      }
      const ok = await isVerified(client);
      const el = document.getElementById('verified');
      if (el) el.textContent = ok ? '✅ Устройство подтверждено' : '⚠️ Устройство не подтверждено — введите ключ.';
    },
  }),
};

function post(ev, withLink) {
  const n = commentsCount(ev);
  return `<div class="card post">
    <a class="head" href="${userLink(ev.getSender())}">${avatar(ev.getSender(), sender(ev))}<div><b>${esc(sender(ev))}</b><small>${time(ev.getTs())}</small></div></a>
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
  // чат и комментарии — на весь экран: шапка сверху, поле ввода снизу
  document.body.classList.toggle('fullscreen', ['chat', 'post'].includes(name));
  setTitle(view.title);
  const main = document.getElementById('view');
  main.innerHTML = view.html;
  main.scrollTop = 0;
  scrollTo(0, 0);
  document.getElementById('bar').innerHTML = view.bar || '';
  replyTo = null;
  closeSheet();
  document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('sel', a.getAttribute('href') === '#/' + (name || 'wall')));
  refresh(true);
  view.after?.();
}

let timer = null;
let stickBottom = false; // после отправки — прокрутить вниз
function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => refresh(false), 100); }
function refresh(first) {
  const unread = chatRooms().reduce((s, r) => s + r.getUnreadNotificationCount('total'), 0);
  const nReq = friendRequests().length;
  const u = document.getElementById('unread'); if (u) u.textContent = unread || '';
  const rq = document.getElementById('requests'); if (rq) rq.textContent = nReq || '';
  setBadge(unread + nReq);
  const list = document.getElementById('list');
  if (!list || !view?.refresh) return;
  const sc = document.getElementById('view');
  const full = document.body.classList.contains('fullscreen');
  // палец на экране — не перерисовываем, иначе нажатие «проваливается»
  if (touching && !first) { scheduleRefresh(); return; }
  const atBottom = full && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
  const html = view.refresh();
  if (html === view.lastHtml && !first) return;
  view.lastHtml = html;
  list.innerHTML = html;
  if (full && ((view.scrollBottom && (first || atBottom)) || stickBottom)) sc.scrollTop = sc.scrollHeight;
  stickBottom = false;
}

// ---------- действия ----------
const currentRoom = () => (location.hash.startsWith('#/chat/') ? client.getRoom(view_arg()) : wallRoom());
const view_arg = () => decodeURIComponent(location.hash.split('/').slice(2).join('/'));

const actions = {
  login: () => startLogin().catch((e) => showLogin('Не получилось: ' + e.message)),
  menu: () => toggleMenu(!document.body.classList.contains('menu-open')),
  more: async () => {
    const r = currentRoom(); if (!r) return;
    const sc = document.getElementById('view'), h = sc.scrollHeight;
    await client.scrollback(r, 30);
    refresh(false);
    if (document.body.classList.contains('fullscreen')) sc.scrollTop += sc.scrollHeight - h; // остаться на месте
  },
  resend: (el) => {
    const room = client.getRoom(view_arg());
    const ev = room?.getLiveTimeline().getEvents().find((e) => e.getId() === el.dataset.id);
    if (ev) client.resendEvent(ev, room).catch(() => {});
  },
  notify: async () => {
    const st = await askNotify();
    if (st === 'denied') alert('Уведомления запрещены. Включите их: Настройки iPhone → Уведомления → Юрт.');
    try { await turnOnPush(); } catch (e) { alert('Уведомления: ' + e.message); }
    route();
  },
  testpush: async (el) => {
    el.disabled = true;
    try {
      await testPush(PUSH_GATEWAY);
      el.textContent = 'Отправлено! Сверните приложение и подождите 10 секунд';
    } catch (e) { alert('Не получилось: ' + e.message); }
    setTimeout(() => { el.disabled = false; el.textContent = 'Прислать тестовое уведомление'; }, 15000);
  },
  // меню сообщения
  closesheet: () => closeSheet(),
  reply: (el) => {
    closeSheet();
    const ev = findEv(el.dataset.id);
    if (!ev) return;
    replyTo = { id: ev.getId(), name: sender(ev), text: plain(ev) };
    showReply();
    document.querySelector('.writebar input')?.focus();
  },
  cancelreply: () => { replyTo = null; showReply(); },
  copy: (el) => {
    closeSheet();
    const ev = findEv(el.dataset.id);
    if (ev) navigator.clipboard?.writeText(plain(ev)).then(() => toast('Скопировано', ''));
  },
  redact: (el) => {
    closeSheet();
    if (confirm('Удалить сообщение у всех?')) client.redactEvent(view_arg(), el.dataset.id).catch((e) => alert(e.message));
  },
  react: (el) => { closeSheet(); toggleReaction(el.dataset.id, el.dataset.key); },
  jump: (el) => {
    const b = document.querySelector(`.bubble[data-id="${CSS.escape(el.dataset.id)}"]`);
    if (!b) return;
    b.scrollIntoView({ block: 'center', behavior: 'smooth' });
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 1200);
  },
  join: async (el) => { await client.joinRoom(el.dataset.id); await joinSpaceRooms(client); },
  leave: (el) => client.leave(el.dataset.id),
  reload: () => hardReload(),
  radio: (el) => playStation(+el.dataset.id),
  radiotoggle: () => playStation(station),
  radiostop: () => { audio.pause(); audio.removeAttribute('src'); station = null; updatePlayer(); },
  addfriend: async (el) => {
    el.disabled = true;
    el.textContent = 'Отправляем…';
    try { await addFriend(el.dataset.id); el.outerHTML = '<small>заявка отправлена</small>'; }
    catch (e) { el.disabled = false; el.textContent = 'Добавить в друзья'; alert('Не получилось: ' + e.message); }
  },
  acceptfriend: async (el) => {
    const r = client.getRoom(el.dataset.id);
    const inviter = r.getDMInviter();
    el.disabled = true;
    el.textContent = 'Принимаем…';
    await client.joinRoom(r.roomId);
    await rememberDirect(inviter, r.roomId);
    go('#/chat/' + encodeURIComponent(r.roomId));
  },
  logout: () => confirm('Выйти из аккаунта на этом устройстве?') && logout(client),
};

const forms = {
  post: (text) => client.sendTextMessage(wallRoom().roomId, text),
  comment: async (text) => {
    await client.sendMessage(wallRoom().roomId, view_arg(), { msgtype: 'm.text', body: text });
    view.load();
  },
  msg: (text) => {
    const content = { msgtype: 'm.text', body: text };
    if (replyTo) {
      content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.id } };
      replyTo = null;
      showReply();
    }
    return client.sendMessage(view_arg(), content);
  },
  search: async (text) => {
    view.results = await searchPeople(text);
    refresh(false);
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
  // сообщения: поле очищается сразу, сообщение появляется с часиками
  if (['msg', 'comment'].includes(f.dataset.form)) {
    input.value = '';
    sound('send');
    stickBottom = true;
    if (f.dataset.form === 'msg') client.sendTyping(view_arg(), false).catch(() => {});
    forms[f.dataset.form](text).catch((err) => alert('Не отправлено: ' + err.message));
    return;
  }
  const btn = f.querySelector('button'); btn.disabled = true;
  try {
    await forms[f.dataset.form](text);
    if (!['name', 'search'].includes(f.dataset.form)) input.value = '';
  } catch (err) { alert('Не отправлено: ' + err.message); }
  btn.disabled = false;
});

// ---------- ответы, реакции, меню сообщения ----------
let replyTo = null;
const QUICK = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const findEv = (id) => client.getRoom(view_arg())?.findEventById(id);
function showReply() {
  const rb = document.getElementById('replybar');
  if (!rb) return;
  rb.hidden = !replyTo;
  if (replyTo) {
    rb.querySelector('b').textContent = 'Ответ: ' + replyTo.name;
    rb.querySelector('span').textContent = replyTo.text;
  }
}
async function toggleReaction(id, key) {
  const room = client.getRoom(view_arg());
  if (!room) return;
  const me = client.getUserId();
  const mine = room.getLiveTimeline().getEvents().find((e) => e.getType() === 'm.reaction' && !e.isRedacted()
    && e.getSender() === me && e.getRelation()?.event_id === id && e.getRelation()?.key === key);
  try {
    if (mine) await client.redactEvent(room.roomId, mine.getId());
    else {
      sound('send');
      await client.sendEvent(room.roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: id, key } });
    }
  } catch (e) { alert('Не получилось: ' + e.message); }
}
function openMsgMenu(id) {
  const ev = findEv(id);
  if (!ev || ev.status) return;
  const mine = ev.getSender() === client.getUserId();
  closeSheet();
  const d = document.createElement('div');
  d.id = 'sheet';
  d.innerHTML = `<div class="sheet-shade" data-act="closesheet"></div>
    <div class="sheet">
      <div class="quick">${QUICK.map((k) => `<button data-act="react" data-id="${esc(id)}" data-key="${k}">${k}</button>`).join('')}</div>
      <button data-act="reply" data-id="${esc(id)}">Ответить</button>
      <button data-act="copy" data-id="${esc(id)}">Копировать</button>
      ${mine ? `<button class="danger" data-act="redact" data-id="${esc(id)}">Удалить</button>` : ''}
      <button class="cancel" data-act="closesheet">Отмена</button>
    </div>`;
  document.body.append(d);
  requestAnimationFrame(() => d.classList.add('open'));
}
function closeSheet() { document.getElementById('sheet')?.remove(); }

// долгое нажатие на сообщение — меню (на компьютере — правая кнопка мыши)
let lp = null;
document.addEventListener('touchstart', (e) => {
  const b = e.target.closest('.bubble[data-id]');
  if (!b || e.target.closest('[data-act]')) return;
  const t = e.touches[0];
  lp = { x: t.clientX, y: t.clientY, fired: false };
  lp.timer = setTimeout(() => { lp.fired = true; navigator.vibrate?.(10); openMsgMenu(b.dataset.id); }, 450);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!lp) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10) { clearTimeout(lp.timer); lp = null; }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!lp) return;
  clearTimeout(lp.timer);
  if (lp.fired) e.preventDefault(); // чтобы палец не нажал пункт меню при отпускании
  lp = null;
}, { passive: false });
document.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.bubble[data-id]');
  if (b) { e.preventDefault(); openMsgMenu(b.dataset.id); }
});

// касание экрана: пока палец на экране, список не перерисовывается
let touching = false, touchTimer;
addEventListener('touchstart', () => { touching = true; clearTimeout(touchTimer); }, { passive: true, capture: true });
const untouch = () => { clearTimeout(touchTimer); touchTimer = setTimeout(() => { touching = false; }, 400); };
addEventListener('touchend', untouch, { passive: true, capture: true });
addEventListener('touchcancel', untouch, { passive: true, capture: true });

// клавиатура открыта — убираем нижний отступ под «полоску» iPhone
document.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) document.body.classList.add('kb'); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement?.matches?.('input, textarea')) document.body.classList.remove('kb');
}, 50));

// кнопка «отправить» не убирает клавиатуру
document.addEventListener('mousedown', (e) => { if (e.target.closest('.writebar button')) e.preventDefault(); });
document.addEventListener('touchend', (e) => {
  const b = e.target.closest('.writebar button');
  if (b) { e.preventDefault(); b.form.requestSubmit(); }
}, { passive: false });
// «печатает…»
let typingAt = 0;
document.addEventListener('input', (e) => {
  if (!e.target.closest('.writebar[data-form="msg"]') || Date.now() - typingAt < 4000) return;
  typingAt = Date.now();
  client.sendTyping(view_arg(), true, 5000).catch(() => {});
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'soundtoggle') { setSound(e.target.checked); unlockAudio(); sound('in'); }
});
addEventListener('touchstart', unlockAudio, { passive: true });
addEventListener('click', unlockAudio);

// клавиатура iPhone: приложение занимает ровно видимую часть экрана
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const sc = document.getElementById('view');
  const near = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  document.documentElement.style.setProperty('--vh', vv.height + 'px');
  document.documentElement.style.setProperty('--vt', vv.offsetTop + 'px');
  if (near && document.body.classList.contains('fullscreen')) sc.scrollTop = sc.scrollHeight;
}
visualViewport?.addEventListener('resize', fitViewport);
visualViewport?.addEventListener('scroll', fitViewport);
fitViewport();

// ---------- входящие: звук, плашка, уведомление ----------
function onTimeline(ev, room, toStart, removed, data) {
  if (toStart || !data?.liveEvent || !room || ev.getSender() === client.getUserId()) return;
  if (!isMsg(ev) || ev.getTs() < Date.now() - 60000) return;
  const fire = () => incoming(ev, room);
  if (ev.getType() === 'm.room.encrypted' || ev.isBeingDecrypted()) ev.once('Event.decrypted', fire);
  else fire();
}
function incoming(ev, room) {
  if (ev.isDecryptionFailure()) return;
  const wall = room === wallRoom();
  const href = wall ? '#/wall' : '#/chat/' + encodeURIComponent(room.roomId);
  if (!document.hidden && location.hash === href) return sound('soft');
  const name = sender(ev);
  const title = wall ? name + ' · Стена' : room.getJoinedMemberCount() > 2 ? `${name} · ${room.name}` : name;
  const text = ev.getContent().body || '';
  sound('in');
  if (document.hidden) systemNotify(title, text, room.roomId);
  else toast(title, text, href);
}
function onInvite(room, membership, prev) {
  if (membership !== 'invite' || prev === 'invite') return;
  const who = room.getDMInviter();
  const title = who ? 'Новая заявка в друзья' : 'Приглашение: ' + room.name;
  const text = who ? (room.getMember(who)?.name || who) : '';
  sound('in');
  if (document.hidden) systemNotify(title, text, room.roomId);
  else toast(title, text, who ? '#/friends' : '#/chats');
}

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

// ---------- жесты: потянуть вниз — обновить; свайп вбок — меню ----------
const ptr = document.createElement('div');
ptr.className = 'ptr';
ptr.innerHTML = ICON_RELOAD;
document.body.prepend(ptr);
const PULL = 90;
let g = null;
addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  g = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, mode: null, open: document.body.classList.contains('menu-open') };
}, { passive: true });
addEventListener('touchmove', (e) => {
  if (!g) return;
  const t = e.touches[0];
  g.dx = t.clientX - g.x; g.dy = t.clientY - g.y;
  const drawer = document.getElementById('drawer');
  if (!g.mode) {
    if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8) return;
    // меню двигается пальцем только когда открыто (свайп от края — это «назад» самого iPhone)
    if (Math.abs(g.dx) > Math.abs(g.dy)) g.mode = drawer && g.open ? 'menu' : 'none';
    else g.mode = !g.open && g.dy > 0 && scrollY <= 0 && !document.body.classList.contains('fullscreen') ? 'ptr' : 'none';
    if (g.mode === 'menu') document.body.classList.add('dragging');
  }
  if (g.mode === 'menu') {
    const w = drawer.offsetWidth;
    const pos = Math.min(0, Math.max(-w, (g.open ? 0 : -w) + g.dx));
    drawer.style.transform = `translateX(${pos}px)`;
    document.querySelector('.shade').style.opacity = 1 + pos / w;
  } else if (g.mode === 'ptr') {
    const p = Math.min(g.dy * 0.6, PULL + 20);
    ptr.style.transition = 'none';
    ptr.style.transform = `translate(-50%, ${p}px) rotate(${p * 3}deg)`;
    ptr.style.opacity = Math.min(1, p / PULL);
    ptr.classList.toggle('ready', p >= PULL);
  }
}, { passive: true });
addEventListener('touchend', () => {
  if (g?.mode === 'menu') {
    const drawer = document.getElementById('drawer');
    const w = drawer.offsetWidth;
    const pos = (g.open ? 0 : -w) + g.dx;
    document.body.classList.remove('dragging');
    drawer.style.transform = '';
    document.querySelector('.shade').style.opacity = '';
    toggleMenu(pos > -w / 2);
  } else if (g?.mode === 'ptr') {
    ptr.style.transition = '';
    if (ptr.classList.contains('ready')) {
      ptr.classList.add('spin');
      ptr.style.transform = `translate(-50%, ${PULL}px)`;
      hardReload();
    } else { ptr.style.transform = ''; ptr.style.opacity = ''; }
  }
  g = null;
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
  for (const ev of ['Room.timeline', 'Event.decrypted', 'Room', 'Room.myMembership', 'Room.name', 'Room.receipt',
    'Room.localEchoUpdated', 'Room.redaction', 'RoomMember.typing', 'Thread.update', 'Thread.new'])
    client.on(ev, scheduleRefresh);
  client.on('Room.timeline', onTimeline);
  client.on('Room.myMembership', onInvite);
  registerSW();
  turnOnPush().catch((e) => console.warn('push', e)); // обновить подписку при каждом запуске
  client.on('Room.myMembership', () => joinSpaceRooms(client));
  joinSpaceRooms(client);
  layout();
  window.addEventListener('hashchange', route);
  route();
}
boot();
