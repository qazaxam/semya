// Архив переписок: выгрузка ВСЕХ чатов в расшифрованном виде.
// Формат описан в docs/08-archive.md (yurt-archive, версия 1). Тот же формат
// задуман для будущего импорта старых переписок.
//
// Важно: расшифровать можно только то, для чего у этого устройства есть ключи
// (после ввода ключа восстановления в Настройках доступна и старая история).
// Файл архива НЕ зашифрован — хранить в надёжном месте, не в публичном репозитории.

const MSG = ['m.room.message', 'm.room.encrypted'];

function record(e) {
  const c = e.getContent();
  const r = {
    id: e.getId(),
    ts: e.getTs(),
    date: new Date(e.getTs()).toISOString(),
    sender: e.getSender(),
    sender_name: e.sender?.name || e.getSender(),
    type: c.msgtype || null,
    text: c.body ?? null,
  };
  if (e.isDecryptionFailure()) r.undecryptable = true;
  if (e.isRedacted()) r.deleted = true;
  if (e.replyEventId) r.reply_to = e.replyEventId;
  if (e.threadRootId && e.threadRootId !== e.getId()) r.thread_root = e.threadRootId;
  if (c['yurt.round']) r.round_video = true;
  if (c.file || c.url) {
    // ключи к файлу: по ним файл можно скачать и расшифровать позже (см. docs/08-archive.md)
    r.media = { mxc: c.file?.url || c.url, name: c.body, info: c.info || {} };
    if (c.file) r.media.encryption = { key: c.file.key, iv: c.file.iv, hashes: c.file.hashes, v: c.file.v };
  }
  return r;
}

export async function exportArchive(client, onProgress) {
  const rooms = client.getRooms().filter((r) => r.getMyMembership() === 'join' && !r.isSpaceRoom());
  const out = {
    format: 'yurt-archive',
    version: 1,
    exported_at: new Date().toISOString(),
    exported_by: client.getUserId(),
    rooms: [],
  };
  let n = 0;
  for (const room of rooms) {
    onProgress?.(`Чат ${++n} из ${rooms.length}: ${room.name}`);
    const tl = room.getLiveTimeline();
    // листаем историю до самого начала
    while (await client.paginateEventTimeline(tl, { backwards: true, limit: 100 })) { /* ещё */ }
    const evs = tl.getEvents().filter((e) => MSG.includes(e.getType()));
    await Promise.all(evs.map((e) => client.decryptEventIfNeeded(e)));
    // ответы в тредах (комментарии на Стене) живут отдельно — забираем их тоже
    const replies = [];
    for (const root of evs) {
      if (!(root.getServerAggregatedRelation('m.thread')?.count || root.getThread())) continue;
      let from = null;
      do {
        const r = await client.relations(room.roomId, root.getId(), 'm.thread', null, { from, limit: 100 });
        await Promise.all(r.events.map((e) => client.decryptEventIfNeeded(e)));
        replies.push(...r.events);
        from = r.nextBatch;
      } while (from);
    }
    const all = [...evs, ...replies].sort((a, b) => a.getTs() - b.getTs());
    out.rooms.push({
      room_id: room.roomId,
      name: room.name,
      encrypted: !!(await client.getCrypto()?.isEncryptionEnabledInRoom(room.roomId)),
      members: room.getJoinedMembers().map((m) => ({ user_id: m.userId, name: m.name })),
      messages: all.map(record),
    });
  }
  return out;
}

// тот же архив в виде читаемого текста
export function toMarkdown(a) {
  const fmt = (iso) => iso.slice(0, 16).replace('T', ' ');
  const lines = [`# Архив переписок «Юрт»`, '', `Выгружен: ${fmt(a.exported_at)} · ${a.exported_by}`, ''];
  for (const r of a.rooms) {
    lines.push(`## ${r.name}`, '', `Участники: ${r.members.map((m) => m.name).join(', ')}`, '');
    for (const m of r.messages) {
      const what = m.deleted ? '_(удалено)_' : m.undecryptable ? '_(не удалось расшифровать)_'
        : m.media ? `[${m.round_video ? 'видео-кружок' : m.type?.replace('m.', '')}: ${m.media.name}]` : (m.text || '');
      lines.push(`- **${fmt(m.date)} ${m.sender_name}:** ${m.thread_root ? '↳ ' : ''}${what.replace(/\n/g, '\n  ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
