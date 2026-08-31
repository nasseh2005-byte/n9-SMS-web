import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildManualMessage,
  buildMatches,
  expandScientificNotation,
  extractNumericTermsFromValue,
  extractTerms,
  extractWorkbookTerms,
  filterConversationMessages,
  filterMatchCandidates,
  getMessageTimeline,
  normalizeDigits,
  normalizeMessageIdentity,
  parseXmlTimestamp,
  quoteCsvCell,
  toIsoTimestamp,
} from "../src/dataUtils.js";

function createWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
}

test("normalizes Arabic and Persian digits without changing other text", () => {
  assert.equal(normalizeDigits("١٥٩۱۷۱٤"), "1591714");
  assert.deepEqual(extractTerms("١٥٩١٧١٤\n۱۵۲۳۴۸۶۵۷۵\n1591714"), ["1591714", "1523486575"]);
});

test("filters one conversation by body text, contact name, or number", () => {
  const conversation = { address: "EJADA", contactName: "إجادة" };
  const messages = [
    { id: "one", body: "تم تسجيل مخالفة جديدة", address: "EJADA", contactName: "إجادة" },
    { id: "two", body: "رقم السداد ١٥٩١٧١٤", address: "EJADA", contactName: "إجادة" },
  ];

  assert.deepEqual(filterConversationMessages(messages, "مخالفة", conversation).map((item) => item.id), ["one"]);
  assert.deepEqual(filterConversationMessages(messages, "1591714", conversation).map((item) => item.id), ["two"]);
  assert.equal(filterConversationMessages(messages, "اجادة", conversation).length, 2);
  assert.equal(filterConversationMessages(messages, "", conversation).length, 2);
});

test("reuses the complete thread when conversation search is empty", () => {
  const messages = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), body: `رسالة ${index}` }));
  assert.equal(filterConversationMessages(messages, ""), messages);
});

test("filters match candidates by direction without removing the underlying results", () => {
  const candidates = [
    { message: { id: "incoming", type: "1", body: "رقم السداد ١٥٩١٧١٤", address: "EJADA" } },
    { message: { id: "outgoing", type: "2", body: "تم إرسال رقم 1591714", address: "N9" } },
  ];

  assert.deepEqual(filterMatchCandidates(candidates, "1591714", "incoming").map(({ message }) => message.id), ["incoming"]);
  assert.deepEqual(filterMatchCandidates(candidates, "", "outgoing").map(({ message }) => message.id), ["outgoing"]);
  assert.equal(filterMatchCandidates(candidates, "", "all").length, 2);
  assert.equal(candidates.length, 2);
});

test("expands scientific notation and rejects dates and fractional amounts", () => {
  assert.equal(expandScientificNotation("1.523486575E+9"), "1523486575");
  assert.equal(expandScientificNotation("2E+6"), "2000000");
  assert.deepEqual(extractNumericTermsFromValue("1.523486575E+9"), ["1523486575"]);
  assert.deepEqual(extractNumericTermsFromValue("13/04/2026"), []);
  assert.deepEqual(extractNumericTermsFromValue("1234.56"), []);
});

test("extracts only identifier columns across sheets and removes duplicates", () => {
  const workbook = createWorkbook({
    "طلبات عربية": [
      ["رقم الطلب", "التاريخ", "المبلغ"],
      ["١٥٩١٧١٤", "13/04/2026", "30,000"],
      ["۱۵۲۳۴۸۶۵۷۵", "14/04/2026", "25,000"],
    ],
    References: [
      ["Reference Number", "Paid Amount"],
      ["1.523486575E+9", "884291"],
      ["2E+6", "100000"],
    ],
  });

  const { terms, diagnostics } = extractWorkbookTerms(workbook, XLSX);
  assert.deepEqual(terms, ["1591714", "1523486575", "2000000"]);
  assert.equal(diagnostics.sheetCount, 2);
  assert.equal(diagnostics.selectedColumnCount, 2);
  assert.equal(diagnostics.duplicateCount, 1);
  assert.equal(diagnostics.scientificCells, 2);
});

test("falls back to scanning values when a sheet has no header", () => {
  const workbook = createWorkbook({ Sheet1: [["1591714"], ["1523486575"], ["13/04/2026"]] });
  const { terms, diagnostics } = extractWorkbookTerms(workbook, XLSX);
  assert.deepEqual(terms, ["1591714", "1523486575"]);
  assert.equal(diagnostics.ignoredDateCells, 1);
  assert.equal(diagnostics.ambiguousSheetCount, 0);
});

test("flags ambiguous headerless multi-column sheets instead of silently mixing amounts", () => {
  const workbook = createWorkbook({ Sheet1: [["1591714", "30,000"], ["1523486575", "25,000"]] });
  const { diagnostics } = extractWorkbookTerms(workbook, XLSX);
  assert.equal(diagnostics.ambiguousSheetCount, 1);
});

test("preserves leading zeros when Excel stores an identifier format", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["رقم الجوال"], [501234567]]);
  sheet.A2.z = "0000000000";
  XLSX.utils.book_append_sheet(workbook, sheet, "هواتف");
  const roundTripped = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const { terms } = extractWorkbookTerms(roundTripped, XLSX);
  assert.deepEqual(terms, ["0501234567"]);
});

