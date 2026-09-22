import test from "node:test";
import assert from "node:assert/strict";
import { createArchiveReader } from "../server/archiveCache.js";
import { collectArchivePages } from "../src/archiveDownload.js";
import { conversationPage } from "../src/conversationAccess.js";

test("immutable archive cache deduplicates concurrent reads, expires, and isolates keys", async () => {
  let calls = 0;
  let time = 0;
  const read = createArchiveReader(async (key) => { calls++; return { messages: [key] }; }, { ttlMs: 60, now: () => time });
  const [first, second] = await Promise.all([read("company-a/version1"), read("company-a/version1")]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.deepEqual(await read("company-b/version1"), { messages: ["company-b/version1"] });
  assert.equal(calls, 2);
  await read("company-a/version1");
  assert.equal(calls, 3); // only one object retained
  time = 61;
  await read("company-a/version1");
  assert.equal(calls, 4);
  await read("company-a/version2");
  assert.equal(calls, 5);
  assert.deepEqual(await read(null), { messages: [] });
});

test("failed archive reads are never cached as empty successful archives", async () => {
  let calls = 0;
  const read = createArchiveReader(async () => { if (++calls === 1) throw new Error("offline"); return { messages: [1] }; });
  await assert.rejects(read("key"), /offline/);
  assert.deepEqual(await read("key"), { messages: [1] });
  assert.equal(calls, 2);
});

test("larger message pages keep the byte bound and deliver every row with progress", async () => {
  const rows = Array.from({ length: 34783 }, (_, id) => ({ id, body: "رسالة تجريبية" }));
  const page = (cursor) => {
    const result = conversationPage(rows, new URL(`https://example.test/?cursor=${cursor}&revision=v1`), "v1", { limit: 10000 });
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).length < 3.1 * 1024 * 1024);
    return { ...result, messages: result.items, total: rows.length };
  };
  let requests = 1;
  const progress = [];
  const result = await collectArchivePages(page(0), async (cursor) => { requests++; return page(cursor); }, { onProgress: (value) => progress.push(value) });
  assert.equal(requests, 4);
  assert.deepEqual(result.messages, rows);
  assert.deepEqual(progress.map((item) => item.loaded), [10000, 20000, 30000, 34783]);
  assert.equal(progress.at(-1).total, rows.length);
});

test("paging rejects permission changes, incomplete downloads, and stalled cursors", async () => {
  const first = { messages: [1], total: 2, nextCursor: 1, revision: "v1" };
  await assert.rejects(collectArchivePages(first, async () => ({ messages: [2], total: 2, nextCursor: null, revision: "v2" })), /الصلاحيات/);
  await assert.rejects(collectArchivePages({ ...first, nextCursor: null }, async () => {}), /لم يكتمل/);
  await assert.rejects(collectArchivePages(first, async () => ({ messages: [], total: 2, nextCursor: 1, revision: "v1" })), /متابعة/);
  await assert.rejects(collectArchivePages(first, async () => { throw new Error("network"); }), /network/);
});

test("cancelling a company load stops further requests and prevents publishing stale messages", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(collectArchivePages({ messages: [1], nextCursor: 1, revision: "v1", total: 3 }, async () => {
    calls++;
    controller.abort();
    return { messages: [2], nextCursor: 2, revision: "v1", total: 3 };
  }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});
