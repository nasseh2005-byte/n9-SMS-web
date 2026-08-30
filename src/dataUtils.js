const HEADER_HINTS = [
  "رقم", "مرجع", "رخصة", "مخالفة", "طلب", "سداد", "فاتورة", "معاملة", "هوية", "سجل", "مطابقة", "رمز",
  "number", "reference", "ref", "identifier", "invoice", "license", "violation", "request", "payment", "transaction", "match", "code",
];

export function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

export function normalizeComparable(value) {
  return normalizeDigits(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function filterConversationMessages(messages, query, conversation = {}) {
  const normalizeSearchText = (value) => normalizeComparable(value)
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...(messages || [])];

  return (messages || []).filter((message) => normalizeSearchText([
    message?.body,
    message?.address || conversation?.address,
    message?.contactName || conversation?.contactName,
  ].filter(Boolean).join(" ")).includes(normalizedQuery));
}

export function expandScientificNotation(value) {
  const text = normalizeDigits(value).trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return text;

  const [, sign, integerPart, fractionPart = "", exponentText] = match;
  const digits = `${integerPart}${fractionPart}`;
  const decimalPosition = integerPart.length + Number(exponentText);
  let expanded;
  if (decimalPosition <= 0) expanded = `0.${"0".repeat(Math.abs(decimalPosition))}${digits}`;
  else if (decimalPosition >= digits.length) expanded = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  else expanded = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return `${sign === "-" ? "-" : ""}${expanded}`;
}

function looksLikeDate(value) {
  const text = normalizeDigits(value).trim();
  return /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}(?:\s|$)/.test(text)
    || /^\d{1,2}:\d{2}(?::\d{2})?(?:\s|$)/.test(text);
}

export function extractNumericTermsFromValue(value) {
  if (value === null || value === undefined || value === "" || value instanceof Date) return [];
  const normalized = normalizeDigits(value).trim();
  if (!normalized || looksLikeDate(normalized)) return [];

  const expanded = expandScientificNotation(normalized);
  if (/^-?\d+\.\d+$/.test(expanded) && !/\.0+$/.test(expanded)) return [];
  const integerScientific = /^-?\d+\.0+$/.test(expanded) ? expanded.replace(/\.0+$/, "") : expanded;
  const compact = integerScientific.replace(/(?<=\d)[\s,،٬-](?=\d)/g, "");
  return compact.match(/[0-9]{4,}/g) || [];
}

function headerMatches(value) {
  if (/[0-9]{4,}/.test(normalizeDigits(value))) return false;
  const normalized = normalizeComparable(value);
  return HEADER_HINTS.some((hint) => {
    const normalizedHint = normalizeComparable(hint);
    return ["id", "ref"].includes(normalizedHint) ? normalized === normalizedHint : normalized.includes(normalizedHint);
  });
}

export function extractWorkbookTerms(workbook, spreadsheetApi) {
  const terms = [];
  let scannedCells = 0;
  let ignoredDateCells = 0;
  let scientificCells = 0;
  let selectedColumnCount = 0;
  let fallbackSheetCount = 0;
  let ambiguousSheetCount = 0;
  let unsafePrecisionCells = 0;

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    unsafePrecisionCells += Object.entries(sheet).filter(([address, cell]) => (
      !address.startsWith("!")
      && cell?.t === "n"
      && Number.isInteger(cell.v)
      && Math.abs(cell.v) >= 1e15
    )).length;
    const rows = spreadsheetApi.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });
    if (!rows.length) continue;

    const headerRowIndex = rows.slice(0, 10).findIndex((row) => row.some(headerMatches));
    const selectedColumns = headerRowIndex >= 0
      ? rows[headerRowIndex].flatMap((value, index) => headerMatches(value) ? [index] : [])
      : [];
    selectedColumnCount += selectedColumns.length;
    const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : rows;
    if (headerRowIndex < 0) {
      fallbackSheetCount += 1;
      const populatedColumns = new Set(dataRows.flatMap((row) => row.flatMap((value, index) => String(value ?? "").trim() ? [index] : [])));
      if (populatedColumns.size > 1) ambiguousSheetCount += 1;
    }

    for (const row of dataRows) {
      const values = selectedColumns.length ? selectedColumns.map((index) => row[index]) : row;
      for (const value of values) {
        if (value === "" || value === null || value === undefined) continue;
        scannedCells += 1;
        if (looksLikeDate(value)) {
          ignoredDateCells += 1;
          continue;
        }
        if (/[eE][+-]?\d+/.test(normalizeDigits(value))) scientificCells += 1;
        terms.push(...extractNumericTermsFromValue(value));
      }
    }
  }

  const uniqueTerms = [...new Set(terms)];
  return {
    terms: uniqueTerms,
    diagnostics: {
      sheetCount: workbook.SheetNames?.length || 0,
      scannedCells,
      selectedColumnCount,
      fallbackSheetCount,
      ambiguousSheetCount,
      unsafePrecisionCells,
      ignoredDateCells,
      scientificCells,
      duplicateCount: terms.length - uniqueTerms.length,
    },
  };
}

