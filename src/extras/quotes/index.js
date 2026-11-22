// Группа «Цитаты» — отдельный модуль. Как удалить — см. README.md рядом.
// Записи хранятся НЕ в коде (репозиторий публичный), а в личной зашифрованной
// комнате Matrix «Цитаты». Лайк = реакция ❤️, «Мне понравилось» = мои ❤️.

import './style.css';

export const QUOTES_ROOM = 'Цитаты';
const HEART = '❤️';
const LS = 'yurt.quotes.carousel';

export const quotesRoom = (client) =>
  client.getRooms().find((r) => r.getMyMembership() === 'join' && r.name === QUOTES_ROOM);

// ---------- разбор заметок .md: «## Раздел», «### Запись» ----------
export function parseNotes(md) {
  const out = [];
  let section = '', cur = null;
  const push = () => { if (cur?.text.trim()) out.push({ ...cur, text: cur.text.trim() }); cur = null; };
  for (const line of md.split('\n')) {
    const h3 = line.match(/^###\s+(.+)/);
    const h2 = !h3 && line.match(/^##\s+(?:\d+\.\s*)?(.+)/);
    if (h3) { push(); cur = { section, title: h3[1].trim(), text: '' }; }
    else if (h2) { push(); section = h2[1].trim(); cur = { section, title: section, text: '' }; }
    else if (cur && !/^---\s*$/.test(line)) cur.text += line + '\n';
  }
  push();
  return out.filter((e) => e.section && e.section !== 'Содержание');
}
const keyOf = (e) => `${e.section}::${e.title}`;

// ---------- записи и лайки из комнаты ----------
function posts(room) {
  return room.getLiveTimeline().getEvents()
    .filter((e) => !e.isRedacted() && e.getContent()['yurt.quote'])
    .map((e) => ({ ev: e, ...e.getContent()['yurt.quote'] }));
}
function myHearts(room, me) {
  const m = new Map(); // id события → моя реакция
  for (const e of room.getLiveTimeline().getEvents()) {
    const r = e.getRelation();
    if (e.getType() === 'm.reaction' && !e.isRedacted() && e.getSender() === me && r?.key === HEART) m.set(r.event_id, e);
  }
  return m;
}

// ---------- импорт ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ensureRoom(client) {
  let room = quotesRoom(client);
  if (room) return room;
  const { room_id } = await client.createRoom({
    name: QUOTES_ROOM, topic: 'Цитаты и заметки', preset: 'private_chat', visibility: 'private',
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });
  for (let i = 0; i < 40 && !(room = client.getRoom(room_id)); i++) await sleep(250);
  return room;
}
async function importNotes(client, entries, onProgress) {
  const room = await ensureRoom(client);
  while (await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 100 })) { /* вся история */ }
  const have = new Set(posts(room).map((p) => p.id));
  const todo = entries.filter((e) => !have.has(keyOf(e)));
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    onProgress(i + 1, todo.length);
    const content = { msgtype: 'm.text', body: `${e.title}\n\n${e.text}`, 'yurt.quote': { id: keyOf(e), section: e.section, title: e.title, text: e.text } };
    for (;;) {
      try { await client.sendMessage(room.roomId, content); break; }
      catch (err) { if (err.errcode !== 'M_LIMIT_EXCEEDED') throw err; await sleep(err.data?.retry_after_ms || 3000); }
    }
    await sleep(200);
  }
  return todo.length;
}

// ---------- карусель без повторов: перемешанный порядок, позиция запоминается ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, seed) { const a = [...arr], r = rng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const loadPos = () => { try { return JSON.parse(localStorage.getItem(LS)) || { seed: 1, pos: 0 }; } catch { return { seed: 1, pos: 0 }; } };
const savePos = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };
function carouselItem(list, step = 0) {
  if (!list.length) return null;
  const s = loadPos();
  s.pos += step;
  if (s.pos >= list.length) { s.pos = 0; s.seed++; } // все показаны — новый круг, новый порядок
  if (s.pos < 0) s.pos = list.length - 1;
  savePos(s);
  const order = shuffled([...list].sort((a, b) => a.id.localeCompare(b.id)), s.seed);
  return { item: order[s.pos], n: s.pos + 1, total: list.length };
}
// «Цитаты» в карусели — только раздел с цитатами (если есть), иначе всё
const carouselPool = (all) => { const q = all.filter((p) => /^цитат/i.test(p.section)); return q.length ? q : all; };

