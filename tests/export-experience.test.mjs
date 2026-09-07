import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android and Huawei status bars use proportioned native-style indicators", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);
  const statusBar = app.slice(app.indexOf("function StatusBar"), app.indexOf("const LinkifiedBody"));

  assert.match(statusBar, /className="cellular-bars"/);
  assert.match(statusBar, /className="status-wifi"/);
  assert.match(statusBar, /className="status-battery"/);
  assert.match(statusBar, /deviceStyle === "huawei" \? "4G\+" : "4G"/);
  assert.match(styles, /\.cellular-bars i:nth-child\(4\) \{ height: 11px; \}/);
  assert.match(styles, /\.status-battery::after/);
});

test("full conversation export reports progress without blocking the workspace", async () => {
  const app = await readFile(new URL("src/App.jsx", root), "utf8");
  const progressComponent = app.slice(
    app.indexOf("function ConversationExportProgress"),
    app.indexOf("export function App"),
  );

  assert.match(progressComponent, /conversation-export-dock/);
  assert.match(progressComponent, /تصدير في الخلفية/);
  assert.match(progressComponent, /يمكنك متابعة استخدام الموقع/);
  assert.match(progressComponent, /onClick=\{onToggle\}/);
  assert.doesNotMatch(progressComponent, /dialog-backdrop|aria-modal/);
  assert.match(app, /const exportAppearance = \{ clockMode, customTime, deviceStyle, theme \};/);
  assert.match(app, /captureMessageImage\(conversationMessages\[index\], exportAppearance\)/);
});
