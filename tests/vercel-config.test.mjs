import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel publishes the Vite app with its server API before the SPA fallback", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.framework, "vite");
  assert.equal(config.buildCommand, "npm run build:vercel");
  assert.equal(config.outputDirectory, "dist/client");
  assert.equal(config.functions["api/index.js"].maxDuration, 300);
  assert.deepEqual(config.rewrites, [
    { source: "/api/:path*", destination: "/api/index?path=:path*" },
    { source: "/(.*)", destination: "/index.html" },
  ]);
});

test("Vercel mode explicitly selects shared server storage and direct Blob transfers", async () => {
  const environment = await readFile(new URL("../.env.vercel", import.meta.url), "utf8");
  const workspaceApi = await readFile(new URL("../src/workspaceApi.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(environment, /^VITE_N9_STORAGE_MODE=vercel\s*$/);
  assert.match(workspaceApi, /storageMode === "vercel"/);
  assert.match(workspaceApi, /archive\/upload-url/);
  assert.match(workspaceApi, /archive\/complete/);
  assert.equal(packageJson.dependencies["@neondatabase/serverless"], "1.1.0");
  assert.equal(packageJson.dependencies["@vercel/blob"], "2.8.0");
});
