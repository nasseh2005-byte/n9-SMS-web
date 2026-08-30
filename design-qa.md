# N9 SMS Design QA — Evidence Selection Update

## Comparison Target

- Source visual truth: `C:\Users\win\Downloads\1591714.pdf`.
- Rendered source: `G:\ملفاتي\+N9 SMS\tmp\pdfs\reference-1.png`.
- Browser-rendered implementation: `C:\Users\win\.codex\local-prototypes\n9-sms-web\implementation-desktop-final-v2.png`.
- Same-state implementation capture: `C:\Users\win\.codex\local-prototypes\n9-sms-web\implementation-qa-full-v2.png`.
- Focused phone crop: `C:\Users\win\.codex\local-prototypes\n9-sms-web\implementation-phone-qa-v2.png`.
- Side-by-side comparison evidence: `C:\Users\win\.codex\local-prototypes\n9-sms-web\design-qa-comparison-v2.png`.
- State: dark Arabic SMS details view for the AMANA 940 message containing license number `1523486575`, violation details, payment number, link, and payment instructions.

## Viewport And Normalization

- Browser viewport: 1440 x 980 CSS px, deviceScaleFactor 1.
- Responsive browser check: 390 x 844 CSS px, deviceScaleFactor 1.
- Source PNG: 1190 x 1684 px; source phone-content crop: 778 x 1684 px.
- Implementation full screenshot: 1440 x 980 px; implementation phone-screen crop: 349 x 704 px.
- Normalization: source crop and implementation crop were both resized to 900 px high with preserved aspect ratio and placed together on one canvas. Resulting visible comparison widths were 416 px and 446 px.
- The focused phone comparison was necessary because typography, URL wrapping, timestamp provenance, and status-row spacing were not readable enough in the full desktop view.

## Findings

- No actionable P0, P1, or P2 findings remain.
- [P3] The implementation uses Noto Sans Arabic instead of the Android system Arabic typeface in the PDF. Its weight, wrapping, and hierarchy remain close and readable.
- [Historical note] A prior iteration showed raw XML field names as secondary labels. The current user-approved design hides `XML · date` and `XML · date_sent` while preserving their exact timestamp values internally.

## Required Fidelity Surfaces

- Fonts and typography: Noto Sans Arabic 400/500/600/700 is bundled locally. Title, section labels, body text, status rows, Latin fragments, and long URL wrapping were inspected in the combined image. No clipping or spill outside the message bubble remains.
- Spacing and layout rhythm: the status bar, details header, proof card, centered message bubble, state block, metadata, and Android navigation retain the source hierarchy. The desktop dashboard keeps matching, conversation browsing, and phone preview visually distinct.
- Colors and tokens: the default dark mode closely maps to the source's near-black phone surface, black proof card, charcoal message bubble, blue section labels, and light text. The light theme also passed contrast and overflow checks.
- Image quality and asset fidelity: the reference contains UI, not photographic assets. All icons use Material Design Icons; no custom SVG, CSS icon drawing, or placeholder imagery is used. Export remains a 2x PNG.
- Copy and content: the reference message is preserved, including the full URL and payment instructions. Search and match snippets are dynamic XML content. Exact XML dates are never rewritten; derived times are labeled as estimates.
- Icons: status, navigation, import, copy, theme, matching, export, and Android controls use one consistent icon family and align optically in dark and light modes.
- States and interactions: search-without-filtering, result selection, manual candidate choice, automatic recommendation reset, copy, dark/light theme toggle, conversation/detail switch, matching, responsive layouts, and empty/selected states were exercised.
- Accessibility: semantic controls and Arabic labels are present, focus rings remain visible, and mobile controls stay within the 390 px viewport. No horizontal overflow occurs at desktop or mobile widths.

## Comparison History

### Earlier baseline iteration

- Earlier P2 issues: the status-bar clock was fixed, received/sent rows reused one timestamp, long links could visually dominate the bubble, search replaced the conversation list, and bulk matching offered no per-number evidence choice.
- Fixes made: status-bar time now follows the selected message; `date` and `date_sent` are displayed directly from XML; a deterministic 3–5 minute value is added only when a timestamp is absent and is visibly labeled estimated; URL wrapping is constrained to the bubble; search results are additive; matching is grouped per number with manual or smart selection; exports use only final choices.
- Post-fix evidence: browser checks reported seven conversations still visible while four search results were shown; the long URL bounds remained inside the proof bubble; switching messages changed the status time from 3:10 PM to 2:56 PM; manual choice changed the preview and smart mode restored the highest-ranked candidate.

### Final visual pass

- Source and implementation were opened together in `design-qa-comparison-v2.png`.
- The message proof card, RTL hierarchy, link wrapping, status rows, dark surfaces, blue labels, and bottom navigation were visually compared at equal height.
- No P0/P1/P2 fix was required after this comparison.

## Functional Verification

- Search: `1523486575` returned four message results while all seven sample conversations remained present.
- Link containment: the rendered link bounding box stayed fully inside `.message-proof-bubble`.
- Copy: clipboard content contained the complete selected message and URL.
- Theme: both `theme-dark` and `theme-light` rendered without horizontal overflow.
- Time semantics: the selected message's status-bar time matched its XML-backed status row; changing the selected message changed the displayed time. Exact sample `date` and `date_sent` values showed a four-minute difference.
- Smart/manual matching: three requested numbers produced three selected evidence rows. A manual alternative changed the preview; returning to smart mode restored the top-ranked candidate.
- Spreadsheet parsing: an in-memory XLSX workbook containing `1591714`, `1523486575`, and `2000000` returned exactly those three numeric terms.
- Real XML inspection: the provided file contains 36,642 `<sms>` records with separate `date` and `date_sent` attributes where present. The application maps both directly without mutation.
- Responsive check: 390 x 844 rendered with no horizontal overflow and the phone frame stayed inside the viewport.
- Build: `npm run build` passed.
- Sites worker tests: 5/5 passed.
- Browser console: zero errors after a fresh final reload.

## Implementation Checklist

- [x] Preserve exact XML `date` and `date_sent` values.
- [x] Label derived 3–5 minute times as estimates.
- [x] Keep links inside the SMS bubble.
- [x] Make search additive and keep all conversations available.
- [x] Add message copy and dark/light theme controls.
- [x] Group multiple spreadsheet numbers with manual and smart evidence selection.
- [x] Export only the selected evidence rows to ZIP/CSV.
- [x] Verify desktop and mobile layouts, build, console, and packaging tests.

## Follow-up Polish

- Optional P3: virtualize very large candidate lists if one number matches thousands of messages.

final result: passed
