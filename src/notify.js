// Звуки, всплывающие плашки и системные уведомления.
// Звуки синтезируем сами (Web Audio) — никаких чужих файлов.

let actx = null;
export function unlockAudio() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}

export const soundOn = () => localStorage.getItem('yurt.sound') !== 'off';
export const setSound = (on) => localStorage.setItem('yurt.sound', on ? 'on' : 'off');

// [частота Гц, длительность с]
const SOUNDS = {
  send: [[740, 0.06], [988, 0.08]],     // «вжух» при отправке
  in: [[880, 0.1], [1319, 0.18]],       // новое сообщение
  soft: [[1047, 0.07]],                 // сообщение в открытом чате
};
export function sound(name) {
  if (!actx || !soundOn()) return;
  let t = actx.currentTime;
  for (const [f, d] of SOUNDS[name]) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + d + 0.03);
    t += d * 0.85;
  }
}

let toastTimer;
export function toast(title, text, href) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = '<b></b><span></span>';
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = text;
  el.onclick = () => { el.classList.remove('show'); if (href) location.hash = href; };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

export const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifyState = () => (notifySupported() ? Notification.permission : 'unsupported');
export const askNotify = () => (notifySupported() ? Notification.requestPermission() : Promise.resolve('unsupported'));

export async function systemNotify(title, body, tag) {
  if (notifyState() !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png' });
  } catch {}
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // нажали на уведомление, а приложение уже открыто
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.open) location.hash = e.data.open; });
  // открыли приложение — убираем старые уведомления из шторки
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    try { (await (await navigator.serviceWorker.ready).getNotifications()).forEach((n) => n.close()); } catch {}
  });
}

// Фоновые уведомления: подписка браузера + «пушер» в Matrix, который шлёт события в рассыльщик
const unb64u = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export async function enablePush(client, { gateway, vapidKey, appName, deviceName }) {
  if (notifyState() !== 'granted' || !gateway || !vapidKey || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(vapidKey) });
  const j = sub.toJSON();
  await client.setPusher({
    kind: 'http',
    app_id: 'yurt.web',
    pushkey: j.endpoint,
    app_display_name: appName,
    device_display_name: deviceName,
    lang: 'ru',
    data: { url: gateway + '/_matrix/push/v1/notify', p256dh: j.keys.p256dh, auth: j.keys.auth },
    append: false,
  });
  return true;
}

// цифра на значке приложения
export function setBadge(n) {
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
