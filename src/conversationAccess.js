import { normalizeMessageIdentity } from "./dataUtils.js";

export const CONVERSATION_READ_ONLY = "هذا الحساب مخصص لعرض المحادثات المحددة والبحث والتصدير. رفع أرشيف الشركة متاح للمشرف أو للمستخدم المفوض بكل المحادثات.";

// Missing policy preserves existing grants. A present but invalid policy fails closed.
export function decodeConversationPolicy(row) {
  if (!row) return { mode: "all", addresses: [], revision: "legacy" };
  try {
    const addresses = JSON.parse(row.addresses);
    if (addresses === null) return { mode: "all", addresses: [], revision: String(row.revision) };
    if (!Array.isArray(addresses) || addresses.some((value) => typeof value !== "string")) throw new Error();
    return { mode: "selected", addresses, revision: String(row.revision) };
  } catch {
    return { mode: "selected", addresses: [], revision: String(row.revision) };
  }
}

export function validateConversationPolicy(input) {
  if (input?.mode === "all") return { mode: "all", addresses: [] };
  if (input?.mode !== "selected" || !Array.isArray(input.addresses)
    || input.addresses.length > 250000
    || input.addresses.some((value) => typeof value !== "string" || !value || value.length > 1000)) {
    throw Object.assign(new Error("اختيار المحادثات غير صالح."), { status: 400 });
  }
  return { mode: "selected", addresses: [...new Set(input.addresses)] };
}

export function filterConversationArchive(archive, policy) {
  const messages = Array.isArray(archive?.messages) ? archive.messages : [];
  if (policy.mode === "all") return archive;
  const allowed = new Set(policy.addresses);
  return {
    sourceName: "المحادثات المصرح بها",
    readOnly: true,
    messages: messages.filter((message) => allowed.has(normalizeMessageIdentity(message)?.address)),
  };
}

export function conversationCatalogue(messages) {
  const groups = new Map();
  for (const message of messages || []) {
    const normalized = normalizeMessageIdentity(message);
    const address = normalized?.address;
    if (typeof address !== "string" || !address) continue;
    const item = groups.get(address) || { address, name: normalized.contactName || address, count: 0 };
    item.count += 1;
    groups.set(address, item);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

// Keep each response well below Vercel's response limit, including UTF-8 Arabic text.
export function conversationPage(items, url, revision) {
  const cursor = Number(url.searchParams.get("cursor") || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > items.length) throw new Error("موضع القراءة غير صالح.");
  if (cursor && url.searchParams.get("revision") !== revision) {
    const error = new Error("تغير الأرشيف أو الصلاحيات أثناء التحميل. أعد تحميل المحادثات.");
    error.status = 409;
    throw error;
  }
  let bytes = 0;
  const page = [];
  const encoder = new TextEncoder();
  for (let index = cursor; index < items.length && page.length < 1000; index += 1) {
    const size = encoder.encode(JSON.stringify(items[index])).byteLength + 1;
    if (size > 3 * 1024 * 1024) throw new Error("إحدى الرسائل تتجاوز حجم القراءة الآمن. راجع المشرف.");
    if (bytes + size > 3 * 1024 * 1024) break;
    page.push(items[index]);
    bytes += size;
  }
  return { items: page, nextCursor: cursor + page.length < items.length ? cursor + page.length : null, revision };
}
