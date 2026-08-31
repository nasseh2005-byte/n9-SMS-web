import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SCHEMA,
  createPasswordRecord,
  handleVercelApi,
  resolveApiPath,
  verifyPassword,
} from "../server/vercelApi.js";

test("Vercel passwords use PBKDF2 and reject a different PIN", async () => {
  const record = await createPasswordRecord("2005");
  const user = {
    password_salt: record.salt,
    password_hash: record.hash,
    password_iterations: record.iterations,
  };
  assert.notEqual(record.hash, "2005");
  assert.equal(await verifyPassword("2005", user), true);
  assert.equal(await verifyPassword("2006", user), false);
});

test("Vercel catch-all rewrite preserves nested API routes", () => {
  assert.equal(
    resolveApiPath(new Request("https://n9.example/api/index?path=workspaces/company-1/archive/upload-url")),
    "/api/workspaces/company-1/archive/upload-url",
  );
  assert.equal(resolveApiPath(new Request("https://n9.example/api/auth/me")), "/api/auth/me");
});

test("Vercel schema includes optimistic archive versions and shared sessions", () => {
  const schema = POSTGRES_SCHEMA.join("\n");
  assert.match(schema, /archive_version BIGINT NOT NULL DEFAULT 0/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(schema, /LOWER\(username\)/);
});

test("Vercel API reports missing cloud configuration without falling back locally", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleVercelApi(new Request("https://n9.example/api/auth/me"));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Neon/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
