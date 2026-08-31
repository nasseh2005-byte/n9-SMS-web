import { normalizeDigits, parseXmlTimestamp } from "./dataUtils.js";

const encoder = new TextEncoder();
const evidenceLabels = [
  "رقم السداد", "السداد", "رقم الرخصة", "الرخصة", "الترخيص", "رقم المخالفة", "المخالفة",
  "رقم الطلب", "الطلب", "رقم الزيارة", "الزيارة", "المرجع", "رقم المعاملة", "المعاملة",
  "payment", "license", "violation", "request", "visit", "reference", "transaction",
];

function addIdentifier(output, seen, value) {
  const normalizedValue = normalizeDigits(value).trim().replace(/^\(+|\)+$/g, "");
  if (/^\d{1,4}([/-])\d{1,2}\1\d{1,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(normalizedValue)) return;
  const digits = normalizedValue.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 32 || seen.has(digits)) return;
  seen.add(digits);
  output.push(digits);
}

export function extractEvidenceIdentifiers(message, preferredTerm = "") {
  const body = normalizeDigits(message?.body || "");
  const output = [];
  const seen = new Set();
  addIdentifier(output, seen, preferredTerm);

  for (const label of evidenceLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}(?:\\s+(?:رقم|number|no\\.?))?\\s*[:#(\\-]*\\s*((?:[0-9][\\s,،٬()#/-]*){4,})`, "gi");
    for (const match of body.matchAll(pattern)) addIdentifier(output, seen, match[1]);
  }

  if (output.length < 2) {
    const genericSequences = body.match(/(?:[0-9][\s,،٬()#-]*){4,}/g) || [];
    for (const sequence of genericSequences) {
      const trimmed = sequence.trim();
      if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(trimmed)) continue;
      addIdentifier(output, seen, trimmed);
      if (output.length >= 3) break;
    }
  }

  return output.slice(0, 3);
}

export function sanitizeEvidenceName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120);
}

export function buildEvidenceBaseName(message, preferredTerm = "") {
  const identifiers = extractEvidenceIdentifiers(message, preferredTerm);
  if (identifiers.length) return identifiers.join("-");

  const sender = sanitizeEvidenceName(message?.address || message?.contactName || "SMS") || "SMS";
  const timestamp = parseXmlTimestamp(message?.date)
    ? new Date(Number(message.date)).toISOString().replace(/[-:]/g, "").slice(0, 13)
    : "no-date";
  const id = sanitizeEvidenceName(message?.id || "message").slice(-24) || "message";
  return sanitizeEvidenceName(`${sender}-${timestamp}-${id}`);
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function imageDataUrlToJpeg(dataUrl, backgroundColor = "#ffffff", quality = 0.96) {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("تعذر تحويل صورة الدليل إلى PDF."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const jpegDataUrl = canvas.toDataURL("image/jpeg", quality);
  return { bytes: dataUrlBytes(jpegDataUrl), width: canvas.width, height: canvas.height };
}

function concatBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function ascii(value) {
  return encoder.encode(value);
}

function streamObject(dictionary, bytes) {
  return concatBytes([
    ascii(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    ascii("\nendstream"),
  ]);
}

export function createJpegPdf(images) {
  if (!Array.isArray(images) || !images.length) throw new Error("لا توجد صور لإنشاء ملف PDF.");
  const objectCount = 2 + (images.length * 3);
  const objects = Array(objectCount + 1);
  const pageReferences = images.map((_, index) => `${3 + (index * 3)} 0 R`).join(" ");
  objects[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length} >>`);

  images.forEach((image, index) => {
    const pageObject = 3 + (index * 3);
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const width = Math.max(1, Math.round(Number(image.width) * 0.75));
    const height = Math.max(1, Math.round(Number(image.height) * 0.75));
    const imageBytes = image.bytes instanceof Uint8Array ? image.bytes : new Uint8Array(image.bytes);
    const content = ascii(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`);

    objects[pageObject] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects[imageObject] = streamObject(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, imageBytes);
    objects[contentObject] = streamObject("", content);
  });

  const header = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const parts = [header];
  const offsets = Array(objectCount + 1).fill(0);
  let length = header.length;

  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    offsets[objectNumber] = length;
    const objectBytes = concatBytes([
      ascii(`${objectNumber} 0 obj\n`),
      objects[objectNumber],
      ascii("\nendobj\n"),
    ]);
    parts.push(objectBytes);
    length += objectBytes.length;
  }

  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  parts.push(ascii(xref));

  return new Blob(parts, { type: "application/pdf" });
}
