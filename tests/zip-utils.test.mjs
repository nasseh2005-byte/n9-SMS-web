import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { StoredZipBuilder } from "../src/zipUtils.js";

test("builds a standards-compatible ZIP with Arabic paths and separate files", async () => {
  const zip = new StoredZipBuilder(new Date("2026-08-31T10:00:00Z"));
  zip.addFile("PDF/001-دليل.pdf", new TextEncoder().encode("pdf-one"));
  zip.addFile("مرجع-المحادثة.xlsx", new TextEncoder().encode("excel-reference"));

  const archive = await JSZip.loadAsync(await zip.toBlob().arrayBuffer());
  assert.equal(await archive.file("PDF/001-دليل.pdf").async("text"), "pdf-one");
  assert.equal(await archive.file("مرجع-المحادثة.xlsx").async("text"), "excel-reference");
});

test("refuses to mutate an archive after it has been finalized", () => {
  const zip = new StoredZipBuilder();
  zip.addFile("one.txt", new Uint8Array([1]));
  zip.toBlob();
  assert.throws(() => zip.addFile("two.txt", new Uint8Array([2])), /إغلاق ملف ZIP/);
});
