# N9 SMS — Data Reliability Report

## Final status

- Automated tests: 37/37 passed.
- Sites and Vercel production builds: passed.
- Browser console after a fresh reload and matching flow: 0 errors.
- Desktop and 390 px mobile checks: no horizontal overflow.

## Excel / CSV ingestion gates

- Arabic-Indic and Persian digits are normalized to ASCII identifiers.
- Scientific notation such as `1.523486575E+9` is expanded without using floating-point rounding.
- Leading zeros are retained when the workbook stores a text value or an Excel identifier format.
- Repeated identifiers are deduplicated and reported.
- Dates and fractional amounts are excluded from identifier extraction.
- When recognized headers exist, only columns named like number, reference, request, license, violation, payment, ID, match, or code are scanned.
- A headerless single-column file is accepted.
- A headerless multi-column file is rejected with a corrective message instead of silently mixing amounts and identifiers.
- Numeric cells at or above 16 digits are rejected because Excel may already have changed their precision; the UI instructs the user to store them as text.
- Files above 80 MB and lists above 10,000 unique identifiers are rejected with a controlled message to protect browser stability.
- CSV exports protect cells beginning with `=`, `+`, `-`, or `@` from spreadsheet formula injection.

## XML integrity audit

Source: `C:\Users\win\Downloads\هاجديه (1).xml`

- SMS records: 36,642.
- Invalid or missing primary `date`: 0.
- Missing/zero `date_sent`: 143.
- `date_sent` later than `date`: 576; both values remain unchanged and the UI labels the source order as unusual.
- Empty message bodies: 0.
- Empty sender addresses: 0.
- Duplicate groups by date, sender, and body: 0.
- Message types: 36,497 incoming and 145 outgoing.
- Real XML matches for `1523486575`: 7, all with raw sender `EJADH`; the product displays the user-confirmed identity `EJADA`.

## Timestamp rules

- Valid XML `date` and `date_sent` values are copied as numeric timestamps without mutation.
- Raw XML timestamp field names remain internal and are not printed in the phone evidence view or exported evidence image.
- Missing timestamps never become `Date.now()`.
- A deterministic 3–5 minute value is shown only when there is a valid anchor timestamp and the missing row is visibly labeled as estimated.
- If both timestamps are missing, the UI shows that the value is unavailable instead of fabricating a time.
- CSV export leaves missing timestamps blank and never emits an invalid ISO date.

## Matching checks

- Matching is exact for numeric identifiers, including identifiers surrounded by Arabic text, punctuation, spaces, or parentheses.
- Numeric substrings do not match a different longer identifier.
- Unmatched spreadsheet rows stay visible with a zero-candidate state and are never silently discarded.
- Every candidate message remains available; candidate groups are no longer truncated and can be searched or sorted by smart score, newest, or oldest.
- Candidates can be filtered to all, incoming, or outgoing messages. The filter changes only what is shown and what select-all includes; it does not remove the underlying matches or an approved manual selection.
- Synthetic performance check: 36,642 messages against 1,000 identifiers completed in 67 ms in the local Node runtime.

## Complete archive display and persistence

- Every message remains available in the selected thread; the phone renders explicit 160-message batches with older/newer controls instead of putting tens of thousands of bubbles in the DOM at once.
- Manually created messages are validated, assigned stable unique ids, and saved to the active company's archive with exact user-entered send and receive/delivery timestamps.
- The message composer is admin-only: ordinary users do not receive any composer navigation, header, empty-state, or dialog control. Client guards reject direct invocation, while local, Sites, and Vercel archive persistence rejects any non-admin addition, edit, or removal of `sourceKind: "manual"` messages. Existing admin-created messages remain intact during permitted XML imports.
- Date separators cover the complete conversation, and the header reports the real total message count.
- Global search keeps the complete result set and renders another 100 results on demand; no result is silently excluded.
- Imported XML archives are saved in browser IndexedDB during local development. On Vercel they are serialized once, uploaded directly to private Vercel Blob with a short-lived PUT URL, validated server-side, and restored through an authorized short-lived GET URL.
- The built-in ten-message dataset is visibly labeled as a sample so it cannot be mistaken for an incomplete imported archive.
- Browser verification covered full sample-thread rendering, date separators, candidate filtering, newest/oldest sorting, and a fresh console with 0 errors.
- The iPhone status bar and header no longer reuse message content as a backdrop, so message text and links cannot appear behind the Dynamic Island or contact controls.
- The iPhone single-message evidence path is intentionally separate from Android/Huawei details: it exports only sender, original XML date, one iMessage-style bubble, the back chevron, and an optional numeric-sender avatar on a 562.5×441.75 capture surface. Status/type/priority fields and device chrome are excluded.
- Large-archive verification produced 36,652 total messages after merging the 36,642-message XML with 10 local sample messages, then opened a 34,752-message conversation with only 160 message nodes rendered; repeated opening completed in about half a second and browser console errors remained at 0.

