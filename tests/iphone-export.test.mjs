import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("iPhone evidence export stays a compact conversation crop instead of a details screen", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const iphoneComponent = app.slice(
    app.indexOf("function IphoneEvidencePhone"),
    app.indexOf("function EvidencePhone"),
  );

  assert.match(app, /deviceStyle === "iphone"\) return <IphoneEvidencePhone/);
  assert.match(app, /iphone-export-capture/);
  assert.match(iphoneComponent, /iphone-evidence-header/);
  assert.match(iphoneComponent, /iphone-evidence-bubble/);
  assert.match(iphoneComponent, /formatIphoneEvidenceDate\(message\?\.date\)/);
  assert.doesNotMatch(iphoneComponent, /details-header|status-list|proof-meta-grid|التفاصيل|الحالة|الأولوية/);
  assert.match(styles, /\.export-capture\.iphone-export-capture[\s\S]*width: 562\.5px; height: 441\.75px;/);
  assert.match(styles, /\.iphone-evidence-bubble \.message-link/);
  assert.match(styles, /\.message-link\.is-number \{[^}]*white-space: nowrap/);
});
