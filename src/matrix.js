// Клиент Matrix: синхронизация (IndexedDB) + встроенное шифрование (Rust crypto).
import { createClient, IndexedDBStore } from 'matrix-js-sdk';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key.js';
import { onTokenRefresh, redirectUri, saveSession, clearSession } from './auth.js';
import { DEVICE_NAME, SPACE_NAME } from './config.js';

let pendingKey = null; // ключ восстановления, пока пользователь его вводит

export async function startMatrix(s) {
  const store = new IndexedDBStore({ indexedDB: window.indexedDB, localStorage, dbName: 'yurt-sync' });
  await store.startup();
  const client = createClient({
    baseUrl: s.homeserverUrl,
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    onTokenRefresh,
    oauthClientId: s.clientId,
    userId: s.userId,
    deviceId: s.deviceId,
    store,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        if (!pendingKey) throw new Error('Нет ключа восстановления');
        return [Object.keys(keys)[0], pendingKey];
      },
    },
  });
  await client.initRustCrypto();
  await client.startClient({ lazyLoadMembers: true, initialSyncLimit: 30, threadSupport: true });
  await new Promise((res) => {
    if (client.isInitialSyncComplete()) return res();
    const h = (st) => { if (st === 'PREPARED' || st === 'SYNCING') { client.off('sync', h); res(); } };
    client.on('sync', h);
  });
  if (s.fresh) {
    try { await client.setDeviceDetails(s.deviceId, { display_name: DEVICE_NAME }); } catch {}
    delete s.fresh;
    saveSession(s);
  }
  return client;
}

// Вступить во все комнаты пространства «Семья», куда ещё не вступили.
export async function joinSpaceRooms(client) {
  const spaces = client.getRooms().filter(
    (r) => r.isSpaceRoom() && r.getMyMembership() === 'join' && r.name === SPACE_NAME);
  for (const sp of spaces) {
    for (const ev of sp.currentState.getStateEvents('m.space.child')) {
      const via = ev.getContent().via;
      const room = client.getRoom(ev.getStateKey());
      if (!via || room?.getMyMembership() === 'join') continue;
      try { await client.joinRoom(ev.getStateKey(), { viaServers: via }); } catch (e) { console.warn(e); }
    }
  }
}

// Ключ восстановления: подтверждает устройство и подтягивает старые ключи.
export async function useRecoveryKey(client, text) {
  const key = decodeRecoveryKey(text.trim());
  const found = await client.secretStorage.getKey();
  if (!found) throw new Error('Резервная копия ключей ещё не настроена (настройте её в Element X).');
  if (!(await client.secretStorage.checkKey(key, found[1]))) throw new Error('Неверный ключ');
  pendingKey = key;
  try {
    const c = client.getCrypto();
    await c.bootstrapCrossSigning({});
    await c.loadSessionBackupPrivateKeyFromSecretStorage();
    await c.checkKeyBackupAndEnable();
    await c.restoreKeyBackup?.();
  } finally { pendingKey = null; }
}

export async function isVerified(client) {
  const st = await client.getCrypto()?.getDeviceVerificationStatus(client.getUserId(), client.getDeviceId());
  return !!st?.crossSigningVerified;
}

export async function logout(client) {
  try { await client?.logout(true); } catch {}
  try { client?.stopClient(); await client?.clearStores(); } catch {}
  clearSession();
  location.href = redirectUri;
}
