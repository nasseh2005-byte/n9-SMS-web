import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel publishes the dedicated browser-local Vite build", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.framework, "vite");
  assert.equal(config.buildCommand, "npm run build:vercel");
  assert.equal(config.outputDirectory, "dist/client");
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
});

test("Vercel mode explicitly selects local browser storage", async () => {
  const environment = await readFile(new URL("../.env.vercel", import.meta.url), "utf8");
  const workspaceApi = await readFile(new URL("../src/workspaceApi.js", import.meta.url), "utf8");
  assert.match(environment, /^VITE_N9_STORAGE_MODE=local\s*$/);
  assert.match(workspaceApi, /VITE_N9_STORAGE_MODE === "local"/);
});
