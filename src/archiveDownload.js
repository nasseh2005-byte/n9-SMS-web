// Do not expose a partial archive as complete if a later page fails or grants change.
export async function collectArchivePages(first, readPage, { signal, onProgress } = {}) {
  if (!Array.isArray(first.messages)) throw new Error("استجابة أرشيف الرسائل غير صالحة. أعد المحاولة.");
  const messages = [...first.messages];
  const total = Number.isSafeInteger(first.total) && first.total >= 0 ? first.total : null;
  const report = () => onProgress?.({ loaded: messages.length, total });
  let cursor = first.nextCursor;
  report();
  while (cursor !== null && cursor !== undefined) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(cursor) || cursor !== messages.length) throw new Error("تسلسل صفحات الأرشيف غير صالح. أعد المحاولة.");
    const page = await readPage(cursor, first.revision);
    signal?.throwIfAborted();
    if (page.revision !== first.revision || !Array.isArray(page.messages)
      || (total !== null && page.total !== total)) throw new Error("تغير الأرشيف أو الصلاحيات أثناء التحميل. أعد المحاولة.");
    if (page.nextCursor != null && page.nextCursor <= cursor) throw new Error("تعذر متابعة تحميل المحادثات.");
    messages.push(...page.messages);
    cursor = page.nextCursor;
    report();
  }
  signal?.throwIfAborted();
  if (total !== null && total !== messages.length) throw new Error("لم يكتمل تحميل كل الرسائل. أعد المحاولة.");
  return { ...first, messages };
}
