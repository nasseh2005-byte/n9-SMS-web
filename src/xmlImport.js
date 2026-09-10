import { SaxesParser } from "saxes";
import { normalizeMessageIdentity, parseXmlTimestamp } from "./dataUtils.js";

function iphoneTimestamp(iso, rawAppleDate) {
  // An explicit offset is required: never interpret source dates in the browser's timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    const date = Date.parse(iso);
    if (Number.isFinite(date) && date > 0) return date;
  }
  // This export stores Apple nanoseconds since 2001. Keep the original string intact.
  if (/^\d+$/.test(rawAppleDate) && BigInt(rawAppleDate) > 0n) {
    const date = Number(BigInt(rawAppleDate) / 1_000_000n + 978307200000n);
    if (Number.isSafeInteger(date) && date > 0 && date <= 8640000000000000) return date;
  }
  return null;
}

function fromIphone(fields, attributes) {
  const direction = (fields.direction || "").trim().toLowerCase();
  if (!["incoming", "outgoing"].includes(direction)) {
    throw new Error("إحدى رسائل iPhone لا تحتوي اتجاهًا صحيحًا (incoming أو outgoing). لم يُحفظ الملف.");
  }
  const address = (fields.conversation || fields.party || "").trim() || "غير معروف";
  const rawDate = (fields.date_ksa || "").trim();
  const rawAppleDate = (fields.apple_date_raw || "").trim();
  return normalizeMessageIdentity({
    id: attributes.guid ? `iphone-${attributes.guid}` : `xml-${crypto.randomUUID()}`,
    address,
    contactName: address,
    date: iphoneTimestamp(rawDate, rawAppleDate),
    dateSent: null,
    rawDate,
    rawAppleDate,
    type: direction === "outgoing" ? "2" : "1",
    read: fields.is_read?.trim() === "true" ? "1" : "0",
    body: fields.text || "",
    service: (fields.service || "").trim(),
    isDelivered: fields.is_delivered?.trim() === "true",
    hasAttachments: fields.has_attachments?.trim() === "true",
    ...(fields.subject ? { subject: fields.subject } : {}),
  });
}

function fromSms(a) {
  return normalizeMessageIdentity({
    id: `xml-${crypto.randomUUID()}`,
    address: a.address || "غير معروف",
    contactName: a.contact_name || a.address || "غير معروف",
    date: parseXmlTimestamp(a.date),
    dateSent: parseXmlTimestamp(a.date_sent),
    rawDate: a.date || "",
    rawDateSent: a.date_sent || "",
    readableDate: a.readable_date || "",
    type: a.type || "1",
    read: a.read || "1",
    status: a.status || "0",
    body: a.body || "",
  });
}

// Streaming parsing avoids constructing a DOM with millions of nodes for large archives.
export function createXmlMessageParser() {
  const parser = new SaxesParser();
  const messages = [];
  const path = [];
  let fields;
  let attributes;
  let expectedCount;
  parser.on("error", () => { throw new Error("تعذر قراءة ملف XML لأنه غير صالح أو غير مكتمل. أعد تصديره ثم حاول مجددًا."); });
  parser.on("opentag", (node) => {
    path.push(node.name);
    if (path.join("/") === "iphone_messages/messages") {
      const count = node.attributes.count;
      if (count !== undefined && /^\d+$/.test(count)) expectedCount = Number(count);
    }
    if (path.join("/") === "iphone_messages/messages/message") {
      fields = Object.create(null);
      attributes = node.attributes;
    } else if (fields && path.length === 4) {
      fields[node.name] = "";
    } else if (path[0] !== "iphone_messages" && node.name === "sms") {
      messages.push(fromSms(node.attributes));
    }
  });
  const appendText = (text) => {
    if (fields && path.length === 4) fields[path[3]] += text;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    if (fields && path.length === 3) {
      messages.push(fromIphone(fields, attributes));
      fields = undefined;
    }
    path.pop();
  });
  return {
    write(text) { parser.write(text); },
    finish() {
      parser.close();
      if (!messages.length) throw new Error("لم نجد رسائل بصيغة مدعومة. يدعم الموقع XML من SMS Backup & Restore وتصدير iPhone بصيغة iphone_messages.");
      if (expectedCount !== undefined && expectedCount !== messages.length) {
        throw new Error("عدد رسائل iPhone لا يطابق العدد المسجل في الملف. أعد تصدير الملف كاملًا.");
      }
      return messages;
    },
  };
}

export function parseXmlMessages(text) {
  const parser = createXmlMessageParser();
  parser.write(text);
  return parser.finish();
}

export function mergeMessageArchives(currentMessages, importedMessages) {
  // iPhone GUIDs distinguish separate messages even with identical text and second timestamps.
  const keyFor = (message) => message.id?.startsWith("iphone-")
    ? message.id
    : JSON.stringify([message.address, message.date, message.type, message.body]);
  const seen = new Set(currentMessages.map(keyFor));
  const merged = [...currentMessages];
  for (const message of importedMessages) {
    const key = keyFor(message);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return merged.sort((a, b) => Number(a.date) - Number(b.date));
}
