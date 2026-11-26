// Плеер радио. Один <audio> на всё приложение: iPhone разрешает включать звук
// без нажатия только тому элементу, который уже играл после нажатия. Поэтому станции
// переключаются заменой адреса в том же элементе — так работает и экран блокировки.
import { APP_NAME } from './config.js';

const CONNECT_TIMEOUT = 15000; // столько ждём начала звука, потом пробуем запасной адрес
const STALL_TIMEOUT = 12000;   // звук завис дольше — переподключаемся
const FRESH_AFTER_PAUSE = 8000; // после долгой паузы начинаем с «живого» места, а не со старого буфера
const MAX_RECONNECTS = 3;

export function createPlayer({ onChange, onToast }) {
  const audio = document.createElement('audio');
  audio.preload = 'none';
  audio.setAttribute('playsinline', '');
  // crossOrigin НЕ ставим: у многих радио нет CORS, и тогда звук не пошёл бы вовсе.
  document.body.append(audio);

  // iOS 17+: звук как у музыкального плеера (не глушится переключателем «бесшумно»)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

  const s = {
    list: null, listKey: null, idx: -1,
    status: 'idle',      // idle | loading | buffering | playing | paused | error
    dead: new Set(),     // станции, которые в этот раз не ответили (значок ⚠)
  };
  let token = 0;         // номер последней команды: старые ответы сети игнорируем
  let cand = [];         // адреса текущей станции
  let cur = null;        // { t, i } — какой адрес сейчас пробуем
  let timer = 0;
  let reconnects = 0;
  let skips = 0;         // сколько станций подряд пропустили из-за ошибок
  let dir = 0;           // направление переключения: +1 / -1 / 0 (выбрали вручную)
  let pausedAt = 0;
  let ourPause = false;  // пауза наша (кнопка), а не системная (звонок, Siri)
  const rbCache = new Map();

  const station = () => (s.list && s.idx >= 0 ? s.list[s.idx] : null);
  const set = (status) => { s.status = status; syncSession(); onChange?.(s); };
  const clearTimer = () => { clearTimeout(timer); timer = 0; };
  const arm = (ms, fn) => { clearTimer(); timer = setTimeout(fn, ms); };

  function select(list, listKey, idx, d = 0) {
    if (!list?.length) return;
    s.list = list; s.listKey = listKey;
    s.idx = ((idx % list.length) + list.length) % list.length;
    dir = d;
    if (!d) skips = 0;
    start();
  }

  function start() {
    const st = station();
    if (!st) return;
    const t = ++token;
    reconnects = 0;
    cand = [...st.urls, ...(rbCache.get(st.id) || [])];
    setMeta(st);
    save();
    attempt(t, 0);
  }

  function attempt(t, i) {
    if (t !== token) return;
    if (i >= cand.length) return stationFailed(t);
    cur = { t, i };
    ourPause = false;
    audio.src = cand[i];
    set('loading');
    arm(CONNECT_TIMEOUT, () => fail(t, i));
    const p = audio.play();
    p?.catch?.((e) => {
      if (t !== token || cur?.i !== i) return;
      if (e.name === 'NotAllowedError') { // iPhone не дал включить без нажатия
        clearTimer();
        set('paused');
        onToast?.('Нажмите ▶', 'Телефон просит нажать кнопку, чтобы включить звук');
      } else if (e.name !== 'AbortError') fail(t, i); // AbortError — просто сменили станцию
    });
  }

  // адрес не сработал → следующий адрес этой станции
  function fail(t, i) {
    if (t !== token || cur?.i !== i || cur?.t !== t) return;
    cur = { t, i: -1 }; // чтобы ошибка и таймер не сработали дважды
    attempt(t, i + 1);
  }

  async function stationFailed(t) {
    const st = station();
    clearTimer();
    // последний шанс: свежий адрес из открытого каталога radio-browser
    if (st?.rb && !rbCache.has(st.id)) {
      set('loading');
      const fresh = (await lookup(st)).filter((u) => !cand.includes(u));
      rbCache.set(st.id, fresh);
      if (t !== token) return;
      if (fresh.length) { const from = cand.length; cand.push(...fresh); return attempt(t, from); }
    }
    if (t !== token) return;
    audio.removeAttribute('src');
    audio.load();
    s.dead.add(st.id);
    // переключали «следующая/предыдущая» — идём дальше в ту же сторону, как плеер пропускает битый трек
    if (dir && skips < s.list.length - 1) {
      skips++;
      onToast?.(`${st.name} не отвечает`, 'Включаю следующую станцию');
      s.idx = (s.idx + dir + s.list.length) % s.list.length;
      return start();
    }
    set('error');
    onToast?.(`${st.name} сейчас не отвечает`, 'Попробуйте позже или выберите другую станцию');
  }

  // переподключение той же станции (обрыв сети, смена Wi-Fi ↔ LTE)
  function reconnect() {
    const t = token;
    if (!station() || s.status === 'paused' || s.status === 'idle') return;
    if (reconnects >= MAX_RECONNECTS) return fail(t, cur?.i ?? 0);
    reconnects++;
    const i = Math.max(0, cur?.i ?? 0);
    setTimeout(() => attempt(t, i), 500 * reconnects);
  }

  audio.addEventListener('playing', () => {
    if (!cur || cur.t !== token) return;
    clearTimer();
    reconnects = 0; skips = 0;
    s.dead.delete(station()?.id);
    setMeta(station()); // iOS иногда сбрасывает обложку при новом потоке
    set('playing');
  });
  // «waiting» — звук встал; «stalled» — данные не идут (звук может ещё играть из запаса).
  // Переподключаемся, только если звук действительно не двигается STALL_TIMEOUT.
  const watch = () => {
    if (s.status !== 'playing' && s.status !== 'buffering') return;
    const t = token, at = audio.currentTime;
    arm(STALL_TIMEOUT, () => { if (t === token && audio.currentTime === at && !audio.paused) reconnect(); });
  };
  audio.addEventListener('waiting', () => { if (s.status === 'playing') { set('buffering'); watch(); } });
  audio.addEventListener('stalled', watch);
  audio.addEventListener('timeupdate', () => {
    if (s.status === 'buffering' && !audio.paused && audio.readyState >= 3) { clearTimer(); set('playing'); }
  });
  audio.addEventListener('ended', () => { if (s.status === 'playing' || s.status === 'buffering') reconnect(); });
  audio.addEventListener('error', () => {
    if (!cur || !audio.getAttribute('src')) return;
    if (s.status === 'playing' || s.status === 'buffering') reconnect(); // оборвался уже игравший поток
    else fail(cur.t, cur.i);
  });
  audio.addEventListener('pause', () => {
    if (ourPause || s.status === 'loading') return;
    // систему не спрашивали: звонок, Siri, другой плеер, наушники вынули
    clearTimer();
    pausedAt = Date.now();
    if (s.status !== 'idle' && s.status !== 'error') set('paused');
  });
  addEventListener('online', () => { if (s.status === 'buffering' || s.status === 'loading') { reconnects = 0; reconnect(); } });

  function pause() {
    if (!station()) return;
    ourPause = true;
    token++; // отменяем незаконченное подключение
    clearTimer();
    audio.pause();
    pausedAt = Date.now();
    set('paused');
  }

  function resume() {
    const st = station();
    if (!st) return false;
    dir = 0; skips = 0;
    // для прямого эфира после паузы — заново, иначе играл бы старый кусок и потом завис
    if (s.status === 'error' || !audio.getAttribute('src') || Date.now() - pausedAt > FRESH_AFTER_PAUSE) { start(); return true; }
    const t = ++token;
    cur = { t, i: Math.max(0, cur?.i ?? 0) };
    ourPause = false;
    set('loading');
    arm(CONNECT_TIMEOUT, () => { if (t === token) start(); });
    audio.play().catch((e) => {
      if (t !== token) return;
      if (e.name === 'NotAllowedError') { clearTimer(); set('paused'); }
      else if (e.name !== 'AbortError') start();
    });
    return true;
  }

  const toggle = () => (s.status === 'playing' || s.status === 'buffering' || s.status === 'loading' ? pause() : resume());
  const step = (d) => { if (s.list) select(s.list, s.listKey, s.idx + d, d); };

  // ---------- экран блокировки и Пункт управления ----------
  function setMeta(st) {
    if (!('mediaSession' in navigator) || !st || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.name,
      artist: st.city + (st.fm ? ' · ' + st.fm + ' FM' : ''),
      album: APP_NAME,
      artwork: [{ src: new URL(`./art/${st.id}.png`, location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  }
  function syncSession() {
    if (!('mediaSession' in navigator)) return;
    const on = s.status === 'playing' || s.status === 'buffering' || s.status === 'loading';
    try { navigator.mediaSession.playbackState = station() ? (on ? 'playing' : 'paused') : 'none'; } catch {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    h('play', () => resume());
    h('pause', () => pause());
    h('stop', () => pause());
    h('nexttrack', () => step(1));
    h('previoustrack', () => step(-1));
    // без перемотки: иначе iPhone вместо ⏮ ⏭ покажет «−10 / +10 сек»
    h('seekbackward', null);
    h('seekforward', null);
    h('seekto', null);
  }

  // ---------- запомнить последнюю станцию ----------
  function save() {
    try { localStorage.setItem('dalga.last', JSON.stringify({ list: s.listKey, id: station()?.id })); } catch {}
  }

  // подготовить станцию без звука (при открытии приложения): iPhone не даст играть без нажатия
  function prepare(list, listKey, idx) {
    s.list = list; s.listKey = listKey; s.idx = idx;
    setMeta(station());
    set('paused');
    pausedAt = 0;
  }

  return { state: s, station, select, toggle, pause, resume, next: () => step(1), prev: () => step(-1), prepare };
}

// Каталог radio-browser.info (открытый, с CORS). Берём только https и только из Турции.
async function lookup(st) {
  for (const host of ['de1', 'nl1', 'at1']) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://${host}.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(st.rb)}&countrycode=TR&hidebroken=true&limit=20`, { signal: ctl.signal });
      clearTimeout(to);
      const list = await r.json();
      return list
        .filter((x) => x.url_resolved?.startsWith('https://'))
        .filter((x) => !st.rbState || (x.state || '').toLowerCase().includes(st.rbState))
        .map((x) => x.url_resolved);
    } catch {}
  }
  return [];
}
