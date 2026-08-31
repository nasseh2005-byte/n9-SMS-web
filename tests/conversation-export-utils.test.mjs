import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationReferenceRows,
  extractMessageLinks,
} from "../src/conversationExportUtils.js";

test("extracts unique links from Arabic SMS text into a dedicated list", () => {
  assert.deepEqual(
    extractMessageLinks("راجع https://example.com/a، ثم www.example.sa/path). والرابط مكرر https://example.com/a"),
    ["https://example.com/a", "www.example.sa/path"],
  );
  assert.deepEqual(extractMessageLinks("رسالة بلا روابط"), []);
});

test("builds a complete conversation reference row without changing original timestamps", () => {
  const rows = buildConversationReferenceRows([{
    id: "sms-1",
    address: "EJADA",
    contactName: "EJADA",
    type: "1",
    date: 1_700_000_300_000,
    dateSent: 1_700_000_000_000,
    body: "رقم الرخصة 1523456789 https://example.sa/evidence",
  }], {
    conversationName: "EJADA",
    pdfFileNames: ["001-1523456789.pdf"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]["اسم المحادثة"], "EJADA");
  assert.equal(rows[0]["اتجاه الرسالة"], "واردة");
  assert.equal(rows[0]["وقت الرسالة الأصلي"], "2023-11-14T22:18:20.000Z");
  assert.equal(rows[0]["وقت الإرسال الأصلي"], "2023-11-14T22:13:20.000Z");
  assert.equal(rows[0]["روابط موجودة في الرسالة"], "https://example.sa/evidence");
  assert.equal(rows[0]["اسم ملف PDF"], "001-1523456789.pdf");
  assert.equal(rows[0]["مصدر الرسالة"], "XML");
});

test("keeps multiple links in one Excel column and marks manual outgoing messages", () => {
  const [row] = buildConversationReferenceRows([{
    id: "manual-1",
    address: "N9",
    contactName: "شركة الاختبار",
    type: "2",
    sourceKind: "manual",
    body: "https://one.example و https://two.example/path",
  }]);

  assert.equal(row["اتجاه الرسالة"], "صادرة");
  assert.equal(row["مصدر الرسالة"], "منشأة يدويًا");
  assert.equal(row["روابط موجودة في الرسالة"], "https://one.example\nhttps://two.example/path");
});
