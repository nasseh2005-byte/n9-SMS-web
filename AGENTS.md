# Prototype Instructions

Read `N9-SMS-WEB-HANDOFF.md` completely before substantial feature, data-model, storage, authentication, or deployment work. Keep it updated when a durable feature or architectural decision changes.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable product decisions

- SMS archives are separated into named company workspaces; switching companies must never mix messages, matching results, or imported source metadata.
- Company data and user authorization must persist across devices through server-backed storage. Browser storage is only a local development fallback.
- The GitHub/Vercel profile is intentionally a browser-local preview: `npm run build:vercel` sets `VITE_N9_STORAGE_MODE=local` and publishes `dist/client`. It must not be described as shared, cross-device, or server-secured until a Vercel-compatible database and server authentication layer are added.
- Never commit real customer XML, Excel, PDF, exported evidence, credentials, tokens, or browser databases to GitHub. The Vercel browser-local profile must not upload SMS archives to GitHub or Vercel.
- The first administrator is `nasseh` with the requested numeric bootstrap password; additional users receive explicit company assignments.
- Preserve the existing Google Messages-inspired visual language while extending it with company and user-management surfaces.
- The pre-login experience is a polished bilingual Arabic/English landing and sign-in surface with its own light/dark presentation.
- Phone evidence supports three explicitly selectable visual systems: Google Android, Huawei EMUI, and Apple iPhone.
- Search inside an open conversation accepts arbitrary message text, sender/contact names, and numbers without changing the global archive search, matching state, or XML data.
- Large archives must remain responsive without hiding data: the phone renders message batches of 160 with explicit older/newer controls, conversation lists render in batches of 200, match groups in batches of 40, and candidates in batches of 80. Search and matching still operate over the complete archive; never replace batching with a hard result cutoff.
- The Apple iPhone preview follows recognizable iMessage anatomy with a realistic device frame, status bar, conversation header, message bubbles, search surface, composer, and light/dark treatment.
- For the Apple iPhone conversation view, use the user-supplied iMessage screenshot as the visual source of truth: mirrored Arabic status bar, large centered contact avatar/name pill, left-aligned incoming gray bubbles with tails, blue auto-detected links/numbers, and timestamp separators between message groups.
- The phone status-bar clock can use the original SMS time, the live current time, or a user-entered time; this is a display preference and must not mutate XML timestamps.
- Evidence status rows show the Arabic status label and its timestamp only; raw XML field names such as `date` and `date_sent` remain internal and never appear in the phone preview or exported evidence image.
- The sender aliases `AMANA 940`, `EJADH`, and the old Jeddah municipality contact label render as the corrected sender identity `EJADA`.
- The message composer creates incoming or outgoing messages inside the active company archive, targets an existing or newly named conversation, requires full send and receive/delivery timestamps, defaults the second timestamp to four minutes later, and persists through the same authorized workspace storage as imported XML.
