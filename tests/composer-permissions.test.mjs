import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasManualMessageChanges } from "../src/archivePermissions.js";

const manualMessage = {
  id: "manual-1",
  address: "EJADA",
  contactName: "EJADA",
  body: "رسالة أنشأها المشرف",
  date: 1788174000000,
  dateSent: 1788174000000,
  type: "1",
  sourceKind: "manual",
};

test("ordinary archive imports may retain unchanged admin-created messages", () => {
  const importedXmlMessage = { id: "xml-1", body: "XML", sourceKind: "xml" };
  assert.equal(hasManualMessageChanges([manualMessage], [manualMessage, importedXmlMessage]), false);
});

test("adding, editing, or removing a manually created message is detected", () => {
  assert.equal(hasManualMessageChanges([], [manualMessage]), true);
  assert.equal(hasManualMessageChanges([manualMessage], [{ ...manualMessage, body: "محتوى معدل" }]), true);
  assert.equal(hasManualMessageChanges([manualMessage], []), true);
});

test("message composer is hidden and guarded for non-admin users across app and hosted storage", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const vercelApi = await readFile(new URL("../server/vercelApi.js", import.meta.url), "utf8");
  const sitesWorker = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");

  assert.match(app, /canCreateManualMessages = currentUser\?\.role === "admin"/);
  assert.match(app, /if \(!canCreateManualMessages\)[\s\S]*منشئ الرسالة متاح للمشرف فقط/);
  assert.match(app, /canCreateManualMessages && composerOpen && <MessageComposerDialog/);
  assert.match(vercelApi, /user\.role !== "admin"[\s\S]*hasManualMessageChanges/);
  assert.match(sitesWorker, /user\.role !== "admin"[\s\S]*hasManualMessageChanges/);
});
