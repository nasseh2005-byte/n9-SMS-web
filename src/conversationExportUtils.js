import { toIsoTimestamp } from "./dataUtils.js";

const TRAILING_URL_PUNCTUATION = /[\])}>.,!?:;،؛؟]+$/u;

export function extractMessageLinks(body) {
  const matches = String(body || "").match(/(?:https?:\/\/|www\.)[^\s<>"'`]+/giu) || [];
  return [...new Set(matches
    .map((value) => value.replace(TRAILING_URL_PUNCTUATION, ""))
    .filter(Boolean))];
}

export function buildConversationReferenceRows(messages, options = {}) {
  const conversationName = options.conversationName || "";
  const pdfFileNames = options.pdfFileNames || [];

  return (messages || []).map((message, index) => ({
    "التسلسل": index + 1,
    "اسم المحادثة": conversationName,
    "المرسل أو الرقم": message.address || "",
    "اسم جهة الاتصال": message.contactName || "",
    "اتجاه الرسالة": message.type === "2" ? "صادرة" : "واردة",
    "وقت الرسالة الأصلي": toIsoTimestamp(message.date),
    "وقت الإرسال الأصلي": toIsoTimestamp(message.dateSent),
    "وقت التسليم المحفوظ": toIsoTimestamp(message.deliveryDate),
    "محتوى الرسالة": message.body || "",
    "روابط موجودة في الرسالة": extractMessageLinks(message.body).join("\n"),
    "اسم ملف PDF": pdfFileNames[index] || "",
    "مصدر الرسالة": message.sourceKind === "manual" ? "منشأة يدويًا" : "XML",
    "معرف الرسالة": message.id || "",
  }));
}
