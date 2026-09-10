import assert from "node:assert/strict";
import test from "node:test";
import { conversationCatalogue, conversationPage, decodeConversationPolicy, filterConversationArchive, validateConversationPolicy } from "../src/conversationAccess.js";
import { workspacesRoute as vercelWorkspaces, usersRoute as vercelUsers } from "../server/vercelApi.js";
import { workspacesRoute as sitesWorkspaces, usersRoute as sitesUsers } from "../worker/index.js";

const archive = { sourceName: "private-source.xml", messages: [
  { id: "a", address: "EJADH", body: "allowed", date: 1700000000000 },
  { id: "b", address: "BANK", body: "hidden" },
  { id: "c", address: "EJADA", body: "also allowed" },
] };
const user = { id: "u1", role: "user" };
const row = { addresses: '["EJADA"]', revision: "r1" };
const workspace = { id: "w1", archive_key: "private/archive.json", archive_version: 2 };

test("conversation grants are exact and normalized consistently without altering messages", () => {
  const filtered = filterConversationArchive(archive, decodeConversationPolicy(row));
  assert.deepEqual(filtered.messages.map((message) => message.id), ["a", "c"]);
  assert.equal(filtered.messages[0], archive.messages[0]);
  assert.equal(filtered.messages[0].date, 1700000000000);
  assert.equal(filtered.readOnly, true);
  assert.notEqual(filtered.sourceName, archive.sourceName);
  assert.equal(filterConversationArchive(archive, { mode: "selected", addresses: ["EJA"] }).messages.length, 0);
  assert.deepEqual(conversationCatalogue(archive.messages).find((item) => item.address === "EJADA"), { address: "EJADA", name: "EJADA", count: 2 });
});

test("empty or corrupt stored selections deny access; explicit all and legacy grants stay all", () => {
  for (const addresses of ["[]", "invalid", '{}', '[42]']) {
    assert.equal(filterConversationArchive(archive, decodeConversationPolicy({ addresses })).messages.length, 0);
  }
  assert.equal(decodeConversationPolicy(null).mode, "all");
  assert.equal(decodeConversationPolicy({ addresses: "null", revision: "all-1" }).mode, "all");
  assert.throws(() => validateConversationPolicy({ mode: "selected", addresses: "EJADA" }));
  assert.throws(() => validateConversationPolicy({ mode: "typo", addresses: [] }));
  assert.deepEqual(validateConversationPolicy({ mode: "selected", addresses: ["EJADA", "EJADA"] }).addresses, ["EJADA"]);
});

test("paged archives enforce size, preserve all rows, and reject a changed permission revision", () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id, body: "نص" }));
  const first = conversationPage(rows, new URL("https://app.test/archive"), "v1");
  assert.equal(first.items.length, 1000);
  const last = conversationPage(rows, new URL(`https://app.test/archive?cursor=${first.nextCursor}&revision=v1`), "v1");
  assert.deepEqual([...first.items, ...last.items], rows);
  assert.equal(last.nextCursor, null);
  assert.throws(() => conversationPage(rows, new URL("https://app.test/archive?cursor=1000&revision=v1"), "v2"), { status: 409 });
  assert.throws(() => conversationPage(rows, new URL("https://app.test/archive?cursor=-1"), "v1"));
  const large = Array.from({ length: 10 }, (_, id) => ({ id, body: "س".repeat(200000) }));
  const page = conversationPage(large, new URL("https://app.test/archive"), "v1");
  assert.ok(new TextEncoder().encode(JSON.stringify(page)).length < 3.1 * 1024 * 1024);
  assert.ok(page.nextCursor < large.length);
});

function fakeSql({ member = true, policy = row } = {}) {
  return { query: async (query) => {
    if (query.includes("SELECT 1 AS allowed")) return member ? [{ allowed: 1 }] : [];
    if (query.includes("SELECT * FROM workspaces")) return [workspace];
    if (query.includes("SELECT addresses,revision")) return policy ? [policy] : [];
    throw new Error(`Unexpected SQL: ${query}`);
  } };
}

test("Vercel never exposes the company Blob URL to a restricted user or includes hidden SMS", async () => {
  const response = await vercelWorkspaces(new Request("https://app.test/api/workspaces/w1/archive"), fakeSql(), user, "/api/workspaces/w1/archive", { readArchive: async () => archive });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.messages.map((message) => message.id), ["a", "c"]);
  assert.equal(data.archiveUrl, undefined);
  assert.equal(JSON.stringify(data).includes("hidden"), false);
});

test("Vercel checks company membership and rejects restricted upload/complete requests", async () => {
  for (const action of ["upload-url", "complete"]) {
    const path = `/api/workspaces/w1/archive/${action}`;
    const response = await vercelWorkspaces(new Request(`https://app.test${path}`, { method: "POST" }), fakeSql(), user, path);
    assert.equal(response.status, 403);
  }
  const path = "/api/workspaces/w2/archive";
  const denied = await vercelWorkspaces(new Request(`https://app.test${path}`), fakeSql({ member: false }), user, path);
  assert.equal(denied.status, 403);
});

test("ordinary all-access users are paged through Vercel, not given a reusable original Blob link", async () => {
  const path = "/api/workspaces/w1/archive";
  const response = await vercelWorkspaces(new Request(`https://app.test${path}`), fakeSql({ policy: null }), user, path, { readArchive: async () => archive });
  const data = await response.json();
  assert.equal(data.messages.length, 3);
  assert.equal(data.archiveUrl, undefined);
});

test("Vercel refuses a response when permissions are revoked while the archive is being read", async () => {
  const path = "/api/workspaces/w1/archive";
  let revoked = false;
  const initial = fakeSql();
  const sql = { query: async (query) => query.includes("SELECT addresses,revision") && revoked
    ? [{ addresses: "[]", revision: "r2" }] : initial.query(query) };
  const response = await vercelWorkspaces(new Request(`https://app.test${path}`), sql, user, path,
    { readArchive: async () => { revoked = true; return archive; } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).messages, undefined);
});

function fakeEnv() {
  return {
    DB: { prepare(query) { return { bind() { return this; }, async first() {
      if (query.includes("SELECT 1 AS allowed")) return { allowed: 1 };
      if (query.includes("SELECT * FROM workspaces")) return workspace;
      if (query.includes("SELECT addresses,revision")) return row;
      throw new Error(`Unexpected SQL: ${query}`);
    } }; } },
    FILES: { get: async () => ({ json: async () => archive }) },
  };
}

test("Sites enforces the same filtered archive and read-only restriction", async () => {
  const path = "/api/workspaces/w1/archive";
  const response = await sitesWorkspaces(new Request(`https://app.test${path}`), fakeEnv(), user, path);
  assert.deepEqual((await response.json()).messages.map((message) => message.id), ["a", "c"]);
  const denied = await sitesWorkspaces(new Request(`https://app.test${path}`, { method: "PUT" }), fakeEnv(), user, path);
  assert.equal(denied.status, 403);
});

test("non-admins cannot read or modify another user's conversation grants on either server", async () => {
  const path = "/api/users/other/workspaces/w1/conversations";
  for (const method of ["GET", "PATCH"]) {
    const request = new Request(`https://app.test${path}`, { method });
    assert.equal((await vercelUsers(request, {}, user, path)).status, 403);
    assert.equal((await sitesUsers(request, {}, user, path)).status, 403);
  }
});
