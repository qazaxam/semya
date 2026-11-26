import './style.css';
import { APP_NAME, APP_SUB, ARCHIVE_URL } from './config.js';
import { LISTS, MAIN, POPULAR } from './stations.js';
import { createPlayer } from './player.js';
import { initials } from './label.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sub = (st) => st.city + (st.fm ? ` · ${st.fm} FM` : '');

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 6.2v11.6a.7.7 0 0 0 1.1.6L14 13v4.8a.7.7 0 0 0 1.1.6l.1-.1V6.1l-.1-.1a.7.7 0 0 0-1.1.6V11L6.1 5.6A.7.7 0 0 0 5 6.2z"/><rect x="17" y="5.5" width="2.4" height="13" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" style="transform:scaleX(-1)"><path d="M5 6.2v11.6a.7.7 0 0 0 1.1.6L14 13v4.8a.7.7 0 0 0 1.1.6l.1-.1V6.1l-.1-.1a.7.7 0 0 0-1.1.6V11L6.1 5.6A.7.7 0 0 0 5 6.2z"/><rect x="17" y="5.5" width="2.4" height="13" rx="1"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const STATUS = { idle: '', loading: 'Подключение…', buffering: 'Буферизация…', playing: 'В эфире', paused: 'Пауза', error: 'Не отвечает' };
const isOn = (status) => status === 'playing' || status === 'buffering' || status === 'loading';

// перерисовываем, только если что-то поменялось: иначе нажатие может «потеряться» под пальцем
const put = (el, html) => { if (el._html !== html) { el._html = html; el.innerHTML = html; } };

const tile = (st, cls = '') => `<span class="tile ${cls}" style="--c:${st.color}"><b>${esc(initials(st.name))}</b>${st.fm ? `<i>${esc(st.fm)}</i>` : ''}</span>`;

// ---------- каркас ----------
document.getElementById('app').innerHTML = `
  <header class="top"><div class="top-in" id="top"></div></header>
  <main id="list"></main>
  <div class="mini" id="mini" hidden></div>
  <section class="full" id="full" aria-hidden="true"></section>
  <div class="toast" id="toast"></div>`;

const player = createPlayer({ onChange: render, onToast: toast });
let view = location.hash === '#/popular' ? 'popular' : 'main';
let fullOpen = false;
let navIn = false; // открыли папку из приложения — «назад» = history.back()

// ---------- список станций ----------
function row(st, listKey, i) {
  const s = player.state, now = player.station();
  const active = now?.id === st.id && s.listKey === listKey;
  const mark = active && isOn(s.status)
    ? (s.status === 'playing' ? '<span class="eq"><i></i><i></i><i></i></span>' : '<span class="spin"></span>')
    : s.dead.has(st.id) ? '<span class="warn" title="Не ответила">!</span>' : '';
  return `<button class="row ${active ? 'active' : ''}" data-list="${listKey}" data-i="${i}">
    ${tile(st)}<span class="grow"><b>${esc(st.name)}</b><small>${esc(sub(st))}</small></span>${mark}</button>`;
}

function renderList() {
  const top = $('#top'), list = $('#list');
  if (view === 'popular') {
    put(top, `<button class="iconbtn" data-act="home" aria-label="Назад">${ICON.back}</button>
      <div class="ttl"><b>Популярные</b><small>${POPULAR.length} станций Турции</small></div>`);
    put(list, `<div class="card">${POPULAR.map((st, i) => row(st, 'popular', i)).join('')}</div>
      <p class="hint">«Следующая» на экране блокировки листает станции этой папки.</p>`);
    return;
  }
  put(top, `<span class="logo">${logoSvg()}</span>
    <div class="ttl"><b>${APP_NAME}</b><small>${APP_SUB}</small></div>`);
  let html = `<div class="card first">${row(MAIN[0], 'main', 0)}</div>`;
  let group = null;
  MAIN.forEach((st, i) => {
    if (!i) return;
    if (st.group !== group) {
      if (group) html += '</div>';
      group = st.group;
      html += `<h3 class="sect">${esc(group)}</h3><div class="card">`;
    }
    html += row(st, 'main', i);
  });
  html += `</div>
    <h3 class="sect">Папки</h3>
    <div class="card"><button class="row folder" data-act="popular">
      <span class="tile fold">${ICON.folder}</span>
      <span class="grow"><b>Популярные</b><small>${POPULAR.length} станций Турции</small></span>${ICON.chevron}</button></div>
    <p class="hint">Листайте плеер влево-вправо или жмите ⏭ на экране блокировки — включится следующая станция.</p>
    <p class="hint"><a href="${ARCHIVE_URL}">Старое приложение «Юрт» (архив) →</a></p>`;
  put(list, html);
}