## Company workspaces and access control

- Every company has a separate workspace id, archive object, source filename, message count, and authorization membership.
- Importing another XML file into the same company merges new SMS records and removes exact duplicates; switching companies reloads only that company's archive.
- The Sites deployment uses D1 for users, sessions, company metadata, and memberships, plus a separate R2 object for each company's current SMS archive.
- The Vercel deployment uses Neon Postgres for the same shared account/workspace state and private Vercel Blob for each company's current archive. It never falls back silently to browser-local data when cloud configuration is missing.
- The initial administrator is `nasseh`; its requested numeric bootstrap PIN is processed with PBKDF2-SHA-256 and a unique random salt rather than stored as plain text.
- Authentication sessions use random opaque tokens whose hashes are stored server-side in D1 or Neon. Browser cookies are HttpOnly, Secure, SameSite=Strict, and expire after seven days.
- Five incorrect password attempts trigger a 15-minute lockout.
- Server endpoints repeat the company-membership authorization check and do not rely on hidden client controls.
- Administrators can create users, stop/reactivate accounts, assign any combination of company workspaces, and replace a user's numeric password.
- Local development alone uses isolated browser IndexedDB. Both hosted variants provide shared multi-device persistence: D1/R2 on Sites and Neon/private Blob on Vercel.
- Vercel archive saves use an optimistic `archive_version`; if another device changes the same company during an upload, completion is rejected with 409 instead of overwriting the newer archive.
- Vercel credentials and the numeric bootstrap password are server-only environment variables and are not bundled into client JavaScript.

## Welcome experience and phone presentation

- The signed-out page has complete Arabic and English copy, correct RTL/LTR direction, and a saved light/dark visual preference.
- Phone evidence offers three separate presentation systems: Google Android, Huawei EMUI, and Apple iPhone.
- Each phone system changes the device frame, status bar, conversation header, message bubbles, composer, navigation treatment, and light/dark behavior.
- The status-bar clock supports the original SMS time, a live clock refreshed every 30 seconds, or a user-selected time.
- Android and Huawei evidence previews now use a proportioned status bar, centered camera cutout, coherent device rim, and readable signal/Wi-Fi/network/battery grouping. Only the clock represents selected message/live/custom time; the other indicators are visual presentation.
- Phone style and clock preferences are saved per device without modifying any imported XML timestamp.
- Image and ZIP evidence exports receive the selected phone style and clock mode.
- Android and Huawei evidence content now mirrors a practical native details screen: message preview, received/sent status, text-message type, and normal priority. Non-native sender cards, SMS badges, provenance panels, and N9 copy are excluded from the phone capture.
- iPhone evidence preserves the exact XML message date, keeps long identifiers unbroken, isolates LTR URLs inside RTL Arabic text, scales long bodies to avoid clipping, and supports both light and dark captures without mutating source data.
- Browser measurement on a long real archive message confirmed the 393×852 export surface had `758px` client height and `758px` scroll height, so the complete evidence layout fit without hidden overflow.

## PDF and multi-selection export

- Candidate check controls support independent multi-selection and select-all over the current candidate search. Manual mode is the default and exports remain disabled until a human approves a candidate; automatic recommendations require an explicit mode switch.
- Duplicate candidate appearances are deduplicated by stable message id before export.
- Evidence filenames prefer the matched number plus labeled payment, license, violation, request, visit, reference, or transaction numbers from the SMS; duplicate names receive numeric suffixes.
- One selected SMS downloads as a direct PNG or one-page PDF. Multiple selections download as a ZIP containing separate, normally named PNG or PDF files.
- Browser verification used real local archive data: a direct PDF opened as one unencrypted page, Poppler rendered the phone evidence correctly, and a two-message ZIP contained two independently readable one-page PDFs.
- PDF generation and naming are covered by four automated tests, including rejection of visit dates as filenames; no external upload or PDF service is used.

## Match-panel usability verification

- The supplied 376×872 screen recording showed the result list compressed below two separate summary/selection cards.
- The summary and multi-select actions now share one compact card, the panel is wider, and export actions occupy one row.
- At the local 1280×720 browser state, the match panel measured 349 px wide and the candidate viewport measured 225 px high instead of collapsing to a narrow strip.
- At 390×845, the overlay measured 365 px wide, kept a 307 px candidate viewport, and produced zero horizontal overflow.
- The default state verified as `theme-light`, manual selection active, zero chosen candidates, and all export actions disabled. Approving one message enabled export; switching to automatic selected three recommendations; returning to manual cleared them.

## Known source limitation

Excel itself keeps only 15 significant digits in numeric cells. No importer can recover digits that Excel already replaced. N9 SMS detects risky 16+ digit numeric cells and stops the import; saving those identifiers as Text preserves them exactly.
