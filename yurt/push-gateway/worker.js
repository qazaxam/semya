// Рассыльщик уведомлений «Юрт» (Matrix push gateway) на Cloudflare Workers.
// matrix.org → POST /_matrix/push/v1/notify → Web Push → телефон.
// Ничего не хранит. Адрес и ключи телефона приходят в каждом запросе от matrix.org.
// Секрет VAPID_JWK (приватный ключ) хранится только в Cloudflare, не в репозитории.

// Пускаем только к настоящим службам push (Apple, Google, Mozilla, Microsoft)
const ALLOWED = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// Шифрование содержимого push по RFC 8291 (aes128gcm)
export async function encrypt(text, p256dh, auth) {
  const ua = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(enc.encode(text), new Uint8Array([2])); // 2 = последняя запись
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const head = new Uint8Array(21 + asPub.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  head.set(asPub, 21);
  return concat(head, ct);
}

// Подпись VAPID по RFC 8292: служба push видит, что пишем именно мы
export async function vapid(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pub = b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUB };
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return `vapid t=${head}.${body}.${sig}, k=${pub}`;
}

// Текст уведомления. Сами сообщения зашифрованы, поэтому пишем только «от кого».
function describe(n) {
  const who = n.sender_display_name || n.sender || 'Кто-то';
  if (n.type === 'm.room.member') {
    return { title: 'Юрт', body: n.room_name ? `Приглашение: ${n.room_name}` : `${who} хочет добавить вас в друзья`, room_id: n.room_id, kind: 'invite' };
  }
  const where = n.room_name && n.room_name !== who ? ` · ${n.room_name}` : '';
  return { title: who, body: 'Новое сообщение' + where, room_id: n.room_id };
}

const isPushHost = (endpoint) => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && ALLOWED.some((r) => r.test(u.hostname)); } catch { return false; }
};
async function sendPush(endpoint, p256dh, auth, msg, env) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapid(endpoint, env),
      TTL: '86400',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body: await encrypt(msg, p256dh, auth),
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // кнопка «Прислать тестовое уведомление» в настройках: шлём через 10 секунд
    if (req.method === 'POST' && url.pathname === '/test') {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      let s;
      try { s = JSON.parse(await req.text()); } catch { return new Response('bad', { status: 400, headers: cors }); }
      if (!isPushHost(s.endpoint) || !s.p256dh || !s.auth) return new Response('bad', { status: 400, headers: cors });
      ctx.waitUntil((async () => {
        await new Promise((r) => setTimeout(r, 10000));
        await sendPush(s.endpoint, s.p256dh, s.auth, JSON.stringify({ title: 'Юрт', body: 'Тест: уведомления работают ✅' }), env);
      })());
      return new Response('ok', { headers: cors });
    }
    if (req.method !== 'POST' || url.pathname !== '/_matrix/push/v1/notify') {
      return new Response('Юрт: рассыльщик уведомлений работает', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    let n;
    try { n = (await req.json()).notification; } catch { return json({ error: 'bad json' }, 400); }
    const rejected = [];
    if (!n?.event_id) return json({ rejected }); // только счётчики — не будим телефон
    const msg = JSON.stringify({ ...describe(n), unread: n.counts?.unread || 0 });
    await Promise.all((n.devices || []).map(async (d) => {
      try {
        if (!isPushHost(d.pushkey) || !d.data?.p256dh || !d.data?.auth) {
          rejected.push(d.pushkey);
          return;
        }
        const res = await sendPush(d.pushkey, d.data.p256dh, d.data.auth, msg, env);
        if (res.status === 404 || res.status === 410) rejected.push(d.pushkey); // телефон отписался
      } catch {}
    }));
    return json({ rejected });
  },
};