// ---------- мини-плеер внизу ----------
function renderMini() {
  const st = player.station(), s = player.state, mini = $('#mini');
  mini.hidden = !st;
  document.body.classList.toggle('has-mini', !!st);
  if (!st) return;
  put(mini, `
    <button class="mini-info" data-act="open">${tile(st, 'sm')}
      <span class="grow"><b>${esc(st.name)}</b><small class="st-${s.status}">${esc(STATUS[s.status] || sub(st))}</small></span></button>
    <button class="iconbtn" data-act="prev" aria-label="Предыдущая">${ICON.prev}</button>
    <button class="iconbtn big" data-act="toggle" aria-label="Играть или пауза">${isOn(s.status) ? ICON.pause : ICON.play}</button>
    <button class="iconbtn" data-act="next" aria-label="Следующая">${ICON.next}</button>`);
}

// ---------- большой плеер ----------
function renderFull() {
  const st = player.station(), s = player.state, full = $('#full');
  full.classList.toggle('open', fullOpen && !!st);
  full.setAttribute('aria-hidden', String(!(fullOpen && st)));
  if (!st) return;
  const list = s.list, n = list.length;
  const at = (d) => list[(s.idx + d + n) % n];
  const key = `${s.listKey}:${st.id}`;
  // карусель перерисовываем только при смене станции, чтобы не прыгала анимация
  if (full.dataset.key !== key) {
    full.dataset.key = key;
    full.innerHTML = `
      <div class="full-top">
        <button class="iconbtn" data-act="close" aria-label="Свернуть">${ICON.down}</button>
        <span>${esc(LISTS[s.listKey]?.title || '')} · ${s.idx + 1} из ${n}</span>
        <span class="iconbtn"></span>
      </div>
      <div class="deck" id="deck">
        <div class="slide" style="--x:-1">${tile(at(-1), 'xl')}</div>
        <div class="slide mid" style="--x:0">${tile(st, 'xl')}</div>
        <div class="slide" style="--x:1">${tile(at(1), 'xl')}</div>
      </div>
      <div class="full-meta"><b>${esc(st.name)}</b><small>${esc(sub(st))}</small><em id="fstatus"></em></div>
      <div class="full-ctl">
        <button class="iconbtn" data-act="prev" aria-label="Предыдущая">${ICON.prev}</button>
        <button class="iconbtn huge" data-act="toggle" id="ftoggle" aria-label="Играть или пауза"></button>
        <button class="iconbtn" data-act="next" aria-label="Следующая">${ICON.next}</button>
      </div>
      <p class="hint">Листайте обложку — следующая станция</p>`;
  }
  const fs = $('#fstatus');
  fs.textContent = STATUS[s.status] || '';
  fs.className = 'st-' + s.status;
  $('#ftoggle').innerHTML = isOn(s.status) ? ICON.pause : ICON.play;
}

function render() {
  renderList();
  renderMini();
  renderFull();
}

// ---------- нажатия ----------
document.addEventListener('click', (e) => {
  const r = e.target.closest('.row[data-list]');
  if (r) {
    const key = r.dataset.list, i = +r.dataset.i, s = player.state;
    const same = s.listKey === key && s.idx === i && player.station();
    if (same) player.toggle(); else player.select(LISTS[key].stations, key, i);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'toggle') player.toggle();
  else if (act === 'next') go(1);
  else if (act === 'prev') go(-1);
  else if (act === 'open') { fullOpen = true; renderFull(); }
  else if (act === 'close') { fullOpen = false; renderFull(); }
  else if (act === 'popular') { navIn = true; location.hash = '#/popular'; }
  else if (act === 'home') { if (navIn) history.back(); else location.hash = ''; navIn = false; }
});
addEventListener('hashchange', () => { view = location.hash === '#/popular' ? 'popular' : 'main'; scrollTo(0, 0); renderList(); });