// ---------- мини-markdown: цитаты «>», списки, **жирный**, *курсив*, таблицы ----------
function md(text, esc) {
  const inl = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  let html = '', quote = [], list = [];
  const flush = () => {
    if (quote.length) { html += `<blockquote>${inl(quote.join('<br>'))}</blockquote>`; quote = []; }
    if (list.length) { html += `<ul>${list.map((l) => `<li>${inl(l)}</li>`).join('')}</ul>`; list = []; }
  };
  for (const raw of text.split('\n')) {
    const line = esc(raw);
    if (/^&gt;/.test(line)) { if (list.length) flush(); quote.push(line.replace(/^&gt;\s?/, '')); continue; }
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(?:\[ \]\s*)?(.+)/);
    if (li) { if (quote.length) flush(); list.push(li[1]); continue; }
    if (/^\|[-\s|]+\|$/.test(line)) continue; // разделитель таблицы
    flush();
    if (/^\|/.test(line)) { html += `<p class="qrow">${inl(line.split('|').slice(1, -1).map((c) => c.trim()).join(' — '))}</p>`; continue; }
    if (line.trim()) html += `<p>${inl(line)}</p>`;
  }
  flush();
  return html;
}

// ---------- карточки ----------
function card(p, liked, esc, full = true) {
  return `<div class="card qpost">
    <div class="qsec">${esc(p.section)}</div>
    ${p.title !== p.section ? `<h4>${esc(p.title)}</h4>` : ''}
    <div class="qtext ${full ? '' : 'short'}">${md(p.text, esc)}</div>
    <button class="qlike ${liked ? 'on' : ''}" data-act="qlike" data-id="${esc(p.ev.getId())}">${liked ? '❤️' : '🤍'} Мне нравится</button>
  </div>`;
}

// цитаты для ленты Стены (новый порядок каждый день)
export function quotesForWall(ctx, limit = 12) {
  const room = quotesRoom(ctx.client);
  if (!room) return [`<a class="card qday" href="#/quotes"><div class="qsec">❝ Группа «${QUOTES_ROOM}»</div>
    <div>Загрузите свои цитаты и заметки — они появятся здесь, на Стене.</div></a>`];
  const hearts = myHearts(room, ctx.client.getUserId());
  const day = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  return shuffled(posts(room), day + 7).slice(0, limit).map((p) =>
    `<div class="qwall"><a class="qfrom" href="#/quotes"><span class="qava sm">❝</span>${QUOTES_ROOM}</a>${card(p, hearts.has(p.ev.getId()), ctx.esc)}</div>`);
}
// посты Стены вперемешку с цитатами: после каждых двух постов — цитата
export function mixFeed(posts, quotes) {
  const out = [];
  let q = 0;
  posts.forEach((p, i) => { out.push(p); if (i % 2 === 1 && q < quotes.length) out.push(quotes[q++]); });
  return out.concat(quotes.slice(q));
}

// «Цитата дня» вверху Стены
export function quoteOfDay(ctx) {
  const room = quotesRoom(ctx.client);
  if (!room) return '';
  const c = carouselItem(carouselPool(posts(room)));
  if (!c) return '';
  return `<a class="card qday" href="#/quotes"><div class="qsec">❝ Цитата · группа «${QUOTES_ROOM}»</div>
    <div class="qtext short">${md(c.item.text, ctx.esc)}</div></a>`;
}

// ---------- экран группы ----------
let current = null; // открытый экран (для поиска и карусели)
let auto = null;

