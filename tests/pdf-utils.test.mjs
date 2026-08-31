import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceBaseName,
  createJpegPdf,
  extractEvidenceIdentifiers,
  sanitizeEvidenceName,
} from "../src/pdfUtils.js";

test("builds evidence filenames from payment, license, and preferred match numbers", () => {
  const message = {
    body: "تم تسجيل رقم السداد ٢٠٠٠٠٠٠٠ للرخصة رقم (121212121)",
    address: "EJADA",
    date: 1710000000000,
    id: "message-1",
  };
  assert.deepEqual(extractEvidenceIdentifiers(message), ["20000000", "121212121"]);
  assert.equal(buildEvidenceBaseName(message, "20000000"), "20000000-121212121");
});

test("falls back to generic message numbers and produces filesystem-safe names", () => {
  const message = { body: "تم تنفيذ العملية ١٥٢٣٥٢١٧٧٧ بنجاح", address: "STC/Pay", id: "message:2" };
  assert.equal(buildEvidenceBaseName(message), "1523521777");
  assert.equal(sanitizeEvidenceName('A/B:*? "test"'), "A-B-test");
});

test("does not mistake visit dates for evidence identifiers", () => {
  const message = {
    body: "تمت زيارة الحفرية بتاريخ 2023-04-16 وسيتم إشعاركم بالتفاصيل",
    address: "EJADA",
    date: 1710000000000,
    id: "message-visit-date",
  };
  assert.deepEqual(extractEvidenceIdentifiers(message), []);
  assert.match(buildEvidenceBaseName(message), /^EJADA-/);
});

test("creates a structurally complete PDF with one JPEG image per page", async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = createJpegPdf([
    { bytes: jpeg, width: 400, height: 800 },
    { bytes: jpeg, width: 400, height: 800 },
  ]);
  const text = new TextDecoder("latin1").decode(await pdf.arrayBuffer());
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /xref\n0 9/);
  assert.match(text, /%%EOF\n$/);
});
