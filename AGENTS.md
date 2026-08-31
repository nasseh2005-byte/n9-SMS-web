# Prototype Instructions

Read `N9-SMS-WEB-HANDOFF.md` completely before substantial feature, data-model, storage, authentication, or deployment work. Keep it updated when a durable feature or architectural decision changes.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable product decisions

- SMS archives are separated into named company workspaces; switching companies must never mix messages, matching results, or imported source metadata.
- Company data and user authorization must persist across devices through server-backed storage. Browser storage is only a local development fallback.
- The GitHub/Vercel profile is server-backed: `npm run build:vercel` sets `VITE_N9_STORAGE_MODE=vercel`; Vercel Functions store users, sessions, companies, and memberships in Neon Postgres, while private Vercel Blob stores one JSON SMS archive per company. Keep the `/api` rewrite before the SPA fallback.
- Large Vercel archives upload and download directly between the authorized browser and private Blob through short-lived, operation-scoped signed URLs. The API must validate the completed object and use `archive_version` optimistic locking before replacing the current archive.
- Never commit real customer XML, Excel, PDF, exported evidence, credentials, tokens, browser databases, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, or `BOOTSTRAP_ADMIN_PASSWORD` to GitHub. These values belong only in the Vercel project environment.
- The first administrator is `nasseh` with the requested numeric bootstrap password; additional users receive explicit company assignments.
- Preserve the existing Google Messages-inspired visual language while extending it with company and user-management surfaces.
- The pre-login experience is a polished bilingual Arabic/English landing and sign-in surface with its own light/dark presentation.
- Phone evidence supports three explicitly selectable visual systems: Google Android, Huawei EMUI, and Apple iPhone.
- Search inside an open conversation accepts arbitrary message text, sender/contact names, and numbers without changing the global archive search, matching state, or XML data.
- Large archives must remain responsive without hiding data: the phone renders message batches of 160 with explicit older/newer controls, conversation lists render in batches of 200, match groups in batches of 40, and candidates in batches of 80. Search and matching still operate over the complete archive; never replace batching with a hard result cutoff.
- The Apple iPhone preview follows recognizable iMessage anatomy with a realistic device frame, status bar, conversation header, message bubbles, search surface, composer, and light/dark treatment.
- For the Apple iPhone conversation view, use the user-supplied iMessage screenshot as the visual source of truth: mirrored Arabic status bar, large centered contact avatar/name pill, left-aligned incoming gray bubbles with tails, blue auto-detected links/numbers, and timestamp separators between message groups.
- The iPhone status bar and conversation header are protected safe areas: never duplicate a message body or link behind the Dynamic Island, avatar, or header controls. Message content begins below the header and links render only inside their message bubble.
- The Apple iPhone single-message evidence export is not a details screen. It must use the compact conversation crop from `1734198-1-3.pdf`: a thin top rule, sender, original SMS date, one native-style bubble, a lower-left back chevron, and an avatar only for numeric senders. Never add a title, status rows, type, priority, device chrome, N9 copy, or explanatory cards to the iPhone image/PDF export.
- The phone status-bar clock can use the original SMS time, the live current time, or a user-entered time; this is a display preference and must not mutate XML timestamps.
- Android and Huawei evidence screens use a proportioned status bar, camera cutout, signal/Wi-Fi/network/battery icons, and a structured message-details layout. Network and battery indicators are presentation only; the clock follows the selected clock mode.
- Evidence status rows show the Arabic status label and its timestamp only; raw XML field names such as `date` and `date_sent` remain internal and never appear in the phone preview or exported evidence image.
- Android and Huawei evidence details must follow the real phone-details hierarchy: a plain title, a large message preview, received/sent status rows, then type and priority. Do not add N9 provenance cards, SMS format badges, sender identity cards, explanatory copy, or other non-native chrome inside the exported phone screen.
- The sender aliases `AMANA 940`, `EJADH`, and the old Jeddah municipality contact label render as the corrected sender identity `EJADA`.
- The message composer is an administrator-only capability. Hide every composer entry point and dialog from ordinary users, guard the client handler, and reject server-side archive writes that add, edit, or remove `sourceKind: "manual"` messages for a non-admin. Admin-created messages remain readable, searchable, matchable, exportable, and preserved during an ordinary user's XML import.
- For administrators, the message composer creates incoming or outgoing messages inside the active company archive, targets an existing or newly named conversation, requires full send and receive/delivery timestamps, defaults the second timestamp to four minutes later, and persists through the same authorized workspace storage as imported XML.
- Manual evidence selection is the default and must never silently approve automatic recommendations. In manual mode, export stays disabled until the user approves a candidate or uses multi-selection; automatic recommendations are a separate explicit mode.
- Match candidates support independent multi-selection and select-all across the current candidate filter. With no explicit multi-selection, exports use the approved manual primary evidence or the explicit automatic recommendations for each matched identifier.
- Match-candidate filters include all, incoming, and outgoing messages. Filtering changes only the visible candidates and select-all scope; it must not discard matches or erase an already approved manual choice.
- The main application opens in the light theme by default, remembers later user theme changes, and uses Noto Sans Arabic with a clear hierarchy. Keep the match results as the dominant scrollable area instead of squeezing them under setup/status controls.
- Evidence filenames are derived from payment, license, violation, request, visit, reference, or other stable numbers in the SMS. A single selection downloads directly; multiple PNG or one-page PDF files are packaged in a ZIP without merging or changing message data.
