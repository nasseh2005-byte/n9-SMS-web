import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("publishes real N9 favicon and light/dark logo assets", async () => {
  const [html, app, favicon, lightLogo, darkLogo] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("public/favicon-256.png", root)),
    readFile(new URL("public/n9-logo-pearl-512.png", root)),
    readFile(new URL("public/n9-logo-night-512.png", root)),
  ]);

  assert.match(html, /href="\/favicon-256\.png"/);
  assert.match(html, /href="\/n9-logo-pearl-512\.png"/);
  assert.match(app, /welcomeTheme === "dark" \? "\/n9-logo-night-512\.png" : "\/n9-logo-pearl-512\.png"/);
  assert.match(app, /theme === "dark" \? "\/n9-logo-night-512\.png" : "\/n9-logo-pearl-512\.png"/);
  for (const image of [favicon, lightLogo, darkLogo]) {
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(image.length > 10_000);
  }
});

test("internal pearl and night theme overrides do not target evidence or export screens", async () => {
  const css = await readFile(new URL("src/styles.css", root), "utf8");
  const themeSection = css.split("/* واجهة التطبيق فقط:")[1]?.split("@media (max-width: 1220px)")[0] || "";
  assert.match(themeSection, /\.app-shell\.theme-light/);
  assert.match(themeSection, /\.app-shell\.theme-dark/);
  assert.doesNotMatch(themeSection, /\.export-capture|\.phone-screen|\.iphone-evidence|\.message-proof|\.proof-details/);
});

test("keeps the signed-out hero static without archive hotspots or feature tiles", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);

  assert.doesNotMatch(app, /activeArchive|archiveFeatures|archiveHint|archive-hotspot|welcome-mobile-files|welcome-mobile-detail/);
  assert.doesNotMatch(css, /archive-hotspot|welcome-archive-hint|welcome-mobile-files|welcome-mobile-detail/);
  assert.match(app, /className="welcome-primary-action"/);
  assert.match(app, /className="welcome-mobile-login"/);
});
