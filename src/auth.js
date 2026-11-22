// Вход через OAuth (account.matrix.org). Токены — только в localStorage браузера.
import { createClient, OAuth2 } from 'matrix-js-sdk';
import { APP_NAME, HOMESERVER } from './config.js';

const SESSION = 'yurt.session';
const REG = 'yurt.oauthClient';

export const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');

const read = (store, k) => { try { return JSON.parse(store.getItem(k)); } catch { return null; } };
export const loadSession = () => read(localStorage, SESSION);
export const saveSession = (s) => localStorage.setItem(SESSION, JSON.stringify(s));
export const clearSession = () => localStorage.removeItem(SESSION);

const getMetadata = () => createClient({ baseUrl: HOMESERVER }).getAuthMetadata();

export async function startLogin() {
  if (location.protocol !== 'https:') throw new Error('вход работает только на опубликованном сайте (https, GitHub Pages)');
  const metadata = await getMetadata();
  let reg = read(localStorage, REG);
  if (!reg || reg.issuer !== metadata.issuer || reg.redirectUri !== redirectUri) {
    const clientId = await OAuth2.registerClient(metadata, {
      client_name: APP_NAME,
      client_uri: redirectUri,
      redirect_uris: [redirectUri],
      application_type: 'web',
    });
    reg = { clientId, issuer: metadata.issuer, redirectUri };
    localStorage.setItem(REG, JSON.stringify(reg));
  }
  const oauth = new OAuth2(metadata, { clientId: reg.clientId });
  const state = crypto.randomUUID();
  sessionStorage.setItem('yurt.oauth.' + state, JSON.stringify(oauth.context));
  location.href = await oauth.generateAuthorizationCodeGrantUrl(state, redirectUri);
}

// Возврат с account.matrix.org: #code=...&state=...
export function getAuthResponse() {
  const p = new URLSearchParams(location.hash.slice(1) || location.search);
  return p.get('code') && p.get('state') ? { code: p.get('code'), state: p.get('state') } : null;
}

export async function finishLogin({ code, state }) {
  const ctx = read(sessionStorage, 'yurt.oauth.' + state);
  if (!ctx) throw new Error('Вход устарел, попробуйте ещё раз');
  sessionStorage.removeItem('yurt.oauth.' + state);
  const oauth = new OAuth2(await getMetadata(), ctx);
  const t = await oauth.completeAuthorizationCodeGrant(code, redirectUri);
  const who = await createClient({ baseUrl: HOMESERVER, accessToken: t.access_token }).whoami();
  saveSession({
    homeserverUrl: HOMESERVER,
    clientId: ctx.clientId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    userId: who.user_id,
    deviceId: who.device_id || ctx.deviceId,
    fresh: true,
  });
}

// SDK сам обновляет access token; мы только сохраняем новый.
export function onTokenRefresh({ accessToken, refreshToken }) {
  const s = loadSession();
  if (!s) return;
  s.accessToken = accessToken;
  if (refreshToken) s.refreshToken = refreshToken;
  saveSession(s);
}
