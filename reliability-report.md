# N9 SMS — Data Reliability Report

## Final status

- Automated tests: 19/19 passed.
- Production build: passed.
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
- Synthetic performance check: 36,642 messages against 1,000 identifiers completed in 67 ms in the local Node runtime.

## Complete archive display and persistence

- A conversation renders every message in the selected thread; the previous last-18-message cap was removed.
- Manually created messages are validated, assigned stable unique ids, and saved to the active company's archive with exact user-entered send and receive/delivery timestamps.
- Date separators cover the complete conversation, and the header reports the real total message count.
- Global search keeps the complete result set. It initially renders 100 results for responsiveness and provides explicit controls to load another 100 or show all results; no result is silently excluded.
- Imported XML archives are saved in browser IndexedDB and restored after a page reload, including the selected conversation and initial smart matches.
- The built-in ten-message dataset is visibly labeled as a sample so it cannot be mistaken for an incomplete imported archive.
- Browser verification covered full sample-thread rendering, date separators, candidate filtering, newest/oldest sorting, and a fresh console with 0 errors.

## Company workspaces and access control

- Every company has a separate workspace id, archive object, source filename, message count, and authorization membership.
- Importing another XML file into the same company merges new SMS records and removes exact duplicates; switching companies reloads only that company's archive.
- Hosted storage uses D1 for users, sessions, company metadata, and memberships, plus a separate R2 object for each company's current SMS archive.
- The initial administrator is `nasseh`; its requested numeric bootstrap PIN is processed with PBKDF2-SHA-256 and a unique random salt rather than stored as plain text.
- Authentication sessions use random opaque tokens whose hashes are stored server-side in D1. Browser cookies are HttpOnly, Secure, SameSite=Strict, and expire after seven days.
- Five incorrect password attempts trigger a 15-minute lockout.
- Server endpoints repeat the company-membership authorization check and do not rely on hidden client controls.
- Administrators can create users, stop/reactivate accounts, assign any combination of company workspaces, and replace a user's numeric password.
- Local development uses an isolated IndexedDB fallback so the preview remains usable; shared multi-device persistence is provided by the deployed D1/R2-backed version.

## Welcome experience and phone presentation

- The signed-out page has complete Arabic and English copy, correct RTL/LTR direction, and a saved light/dark visual preference.
- Phone evidence offers three separate presentation systems: Google Android, Huawei EMUI, and Apple iPhone.
- Each phone system changes the device frame, status bar, conversation header, message bubbles, composer, navigation treatment, and light/dark behavior.
- The status-bar clock supports the original SMS time, a live clock refreshed every 30 seconds, or a user-selected time.
- Phone style and clock preferences are saved per device without modifying any imported XML timestamp.
- Image and ZIP evidence exports receive the selected phone style and clock mode.

## Known source limitation

Excel itself keeps only 15 significant digits in numeric cells. No importer can recover digits that Excel already replaced. N9 SMS detects risky 16+ digit numeric cells and stops the import; saving those identifiers as Text preserves them exactly.