test("detects identifiers that Excel numeric precision may already have damaged", () => {
  const workbook = createWorkbook({ Sheet1: [["رقم الهوية"], [1234567890123456]] });
  const { diagnostics } = extractWorkbookTerms(workbook, XLSX);
  assert.equal(diagnostics.unsafePrecisionCells, 1);
});

test("matches exact formatted identifiers without numeric substring collisions", () => {
  const messages = [
    { id: "a", body: "الطلب رقم (١٥٢٣٤٨٦٥٧٥)", address: "MISA", contactName: "الاستثمار", date: 1000 },
    { id: "b", body: "مرجع 915234865759", address: "BANK", contactName: "Bank", date: 2000 },
    { id: "c", body: "رقم السداد 1591714 والرخصة 1523486575", address: "AMANA", contactName: "أمانة", date: 3000 },
    { id: "d", body: "الرقمان 1591714 1523486575", address: "TEST", contactName: "اختبار", date: 4000 },
  ];
  const matches = buildMatches(messages, ["1523486575", "1591714"]);
  assert.deepEqual(matches.map((match) => [match.message.id, match.terms]), [
    ["a", ["1523486575"]],
    ["c", ["1591714", "1523486575"]],
    ["d", ["1591714", "1523486575"]],
  ]);
});

test("keeps XML timestamps exact and labels only missing values as estimates", () => {
  const exact = getMessageTimeline({ id: "exact", type: "1", date: 1_700_000_300_000, dateSent: 1_700_000_000_000 });
  assert.equal(exact.rows[0].at, 1_700_000_300_000);
  assert.equal(exact.rows[1].at, 1_700_000_000_000);
  assert.equal(exact.rows[0].estimated, false);
  assert.equal(exact.rows[1].estimated, false);

  const sourceOrderWarning = getMessageTimeline({ id: "source-order", type: "1", date: 1_700_000_000_000, dateSent: 1_700_000_300_000 });
  assert.equal(sourceOrderWarning.rows[1].at, 1_700_000_300_000);
  assert.equal(sourceOrderWarning.rows[1].warning, true);

  const derived = getMessageTimeline({ id: "missing-sent", type: "1", date: 1_700_000_300_000, dateSent: null });
  const delayMinutes = (derived.rows[0].at - derived.rows[1].at) / 60_000;
  assert.ok(delayMinutes >= 3 && delayMinutes <= 5);
  assert.equal(derived.rows[1].estimated, true);

  const missing = getMessageTimeline({ id: "missing-all", type: "1", date: null, dateSent: null });
  assert.equal(missing.statusTime, null);
  assert.equal(missing.rows[0].missing, true);
  assert.equal(missing.rows[1].missing, true);
});

test("invalid XML dates never become the current time or an invalid CSV date", () => {
  assert.equal(parseXmlTimestamp(""), null);
  assert.equal(parseXmlTimestamp("not-a-date"), null);
  assert.equal(parseXmlTimestamp("1700000000000"), 1_700_000_000_000);
  assert.equal(toIsoTimestamp(null), "");
  assert.equal(toIsoTimestamp("1700000000000"), "2023-11-14T22:13:20.000Z");
});

test("protects CSV exports from spreadsheet formula injection", () => {
  assert.equal(quoteCsvCell("=HYPERLINK(\"https://bad.example\")"), `"'=HYPERLINK(""https://bad.example"")"`);
  assert.equal(quoteCsvCell("1591714"), `"1591714"`);
});

test("normalizes the corrected EJADA sender identity", () => {
  assert.deepEqual(
    normalizeMessageIdentity({ id: "old", address: "AMANA 940", contactName: "أمانة جدة" }),
    { id: "old", address: "EJADA", contactName: "EJADA" },
  );
  assert.equal(normalizeMessageIdentity({ address: "Google", contactName: "Google" }).address, "Google");
});

test("builds a manual incoming message with exact logical timestamps", () => {
  const message = buildManualMessage({
    conversationMode: "new",
    newConversationName: "EJADA",
    newSender: "EJADA",
    direction: "incoming",
    body: "رسالة تجريبية رقم 1591714",
    sentAt: "2026-04-13T10:00:00Z",
    completedAt: "2026-04-13T10:04:00Z",
  }, "manual-test");
  assert.equal(message.id, "manual-test");
  assert.equal(message.address, "EJADA");
  assert.equal(message.type, "1");
  assert.equal(message.date - message.dateSent, 4 * 60 * 1000);
  assert.equal(message.sourceKind, "manual");
});

test("manual outgoing messages keep their delivery time", () => {
  const message = buildManualMessage({
    conversationMode: "existing",
    existingAddress: "Google",
    existingContactName: "Google",
    direction: "outgoing",
    body: "تم الإرسال",
    sentAt: "2026-04-13T10:00:00Z",
    completedAt: "2026-04-13T10:05:00Z",
  }, "manual-outgoing");
  const timeline = getMessageTimeline(message);
  assert.equal(message.type, "2");
  assert.equal(timeline.rows[0].label, "تم الإرسال");
  assert.equal(timeline.rows[1].label, "تم التسليم");
  assert.equal(timeline.rows[1].at - timeline.rows[0].at, 5 * 60 * 1000);
});