export function extractTerms(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,،;|]+/)
      .map((item) => normalizeComparable(item))
      .filter((item) => item.length >= 3),
  )];
}

function extractMessageNumberTokens(message) {
  const source = normalizeDigits(`${message.body || ""} ${message.address || ""} ${message.contactName || ""}`);
  const formattedSequences = source.match(/(?:[0-9][\s,،٬()\-]*){3,}/g) || [];
  const plainSequences = source.match(/[0-9]{3,}/g) || [];
  return new Set([
    ...plainSequences,
    ...formattedSequences.map((sequence) => sequence.replace(/\D/g, "")),
  ].filter((item) => item.length >= 3));
}

function scoreMessage(message, term) {
  const compactTerm = normalizeComparable(term);
  const body = normalizeDigits(message.body || "");
  const sender = normalizeDigits(`${message.address || ""} ${message.contactName || ""}`);
  const compactBody = normalizeComparable(body);
  const compactSender = normalizeComparable(sender);
  const occurrences = compactTerm ? compactBody.split(compactTerm).length - 1 : 0;
  const evidenceWords = ["رقم", "مرجع", "رخصة", "طلب", "سداد", "مخالفة", "فاتورة", "عملية", "زيارة"];
  let score = 0;
  if (compactBody.includes(compactTerm)) score += 60;
  if (compactSender.includes(compactTerm)) score += 22;
  score += Math.min(occurrences, 3) * 12;
  score += evidenceWords.filter((word) => body.includes(word)).length * 4;
  if (/https?:\/\//i.test(body)) score += 4;
  if (message.contactName && message.contactName !== "(Unknown)") score += 3;
  return score;
}

export function buildMatches(messages, terms) {
  const normalizedTerms = [...new Set(terms.map((term) => normalizeComparable(term)).filter(Boolean))];
  const numericTerms = new Set(normalizedTerms.filter((term) => /^\d+$/.test(term)));
  const textTerms = normalizedTerms.filter((term) => !/^\d+$/.test(term));
  const output = [];

  for (const message of messages) {
    const hitTerms = [];
    const numberTokens = extractMessageNumberTokens(message);
    for (const token of numberTokens) {
      if (numericTerms.has(token)) hitTerms.push(token);
    }
    if (textTerms.length) {
      const haystack = normalizeComparable(`${message.body || ""} ${message.address || ""} ${message.contactName || ""}`);
      for (const term of textTerms) if (haystack.includes(term)) hitTerms.push(term);
    }

    const uniqueHits = [...new Set(hitTerms)];
    if (uniqueHits.length) {
      output.push({
        message,
        terms: uniqueHits,
        scoreByTerm: Object.fromEntries(uniqueHits.map((term) => [term, scoreMessage(message, term)])),
      });
    }
  }
  return output;
}

export function parseXmlTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const EJADA_ADDRESS_ALIASES = new Set(["AMANA 940", "EJADH", "EJADA"]);

export function normalizeMessageIdentity(message) {
  const address = String(message?.address || "").trim();
  const contactName = String(message?.contactName || "").trim();
  const isEjada = EJADA_ADDRESS_ALIASES.has(address.toUpperCase())
    || normalizeComparable(contactName).includes(normalizeComparable("أمانة جدة"));
  return isEjada ? { ...message, address: "EJADA", contactName: "EJADA" } : message;
}

function parseManualDateTime(value, label) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error(`أدخل ${label} بشكل صحيح.`);
  return timestamp;
}