// переключение с анимацией «как следующая песня»
function go(d) {
  const deck = $('#deck');
  if (fullOpen && deck) {
    deck.style.transition = 'transform .28s ease';
    deck.style.transform = `translateX(${-d * 100}%)`;
    setTimeout(() => { deck.style.transition = 'none'; deck.style.transform = ''; d > 0 ? player.next() : player.prev(); }, 230);
  } else d > 0 ? player.next() : player.prev();
  navigator.vibrate?.(8);
}

// ---------- свайпы: влево — следующая, вправо — предыдущая ----------
function swipe(el, { live = false } = {}) {
  let x0 = 0, y0 = 0, dx = 0, mode = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = null;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (!mode && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) mode = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (mode !== 'x') return;
    e.preventDefault(); // не даём странице ехать вбок
    const deck = live && $('#deck');
    if (deck) { deck.style.transition = 'none'; deck.style.transform = `translateX(${dx}px)`; }
  }, { passive: false });
  const end = () => {
    if (mode !== 'x') return;
    mode = null;
    const deck = live && $('#deck');
    if (Math.abs(dx) > 60) {
      const d = dx < 0 ? 1 : -1;
      if (deck) {
        deck.style.transition = 'transform .22s ease';
        deck.style.transform = `translateX(${-d * 100}%)`;
        setTimeout(() => { deck.style.transition = 'none'; deck.style.transform = ''; d > 0 ? player.next() : player.prev(); }, 200);
      } else d > 0 ? player.next() : player.prev();
      navigator.vibrate?.(8);
    } else if (deck) { deck.style.transition = 'transform .2s ease'; deck.style.transform = ''; }
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}
swipe($('#mini'));
swipe($('#full'), { live: true });

// свернуть большой плеер жестом вниз
(() => {
  const full = $('#full');
  let y0 = 0, x0 = 0;
  full.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
  full.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (t.clientY - y0 > 110 && Math.abs(t.clientX - x0) < 60) { fullOpen = false; renderFull(); }
  });
})();

// ---------- сообщения ----------
let toastTimer = 0;
function toast(title, text) {
  const el = $('#toast');
  el.innerHTML = `<b>${esc(title)}</b>${text ? `<small>${esc(text)}</small>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function logoSvg() {
  return '<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ff7a3d"/><path d="M12 36c5-9 9-9 14 0s9 9 14 0 9-9 14 0" fill="none" stroke="#14121c" stroke-width="5.5" stroke-linecap="round"/><path d="M12 24c5-9 9-9 14 0s9 9 14 0 9-9 14 0" fill="none" stroke="#14121c" stroke-width="5.5" stroke-linecap="round" opacity=".45"/></svg>';
}

// ---------- старт: показать последнюю станцию (без звука — iPhone не даст) ----------
(() => {
  let last = null;
  try { last = JSON.parse(localStorage.getItem('dalga.last')); } catch {}
  const key = LISTS[last?.list] ? last.list : null;
  const i = key ? LISTS[key].stations.findIndex((st) => st.id === last.id) : -1;
  if (i >= 0) player.prepare(LISTS[key].stations, key, i);
  else render();
})();

// ---------- новая версия сайта: перезагружаемся, только пока радио молчит ----------
async function hasUpdate() {
  try {
    const html = await (await fetch('./?v=' + Date.now(), { cache: 'no-store' })).text();
    const fresh = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    const mine = document.querySelector('script[src*="assets/index-"]')?.getAttribute('src');
    return !!(fresh && mine && !mine.includes(fresh));
  } catch { return false; }
}
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  render(); // телефон мог поставить звук на паузу, пока приложение было свёрнуто
  if (!isOn(player.state.status) && await hasUpdate()) location.replace(location.pathname + '?r=' + Date.now() + location.hash);
});
if (new URLSearchParams(location.search).has('r')) history.replaceState(null, '', location.pathname + location.hash);