export function quotesView(ctx, tab) {
  const v = {
    title: QUOTES_ROOM,
    // поиск вне перерисовываемого списка — чтобы клавиатура не закрывалась
    html: `<input class="qsearch" type="search" placeholder="🔍 Поиск по записям"><div id="list"></div>`,
    ctx,
    limit: 15,
    q: '',
    refresh() {
      const { client, esc } = ctx;
      const room = quotesRoom(client);
      const head = (n) => `<div class="card qhead"><span class="qava">❝</span><div class="grow"><h2>${QUOTES_ROOM}</h2>
        <small>Личная группа · ${n} записей · видна только вам</small></div></div>`;
      if (!room) {
        return head(0) + `<div class="card"><p>Здесь будут ваши цитаты и заметки. Загрузите файл заметок (.md):
          разделы «## …» и записи «### …» станут постами группы.</p>
          <p class="muted" id="qprog">Записи хранятся в вашей личной зашифрованной комнате, а не на сайте.</p>
          <button class="btn" data-act="quotesimport">Загрузить заметки (.md)</button></div>`;
      }
      const all = posts(room);
      const hearts = myHearts(room, client.getUserId());
      const c = carouselItem(carouselPool(all));
      const tabs = `<div class="qtabs"><a href="#/quotes" class="${tab !== 'fav' ? 'on' : ''}">Записи</a>
        <a href="#/quotes/fav" class="${tab === 'fav' ? 'on' : ''}">Мне понравилось · ${hearts.size}</a></div>`;
      const carousel = c ? `<div class="card qcar">
          <div class="qsec">❝ ${c.n} из ${c.total}</div>
          <div class="qtext">${md(c.item.text, esc)}</div>
          <div class="qnav"><button data-act="qprev" aria-label="Назад">‹</button>
            <button class="qlike ${hearts.has(c.item.ev.getId()) ? 'on' : ''}" data-act="qlike" data-id="${esc(c.item.ev.getId())}">${hearts.has(c.item.ev.getId()) ? '❤️' : '🤍'}</button>
            <button data-act="qnext" aria-label="Дальше">›</button></div></div>` : '';
      let list = tab === 'fav' ? all.filter((p) => hearts.has(p.ev.getId()))
        : shuffled(all, Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''))); // новый порядок каждый день
      if (this.q) { const q = this.q.toLowerCase(); list = list.filter((p) => (p.title + ' ' + p.text).toLowerCase().includes(q)); }
      const shown = list.slice(0, this.limit);
      return head(all.length) + (tab === 'fav' ? '' : carousel) + tabs
        + (shown.map((p) => card(p, hearts.has(p.ev.getId()), esc)).join('')
          || `<div class="card muted">${tab === 'fav' ? 'Пока пусто. Нажмите 🤍 под записью — она появится здесь.' : 'Ничего не найдено'}</div>`)
        + (list.length > shown.length ? `<button class="more" data-act="qmore">Показать ещё (${list.length - shown.length})</button>` : '');
    },
    after() {
      current = v;
      clearInterval(auto);
      // карусель сама листается каждые 15 секунд, пока открыта группа
      auto = setInterval(() => {
        if (!location.hash.startsWith('#/quotes')) return clearInterval(auto);
        const room = quotesRoom(ctx.client);
        if (room && !document.hidden && !document.activeElement?.matches?.('.qsearch')) {
          carouselItem(carouselPool(posts(room)), 1);
          ctx.rerender();
        }
      }, 15000);
    },
  };
  return v;
}

// поиск по записям
document.addEventListener('input', (e) => {
  if (!e.target.matches('.qsearch') || !current) return;
  current.q = e.target.value;
  clearTimeout(current.t);
  current.t = setTimeout(() => current.ctx.rerender(), 300);
});

// ---------- кнопки ----------
export function quoteActions(ctx) {
  return {
    qnext: () => { carouselItem(carouselPool(posts(quotesRoom(ctx.client))), 1); ctx.rerender(); },
    qprev: () => { carouselItem(carouselPool(posts(quotesRoom(ctx.client))), -1); ctx.rerender(); },
    qmore: () => { if (current) { current.limit += 15; ctx.rerender(); } },
    qlike: async (el) => {
      const { client } = ctx;
      const room = quotesRoom(client);
      const mine = myHearts(room, client.getUserId()).get(el.dataset.id);
      el.disabled = true;
      try {
        if (mine) await client.redactEvent(room.roomId, mine.getId());
        else { ctx.sound('send'); await client.sendEvent(room.roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: el.dataset.id, key: HEART } }); }
      } catch (e) { alert('Не получилось: ' + e.message); }
      el.disabled = false;
    },
    // без фильтра типов: iPhone иначе делает .md-файлы серыми (их нельзя выбрать)
    quotesimport: () => ctx.pickFiles('', async (file) => {
      const entries = parseNotes(await file.text());
      if (!entries.length) return alert('В файле не нашлось записей (нужны заголовки «## Раздел» и «### Запись»).');
      if (!confirm(`Найдено записей: ${entries.length}. Загрузить в группу «${QUOTES_ROOM}»? Повторные не дублируются.`)) return;
      const pr = () => document.getElementById('qprog');
      const n = await importNotes(ctx.client, entries, (i, t) => { if (pr()) pr().textContent = `Загружаем ${i} из ${t}…`; });
      ctx.toast('Готово', `Добавлено записей: ${n}`);
      ctx.rerender();
    }),
  };
}