export function buildManualMessage(input, id = `manual-${Date.now()}`) {
  const body = String(input?.body || "").trim();
  if (!body) throw new Error("اكتب محتوى الرسالة أولًا.");

  const mode = input?.conversationMode === "new" ? "new" : "existing";
  const existingAddress = String(input?.existingAddress || "").trim();
  const newConversationName = String(input?.newConversationName || "").trim();
  const newSender = String(input?.newSender || "").trim();
  const address = mode === "new" ? (newSender || newConversationName) : existingAddress;
  const contactName = mode === "new" ? newConversationName : String(input?.existingContactName || address).trim();
  if (!address) throw new Error(mode === "new" ? "أدخل اسم أو رقم المرسل." : "اختر المحادثة التابعة لها الرسالة.");
  if (mode === "new" && !contactName) throw new Error("أدخل اسم المحادثة الجديدة.");

  const direction = input?.direction === "outgoing" ? "outgoing" : "incoming";
  const sentAt = parseManualDateTime(input?.sentAt, "تاريخ ووقت الإرسال");
  const completedAt = parseManualDateTime(input?.completedAt, direction === "incoming" ? "تاريخ ووقت الاستلام" : "تاريخ ووقت التسليم");
  if (completedAt < sentAt) throw new Error(direction === "incoming" ? "وقت الاستلام يجب أن يكون بعد وقت الإرسال." : "وقت التسليم يجب أن يكون بعد وقت الإرسال.");

  return normalizeMessageIdentity({
    id,
    address,
    contactName,
    date: direction === "incoming" ? completedAt : sentAt,
    dateSent: sentAt,
    ...(direction === "outgoing" ? { deliveryDate: completedAt } : {}),
    type: direction === "outgoing" ? "2" : "1",
    read: "1",
    status: "0",
    body,
    sourceKind: "manual",
  });
}

function getLogicalDelay(message) {
  const seed = [...String(message?.id || message?.body || "n9")]
    .reduce((total, character) => total + character.codePointAt(0), 0);
  return 3 + (seed % 3);
}

function missingRow(label) {
  return { label, at: null, source: "غير موجود في XML", estimated: false, missing: true };
}

export function getMessageTimeline(message) {
  const xmlDate = parseXmlTimestamp(message?.date);
  const xmlDateSent = parseXmlTimestamp(message?.dateSent);
  const manualDeliveryDate = parseXmlTimestamp(message?.deliveryDate);
  const delayMinutes = getLogicalDelay(message);
  const delayMs = delayMinutes * 60 * 1000;
  const incoming = message?.type !== "2";

  if (incoming) {
    return {
      statusTime: xmlDate || xmlDateSent,
      rows: [
        xmlDate ? { label: "تم الاستلام", at: xmlDate, source: "XML · date", estimated: false } : missingRow("تم الاستلام"),
        xmlDateSent
          ? {
            label: "أرسلها المرسل",
            at: xmlDateSent,
            source: "XML · date_sent",
            estimated: false,
            warning: Boolean(xmlDate && xmlDateSent > xmlDate),
          }
          : xmlDate
            ? {
              label: "وقت الإرسال التقديري",
              at: xmlDate - delayMs,
              source: `تقديري · قبل ${delayMinutes} د`,
              estimated: true,
            }
            : missingRow("وقت الإرسال"),
      ],
    };
  }

  return {
    statusTime: xmlDate || xmlDateSent,
    rows: [
      xmlDate ? { label: "تم الإرسال", at: xmlDate, source: "XML · date", estimated: false } : missingRow("تم الإرسال"),
      manualDeliveryDate
        ? { label: "تم التسليم", at: manualDeliveryDate, source: "منشئ الرسالة", estimated: false }
        : xmlDateSent
        ? {
          label: "وقت الإرسال المسجل",
          at: xmlDateSent,
          source: "XML · date_sent",
          estimated: false,
          warning: Boolean(xmlDate && xmlDateSent > xmlDate),
        }
        : xmlDate
          ? {
            label: "تم التسليم التقديري",
            at: xmlDate + delayMs,
            source: `تقديري · بعد ${delayMinutes} د`,
            estimated: true,
          }
          : missingRow("وقت التسليم"),
    ],
  };
}

export function toIsoTimestamp(value) {
  const parsed = parseXmlTimestamp(value);
  return parsed ? new Date(parsed).toISOString() : "";
}

export function quoteCsvCell(value) {
  const text = String(value ?? "");
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
