import './style.css';
import { APP_NAME, WALL_ROOM_NAME, STATIONS } from './config.js';
import { loadSession, startLogin, finishLogin, getAuthResponse, clearSession, redirectUri } from './auth.js';
import { startMatrix, joinSpaceRooms, useRecoveryKey, isVerified, logout } from './matrix.js';
import { unlockAudio, sound, soundOn, setSound, toast, notifyState, askNotify, systemNotify, registerSW, setBadge, enablePush, pushStatus, testPush } from './notify.js';
import { PUSH_GATEWAY, VAPID_PUBLIC, DEVICE_NAME } from './config.js';
import { sendMedia, mediaUrl, prepareImage, videoMeta, record, mb, fmtDur } from './media.js';
import { exportArchive, toMarkdown, download } from './archive.js';
import { QUOTES_ROOM, quotesView, quoteActions, quotesForWall, mixFeed } from './extras/quotes/index.js'; // extras:quotes
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
  if (MEDIA.includes(c.msgtype)) { mediaEvents.set(ev.getId(), c); return mediaHtml(ev.getId(), c); }
  return linkify(esc(stripReply(c.body)));
}
// ---------- медиа в сообщениях ----------
const MEDIA = ['m.image', 'm.video', 'm.audio', 'm.file'];
const mediaEvents = new Map(); // id события → содержимое (для загрузки и расшифровки)
function mediaHtml(id, c) {
  const i = c.info || {};
  const ar = i.w && i.h ? `aspect-ratio:${i.w}/${i.h}` : '';
  const a = esc(id);
  if (c.msgtype === 'm.image') return `<img class="photo" data-media="${a}" data-act="photo" alt="" style="${ar}">`;
  // без переносов строк внутри: в пузыре включено «сохранять переводы строк», они сдвигали видео
  if (c.msgtype === 'm.video' && c['yurt.round']) return `<div class="roundwrap" data-act="playvideo">`
    + `<video class="round" data-media="${a}" playsinline preload="metadata"></video>`
    + `<span class="playicon">${ICON_PLAY}</span><small class="dur">${fmtDur(i.duration)}</small></div>`;
  if (c.msgtype === 'm.video') return `<video class="video" data-media="${a}" playsinline controls preload="metadata" style="${ar}"></video>`;
  if (c.msgtype === 'm.audio') return `<div class="voice" data-media="${a}"><button data-act="voice" aria-label="Слушать">${ICON_PLAY}</button>`
    + `<div class="wave"><i></i></div><small>${fmtDur(i.duration)}</small></div>`;
  return `<button class="file" data-act="openfile" data-media="${a}"><span class="ficon">📎</span>`
    + `<span class="grow"><b>${esc(c.body)}</b><small>${i.size ? mb(i.size) : ''}</small></span></button>`;
}
// ссылки кликабельны (без превью: в зашифрованных чатах превью выключены ради приватности)
const linkify = (html) => html.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)"'»]/g,
  (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
// старые клиенты добавляют к ответу цитату строками «> …» — убираем её, цитату рисуем сами
function stripReply(s) {
  if (!s?.startsWith('> ')) return s;
  const lines = s.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('>')) i++;
  if (lines[i] === '') i++;
  return lines.slice(i).join('\n');
}
// короткий текст сообщения: для цитат, списка чатов, уведомлений
function plain(ev) {
  if (ev.isDecryptionFailure()) return '🔒 сообщение';
  const c = ev.getContent();
  if (c['yurt.round']) return '🎥 Видео-кружок';
  return { 'm.image': '📷 Фото', 'm.video': '🎥 Видео', 'm.audio': '🎤 Голосовое', 'm.file': '📎 ' + (c.body || 'Файл') }[c.msgtype]
    || stripReply(c.body || '');
}
const sender = (ev) => ev.sender?.name || ev.getSender();
const wallRoom = () => client.getRooms().find((r) => r.getMyMembership() === 'join' && r.name === WALL_ROOM_NAME);
const chatRooms = () => client.getRooms()
  .filter((r) => r.getMyMembership() === 'join' && !r.isSpaceRoom() && r.name !== WALL_ROOM_NAME)
  .filter((r) => r.name !== QUOTES_ROOM) // extras:quotes
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
      <a href="#/quotes">Цитаты</a><!-- extras:quotes -->
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
const ICON_CLIP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4L15 6.8"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
const ICON_CLOCK ='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

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
    tryPlay();
  }
  updatePlayer();
}
// iPhone прерывает play(), если звук был у другого плеера, — пробуем ещё раз
async function tryPlay(retries = 3) {
  try { await audio.play(); }
  catch (e) {
    if (e.name === 'AbortError' && retries) { await new Promise((r) => setTimeout(r, 500)); return tryPlay(retries - 1); }
    if (e.name === 'AbortError') return;
    toast('Радио не играет', e.name === 'NotAllowedError' ? 'Нажмите ▶ ещё раз' : 'Станция недоступна — попробуйте другую');
  }
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
audio.addEventListener('error', () => { if (station !== null) toast('Станция недоступна', 'Попробуйте другую или позже'); });

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
      let feed = room ? timeline(room).reverse().map((ev) => post(ev, true)) : [];
      feed = mixFeed(feed, quotesForWall(qctx)); // extras:quotes
      const note = room ? '' : `<div class="card muted">Комната «${esc(WALL_ROOM_NAME)}» не найдена. Попросите, чтобы вас пригласили в пространство семьи.</div>`;
      return note + (feed.join('') || (room ? '<div class="card muted">Пока пусто. Напишите первый пост!</div>' : ''));
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
      <form class="writebar" data-form="msg">
        <button type="button" class="wb attach" data-act="attach" aria-label="Прикрепить">${ICON_CLIP}</button>
        <input name="text" autocomplete="off" enterkeyhint="send" placeholder="Сообщение…">
        <div class="recinfo"><span class="dot"></span><b>0:00</b><span class="hint">‹ влево — отмена</span></div>
        <button type="button" class="wb mic" aria-label="Голосовое (удерживайте)">${ICON_MIC}</button>
        <button class="send" aria-label="Отправить">${ICON_SEND}</button>
      </form>`,
    scrollBottom: true,
    patch: true,
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
      let html = '<button class="more" data-key="more" data-act="more">Показать раньше</button>', day = '', prev = '';
      for (const ev of evs) {
        const d = dayLabel(ev.getTs());
        if (d !== day) { html += `<div class="day" data-key="d-${esc(d)}"><span>${d}</span></div>`; day = d; prev = ''; }
        const mine = ev.getSender() === me, first = ev.getSender() !== prev;
        prev = ev.getSender();
        const st = ev.status; // null = доставлено на сервер
        const isNew = this.keys && !this.keys.has(evKey(ev));
        const tick = !mine || st === 'not_sent' ? ''
          : st ? `<i class="tick">${ICON_CLOCK}</i>`
          : room.getUsersReadUpTo(ev).some((u) => u !== me) ? '<i class="tick read">✓✓</i>' : '<i class="tick">✓</i>';
        // в зашифрованных чатах ссылка на ответ лежит в незашифрованной «обёртке» события
        const replyId = ev.replyEventId || ev.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id;
        const q = replyId && room.findEventById(replyId);
        const quote = replyId ? `<div class="quote" data-act="jump" data-id="${esc(replyId)}"><b>${q ? esc(sender(q)) : 'Сообщение'}</b><span>${q ? esc(plain(q)) : '…'}</span></div>` : '';
        const rx = reacts[ev.getId()];
        const rxHtml = rx ? `<div class="reacts">${Object.entries(rx).map(([k, list]) =>
          `<button class="react ${list.some((x) => x.getSender() === me) ? 'me' : ''}" data-act="react" data-id="${esc(ev.getId())}" data-key="${esc(k)}">${esc(k)}${list.length > 1 ? ' ' + list.length : ''}</button>`).join('')}</div>` : '';
        const media = MEDIA.includes(ev.getContent().msgtype) ? 'media' : '';
        html += `<div class="msg ${mine ? 'mine' : ''}" data-key="${esc(evKey(ev))}">
          <div class="bubble ${mine ? 'mine' : ''} ${first ? 'first' : ''} ${isNew ? 'new' : ''} ${media} ${st === 'not_sent' ? 'failed' : ''}" data-id="${esc(ev.getId())}">
          ${!mine && first && group ? `<b>${esc(sender(ev))}</b>` : ''}${quote}<span class="text">${body(ev)}</span><small>${hm(ev.getTs())}${tick}</small>
          ${st === 'not_sent' ? `<button class="resend" data-act="resend" data-id="${esc(ev.getId())}">Не отправлено · повторить</button>` : ''}</div>${rxHtml ? `<div class="rxwrap">${rxHtml}</div>` : ''}</div>`;
      }
      for (const [k, u] of uploads) {
        if (u.roomId !== id) continue;
        html += `<div class="msg mine" data-key="up-${k}"><div class="bubble mine upload"><span class="text">${esc(u.label)}</span>
          <div class="prog"><i style="width:${Math.round(u.p * 100)}%"></i></div></div></div>`;
      }
      if (!evs.length && !uploads.size) html += '<p class="muted empty" data-key="empty">Сообщений пока нет. Напишите первым!</p>';
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
      <div class="card">
        <h3>Архив переписок</h3>
        <p class="muted">Скачать все чаты в расшифрованном виде: файл для программ (.json) и текст для чтения (.md).
          Удобнее делать на компьютере. ⚠️ Файл без шифрования — храните его у себя, не выкладывайте в интернет.</p>
        <p class="muted" id="archstate"></p>
        <button class="btn" data-act="archive">Скачать архив</button>
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

const qctx = { get client() { return client; }, esc, toast, sound, pickFiles, rerender: () => { if (view) view.lastHtml = null; refresh(false); } }; // extras:quotes
views.quotes = (arg) => quotesView(qctx, arg); // extras:quotes

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
  closeRound();
  document.getElementById('viewer')?.remove();
  document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('sel', a.getAttribute('href') === '#/' + (name || 'wall')));
  refresh(true);
  view.after?.();
}

// Обновляем только изменившиеся сообщения: играющее голосовое или видео не прерывается
function patchList(list, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const old = new Map();
  for (const n of list.children) if (n.dataset.key) old.set(n.dataset.key, n);
  const next = [...tmp.children].map((n) => {
    const o = n.dataset.key && old.get(n.dataset.key);
    if (o && o._src === n.outerHTML) return o;
    n._src = n.outerHTML;
    return n;
  });
  list.replaceChildren(...next);
}
// подгрузка фото/видео/голосовых (расшифровка при необходимости)
function hydrate(root) {
  for (const el of root.querySelectorAll('[data-media]:not([data-ready])')) {
    el.dataset.ready = '1';
    const c = mediaEvents.get(el.dataset.media);
    if (!c || el.classList.contains('file')) continue;
    mediaUrl(client, c).then((url) => {
      if (!el.classList.contains('voice')) {
        el.src = el.tagName === 'VIDEO' ? url + '#t=0.1' : url;
        if (el.classList.contains('round')) el.onended = () => el.parentElement?.classList.remove('playing'); // сыграл один раз
        return;
      }
      const a = new Audio(url);
      el._audio = a;
      const bar = el.querySelector('.wave i'), t = el.querySelector('small'), btn = el.querySelector('button');
      const total = () => (isFinite(a.duration) && a.duration ? a.duration : (c.info?.duration || 1000) / 1000);
      a.ontimeupdate = () => { bar.style.width = Math.min(100, (a.currentTime / total()) * 100) + '%'; t.textContent = fmtDur(a.currentTime * 1000); };
      a.onplay = () => { btn.innerHTML = ICON_PAUSE; };
      a.onpause = () => { btn.innerHTML = ICON_PLAY; };
      a.onended = () => { btn.innerHTML = ICON_PLAY; bar.style.width = '0'; t.textContent = fmtDur(c.info?.duration); };
    }).catch(() => el.classList.add('broken'));
  }
}
// перед воспроизведением — остановить всё остальное (и радио)
function pauseAllMedia(except) {
  if (!audio.paused) audio.pause();
  document.querySelectorAll('video').forEach((v) => { if (v !== except && !v.srcObject) v.pause(); });
  document.querySelectorAll('.voice').forEach((v) => { if (v._audio && v._audio !== except) v._audio.pause(); });
  document.querySelectorAll('.roundwrap.playing').forEach((w) => { if (w.querySelector('video') !== except) w.classList.remove('playing'); });
}

// ---------- отправка медиа ----------
const uploads = new Map(); // идущие загрузки: показываем в чате с полоской прогресса
let upSeq = 0;
async function upload(roomId, spec, label) {
  const k = ++upSeq;
  uploads.set(k, { roomId, label, p: 0 });
  stickBottom = true;
  scheduleRefresh();
  try {
    await sendMedia(client, roomId, spec, (p) => { const u = uploads.get(k); if (u) { u.p = p; scheduleRefresh(); } });
    sound('send');
  } catch (e) { alert('Не отправлено: ' + e.message); }
  finally { uploads.delete(k); scheduleRefresh(); }
}
// iPhone не сообщает о выбранном файле, если поле выбора не добавлено на страницу
function pickFiles(accept, cb) {
  const i = document.createElement('input');
  i.type = 'file';
  if (accept) i.accept = accept;
  i.style.display = 'none';
  document.body.append(i);
  i.addEventListener('change', async () => {
    const f = i.files[0];
    i.remove();
    if (!f) return;
    try { await cb(f); } catch (e) { alert('Не отправлено: ' + e.message); }
  });
  i.click();
}
async function onPickedMedia(file) {
  const roomId = view_arg();
  if (file.type.startsWith('image/')) {
    const { blob, w, h } = await prepareImage(file).catch(() => ({ blob: file, w: 0, h: 0 }));
    upload(roomId, { blob, msgtype: 'm.image', name: file.type === 'image/gif' ? file.name : 'photo.jpg', info: w ? { w, h } : {} }, '📷 Фото');
  } else if (file.type.startsWith('video/')) {
    upload(roomId, { blob: file, msgtype: 'm.video', name: file.name || 'video.mp4', info: await videoMeta(file) }, '🎥 Видео · ' + mb(file.size));
  } else onPickedFile(file);
}
function onPickedFile(file) {
  upload(view_arg(), { blob: file, msgtype: 'm.file', name: file.name || 'file' }, '📎 ' + (file.name || 'Файл'));
}
function openViewer(src) {
  const d = document.createElement('div');
  d.id = 'viewer';
  d.dataset.act = 'closeviewer';
  d.innerHTML = `<img src="${esc(src)}" alt="">`;
  document.body.append(d);
}

// голосовое: удерживать 🎤, отпустить — отправить, увести влево — отмена
let voiceRec = null;
document.addEventListener('pointerdown', async (e) => {
  const btn = e.target.closest('.writebar .mic');
  if (!btn) return;
  e.preventDefault();
  const s = voiceRec = { x: e.clientX, cancel: false, btn, pending: true };
  try { btn.setPointerCapture(e.pointerId); } catch {}
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { voiceRec = null; return toast('Нет доступа к микрофону', 'Разрешите микрофон для «Юрт»'); }
  if (voiceRec !== s) { stream.getTracks().forEach((t) => t.stop()); return toast('Удерживайте 🎤', 'Запись идёт, пока палец на кнопке'); }
  pauseAllMedia();
  s.stream = stream;
  s.rec = record(stream, ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'], { audioBitsPerSecond: 48000 });
  s.pending = false;
  const wb = btn.closest('.writebar');
  wb.classList.add('recording');
  s.timer = setInterval(() => {
    const t = Date.now() - s.rec.started;
    wb.querySelector('.recinfo b').textContent = fmtDur(t);
    if (t > 5 * 60000) finishVoice(true);
  }, 200);
  navigator.vibrate?.(15);
});
document.addEventListener('pointermove', (e) => {
  if (!voiceRec || voiceRec.pending) return;
  voiceRec.cancel = e.clientX - voiceRec.x < -80;
  voiceRec.btn.closest('.writebar')?.classList.toggle('cancel', voiceRec.cancel);
});
document.addEventListener('pointerup', () => { if (voiceRec) finishVoice(!voiceRec.cancel); });
document.addEventListener('pointercancel', () => { if (voiceRec) finishVoice(false); });
async function finishVoice(send) {
  const s = voiceRec;
  voiceRec = null;
  if (!s || s.pending) return;
  clearInterval(s.timer);
  s.btn.closest('.writebar')?.classList.remove('recording', 'cancel');
  const r = await s.rec.stop(send);
  s.stream.getTracks().forEach((t) => t.stop());
  if (!r) return;
  if (r.duration < 800) return toast('Слишком коротко', 'Удерживайте 🎤 и говорите');
  upload(view_arg(), {
    blob: r.blob, msgtype: 'm.audio', name: 'voice.' + (r.blob.type.includes('mp4') ? 'm4a' : 'webm'),
    info: { duration: r.duration },
    extra: { 'org.matrix.msc3245.voice': {}, 'org.matrix.msc1767.audio': { duration: r.duration } },
  }, '🎤 Голосовое');
}

// видео-кружок: превью с фронтальной камеры, до 1 минуты, сжатое качество
let round = null;
async function openRound() {
  const ov = document.createElement('div');
  ov.id = 'recorder';
  ov.innerHTML = `<div class="rec-circle"><video autoplay playsinline muted></video>
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg></div>
    <div class="rec-time">до 1 минуты</div>
    <div class="rec-btns">
      <button class="rec-side" data-act="roundcancel"><span>✕</span>Отмена</button>
      <button class="rec-main" data-act="roundrec"><i></i><span class="rec-label">Начать</span></button>
      <button class="rec-side" data-act="roundflip"><span>⟲</span>Камера</button>
    </div>`;
  document.body.append(ov);
  round = { ov, facing: 'user' };
  await openCam(round);
}
// включить камеру (фронтальную или основную)
async function openCam(r) {
  r.stream?.getTracks().forEach((t) => t.stop());
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: r.facing, width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
    if (round !== r) return stream.getTracks().forEach((t) => t.stop());
    r.stream = stream;
    r.ov.querySelector('video').srcObject = stream;
    r.ov.classList.toggle('back', r.facing === 'environment');
    pauseAllMedia();
  } catch { closeRound(); toast('Нет доступа к камере', 'Разрешите камеру и микрофон для «Юрт»'); }
}
function toggleRoundRec() {
  if (!round?.stream) return;
  if (round.rec) return finishRound();
  const r = round;
  r.rec = record(r.stream, ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'], { videoBitsPerSecond: 800000, audioBitsPerSecond: 64000 });
  r.ov.classList.add('recording');
  r.ov.querySelector('.rec-label').textContent = 'Отправить';
  r.timer = setInterval(() => {
    const t = Date.now() - r.rec.started;
    r.ov.querySelector('.rec-time').textContent = fmtDur(t) + ' / 1:00';
    r.ov.querySelector('circle').style.strokeDashoffset = 301.6 * (1 - Math.min(1, t / 60000));
    if (t >= 60000 && round === r) finishRound();
  }, 200);
}
async function finishRound() {
  const r = round;
  round = null;
  clearInterval(r.timer);
  const set = r.stream.getVideoTracks()[0]?.getSettings() || {};
  r.ov.classList.add('sending');
  const res = await r.rec.stop(true);
  r.stream.getTracks().forEach((t) => t.stop());
  r.ov.remove();
  if (!res || res.duration < 1000) return;
  upload(view_arg(), {
    blob: res.blob, msgtype: 'm.video', name: 'round.' + (res.blob.type.includes('mp4') ? 'mp4' : 'webm'),
    info: { duration: res.duration, w: set.width || 480, h: set.height || 480 }, extra: { 'yurt.round': true },
  }, '🎥 Видео-кружок');
}
function closeRound() {
  const r = round;
  round = null;
  document.getElementById('recorder')?.remove();
  if (!r) return;
  clearInterval(r.timer);
  r.rec?.stop(false);
  r.stream?.getTracks().forEach((t) => t.stop());
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
  if (view.patch) patchList(list, html); else list.innerHTML = html;
  hydrate(list);
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
  archive: async (el) => {
    const st = document.getElementById('archstate');
    el.disabled = true;
    try {
      const a = await exportArchive(client, (t) => { st.textContent = t; });
      const day = new Date().toISOString().slice(0, 10);
      download(`yurt-archive-${day}.json`, JSON.stringify(a, null, 2), 'application/json');
      setTimeout(() => download(`yurt-archive-${day}.md`, toMarkdown(a), 'text/markdown'), 800);
      const n = a.rooms.reduce((s, r) => s + r.messages.length, 0);
      st.textContent = `✅ Готово: ${a.rooms.length} чатов, ${n} сообщений`;
    } catch (e) { st.textContent = '⚠️ Ошибка: ' + e.message; }
    el.disabled = false;
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
  // медиа
  attach: () => openSheet(`
    <button data-act="pickmedia">📷 Фото или видео</button>
    <button data-act="round">🎥 Видео-кружок</button>
    <button data-act="pickfile">📎 Файл</button>
    <button class="cancel" data-act="closesheet">Отмена</button>`),
  pickmedia: () => { closeSheet(); pickFiles('image/*,video/*', onPickedMedia); },
  pickfile: () => { closeSheet(); pickFiles('', onPickedFile); },
  round: () => { closeSheet(); openRound(); },
  roundrec: () => toggleRoundRec(),
  roundcancel: () => closeRound(),
  roundflip: () => {
    if (!round?.stream || round.rec) return; // во время записи камеру не меняем
    round.facing = round.facing === 'user' ? 'environment' : 'user';
    openCam(round);
  },
  voice: (el) => {
    const a = el.closest('.voice')?._audio;
    if (!a) return;
    if (a.paused) { pauseAllMedia(a); a.play(); } else a.pause();
  },
  playvideo: (el) => {
    const v = el.querySelector('video');
    if (!v?.src) return;
    if (v.paused || v.muted) { pauseAllMedia(v); v.muted = false; v.play(); el.classList.add('playing'); }
    else { v.pause(); el.classList.remove('playing'); }
  },
  photo: (el) => { if (el.src) openViewer(el.src); },
  closeviewer: () => document.getElementById('viewer')?.remove(),
  openfile: async (el) => {
    const c = mediaEvents.get(el.dataset.media);
    if (!c) return;
    el.classList.add('loading');
    try {
      const a = document.createElement('a');
      a.href = await mediaUrl(client, c);
      a.download = c.body || 'file';
      document.body.append(a); a.click(); a.remove();
    } catch (e) { alert('Не удалось скачать: ' + e.message); }
    el.classList.remove('loading');
  },
  reply: (el) => { closeSheet(); startReply(el.dataset.id); },
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
  reload: async (el) => {
    el.classList.add('spin');
    await softRefresh();
    setTimeout(() => el.classList.remove('spin'), 400);
  },
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

Object.assign(actions, quoteActions(qctx)); // extras:quotes

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
    f.classList.remove('has-text');
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
function startReply(id) {
  const ev = findEv(id);
  if (!ev || ev.status) return;
  replyTo = { id: ev.getId(), name: sender(ev), text: plain(ev) };
  showReply();
  document.querySelector('.writebar input')?.focus();
}
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
  openSheet(`
      <div class="quick">${QUICK.map((k) => `<button data-act="react" data-id="${esc(id)}" data-key="${k}">${k}</button>`).join('')}</div>
      <button data-act="reply" data-id="${esc(id)}">Ответить</button>
      <button data-act="copy" data-id="${esc(id)}">Копировать</button>
      ${mine ? `<button class="danger" data-act="redact" data-id="${esc(id)}">Удалить</button>` : ''}
      <button class="cancel" data-act="closesheet">Отмена</button>`);
}
function openSheet(inner) {
  closeSheet();
  const d = document.createElement('div');
  d.id = 'sheet';
  d.innerHTML = `<div class="sheet-shade" data-act="closesheet"></div><div class="sheet">${inner}</div>`;
  document.body.append(d);
  requestAnimationFrame(() => d.classList.add('open'));
}
function closeSheet() { document.getElementById('sheet')?.remove(); }

// сообщение: долгое нажатие — меню; свайп вправо — ответить (на компьютере — правая кнопка мыши)
let lp = null;
document.addEventListener('touchstart', (e) => {
  const b = e.target.closest('.bubble[data-id]');
  if (!b || e.target.closest('button, a, video[controls], .roundwrap')) return;
  const t = e.touches[0];
  lp = { b, x: t.clientX, y: t.clientY, fired: false, swipe: false, dx: 0 };
  lp.timer = setTimeout(() => { lp.fired = true; navigator.vibrate?.(10); openMsgMenu(b.dataset.id); }, 450);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!lp) return;
  const t = e.touches[0];
  const dx = t.clientX - lp.x, dy = t.clientY - lp.y;
  if (!lp.swipe && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    clearTimeout(lp.timer);
    if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5) lp.swipe = true;
    else { lp = null; return; }
  }
  if (lp.swipe) {
    lp.dx = Math.max(0, Math.min(dx, 80));
    lp.b.style.transition = 'none';
    lp.b.style.transform = `translateX(${lp.dx}px)`;
    lp.b.classList.toggle('swipe-ready', lp.dx >= 55);
  }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!lp) return;
  clearTimeout(lp.timer);
  if (lp.fired) e.preventDefault(); // чтобы палец не нажал пункт меню при отпускании
  if (lp.swipe) {
    lp.b.style.transition = '';
    lp.b.style.transform = '';
    lp.b.classList.remove('swipe-ready');
    if (lp.dx >= 55) { navigator.vibrate?.(10); startReply(lp.b.dataset.id); }
  }
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
  const b = e.target.closest('.writebar button:not([type=button])');
  if (b) { e.preventDefault(); b.form.requestSubmit(); }
}, { passive: false });
// есть текст — кнопка «отправить», нет — микрофон
document.addEventListener('input', (e) => {
  const wb = e.target.closest('.writebar');
  if (wb) wb.classList.toggle('has-text', !!e.target.value.trim());
});
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
  const text = plain(ev);
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
async function hasUpdate() {
  try {
    const html = await (await fetch('./?v=' + Date.now(), { cache: 'no-store' })).text();
    const fresh = html.match(/assets\/yurt-[\w-]+\.js/)?.[0];
    const mine = document.querySelector('script[src*="assets/yurt-"]')?.getAttribute('src');
    return !!(fresh && mine && !mine.includes(fresh));
  } catch { return false; }
}
// сама проверка новой версии: пока играет радио — не перезагружаемся
async function checkUpdate() { if (audio.paused && await hasUpdate()) hardReload(); }
// перезагрузка мимо кэша телефона
function hardReload() { location.replace(location.pathname + '?r=' + Date.now() + location.hash); }
if (new URLSearchParams(location.search).has('r')) history.replaceState(null, '', location.pathname + location.hash);
// ↻ и «потянуть вниз»: если вышла новая версия — перезагрузка, иначе просто свежие данные (радио не прерывается)
async function softRefresh() {
  if (!client || await hasUpdate()) return hardReload();
  client.retryImmediately();
  view?.load?.();
  if (view) view.lastHtml = null;
  refresh(true);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  client?.retryImmediately(); // вернулись в приложение — сразу забираем новые сообщения
  checkUpdate();
});
addEventListener('online', () => client?.retryImmediately());
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
      softRefresh().finally(() => setTimeout(() => {
        ptr.classList.remove('spin', 'ready');
        ptr.style.transform = ''; ptr.style.opacity = '';
      }, 600));
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
