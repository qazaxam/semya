// Медиа: отправка (фото, видео, голосовые, файлы) и показ.
// В зашифрованных чатах файл шифруется ДО отправки готовой библиотекой matrix-encrypt-attachment
// (AES-CTR по спецификации Matrix) — своей криптографии не пишем.
// Скачивание — только через аутентифицированный /_matrix/client/v1/media/download с токеном.
import { encryptAttachment, decryptAttachment } from 'matrix-encrypt-attachment';

export const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' МБ';
export const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const pickMime = (list) => list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

// лимит сервера на один файл
let limit = null;
export async function uploadLimit(client) {
  if (limit === null) {
    try { limit = (await client.getMediaConfig(true))['m.upload.size'] || 0; } catch { limit = 0; }
  }
  return limit;
}

// понятные ошибки matrix.org
function explain(e) {
  if (e?.errcode === 'M_TOO_LARGE' || e?.httpStatus === 413) return new Error('файл больше лимита сервера');
  if (e?.errcode === 'M_LIMIT_EXCEEDED' || e?.httpStatus === 429)
    return new Error('исчерпан бесплатный лимит matrix.org на загрузку (500 МБ в сутки / 2 ГБ в 28 дней). Попробуйте позже');
  return e;
}

export async function sendMedia(client, roomId, { blob, msgtype, name, info = {}, extra = {} }, onProgress) {
  const max = await uploadLimit(client);
  if (max && blob.size > max) throw new Error(`файл ${mb(blob.size)}, а сервер принимает до ${mb(max)}`);
  const mimetype = blob.type || 'application/octet-stream';
  const content = { msgtype, body: name, info: { ...info, mimetype, size: blob.size }, ...extra };
  const progressHandler = (p) => onProgress?.(p.total ? p.loaded / p.total : 0);
  try {
    if (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) {
      const { data, info: keys } = await encryptAttachment(await blob.arrayBuffer());
      const up = await client.uploadContent(new Blob([data]), { type: 'application/octet-stream', includeFilename: false, progressHandler });
      content.file = { ...keys, url: up.content_uri, mimetype };
    } else {
      const up = await client.uploadContent(blob, { type: mimetype, name, progressHandler });
      content.url = up.content_uri;
    }
    return await client.sendMessage(roomId, content);
  } catch (e) { throw explain(e); }
}

// скачать (и расшифровать) → blob: URL. Кэш, чтобы не качать повторно.
const cache = new Map();
export function mediaUrl(client, c) {
  const mxc = c.file?.url || c.url;
  if (!mxc?.startsWith('mxc://')) return Promise.reject(new Error('нет файла'));
  if (!cache.has(mxc)) {
    cache.set(mxc, (async () => {
      const [server, id] = mxc.slice(6).split('/');
      const res = await fetch(`${client.baseUrl}/_matrix/client/v1/media/download/${server}/${id}`,
        { headers: { Authorization: 'Bearer ' + client.getAccessToken() } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let buf = await res.arrayBuffer();
      if (c.file) buf = await decryptAttachment(buf, c.file);
      return URL.createObjectURL(new Blob([buf], { type: c.file?.mimetype || c.info?.mimetype || '' }));
    })().catch((e) => { cache.delete(mxc); throw e; }));
  }
  return cache.get(mxc);
}

// фото: уменьшаем до 1600px и пересохраняем в JPEG — заодно удаляются геометки (EXIF)
export async function prepareImage(file) {
  if (file.type === 'image/gif') return { blob: file, w: 0, h: 0 };
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  return { blob, w, h };
}

// размеры и длительность видео-файла
export function videoMeta(blob) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { resolve({ w: v.videoWidth, h: v.videoHeight, duration: Math.round(v.duration * 1000) || 0 }); URL.revokeObjectURL(v.src); };
    v.onerror = () => resolve({ w: 0, h: 0, duration: 0 });
    v.src = URL.createObjectURL(blob);
  });
}

// запись с микрофона/камеры: stream уже открыт (для кружка — показан в превью)
export function record(stream, mimes, bitrates = {}) {
  const mimeType = pickMime(mimes);
  const mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...bitrates });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.start(250);
  const started = Date.now();
  return {
    mr, started,
    stop: (keep) => new Promise((resolve) => {
      const done = () => {
        resolve(keep ? { blob: new Blob(chunks, { type: (mr.mimeType || mimes[0]).split(';')[0] }), duration: Date.now() - started } : null);
      };
      if (mr.state === 'inactive') done(); else { mr.onstop = done; mr.stop(); }
    }),
  };
}
