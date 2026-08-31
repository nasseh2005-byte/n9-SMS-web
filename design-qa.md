# N9 SMS Design QA — iPhone iMessage Conversation

## Comparison Target

- Source visual truth: `C:\Users\nasse\AppData\Local\Temp\codex-clipboard-6dd16c1a-c085-43f8-93f6-d808968e5534.png`.
- Stable source copy: `G:\My Drive\+N9 SMS\N9-SMS-Web\qa-iphone-imessage-source.png`.
- Final implementation capture: `G:\My Drive\+N9 SMS\N9-SMS-Web\qa-iphone-imessage-implementation-pass2.png`.
- Full normalized comparison: `G:\My Drive\+N9 SMS\N9-SMS-Web\qa-iphone-imessage-comparison-pass2.png`.
- Focused header comparison: `G:\My Drive\+N9 SMS\N9-SMS-Web\qa-iphone-imessage-header-comparison-pass2.png`.
- Dark-mode verification: `G:\My Drive\+N9 SMS\N9-SMS-Web\qa-iphone-imessage-dark.png`.
- State: Arabic `EJADA` conversation, Apple iPhone visual system, light theme, conversation view, search closed.

## Viewport And Normalization

- Browser viewport: local desktop prototype at `http://127.0.0.1:5173/`, deviceScaleFactor 1.
- Captured iPhone surface: approximately 347 x 518 CSS px.
- Source image: 1024 x 1536 px.
- The source and implementation were each resized to the same 347 x 518 comparison region and placed side by side.
- A separate top-region comparison was required because the mirrored status bar, count capsule, avatar, name pill, and translucent header are the highest-fidelity surfaces and are less legible in the full comparison.

## Source-Of-Truth Anatomy

- Mirrored Arabic status bar: clock on the right; battery percentage, 5G, and signal on the left; Dynamic Island centered.
- Translucent conversation header with a large centered blue contact avatar and white contact-name pill.
- White back/count pill on the right with an inner black count capsule and chevron.
- Incoming messages aligned left in light-gray bubbles with bottom-left tails.
- Arabic copy in black with iOS-blue underlined URLs and long numeric identifiers.
- Centered gray timestamp separators between message groups.

## Comparison History

### Pass 1

- [P2] Status clock and indicators were smaller than the reference.
- [P2] Back/count control lacked the prominent white pill and black inner counter.
- [P2] Contact-name pill was undersized and the light header divider was too visible.
- [P2] Message text and auto-detected links lacked the source's scale and iOS-blue emphasis.
- [P2] Bubble tails were too subtle.
- Fixes: enlarged the status metrics and name pill, rebuilt the count control, removed the light divider, adjusted bubble width/type rhythm, changed iPhone link color to `#007aff`, and strengthened bubble tails.

### Pass 2

- Full view and focused header were compared in the same visual inputs at equal dimensions.
- No actionable P0, P1, or P2 fidelity issue remains.
- [P3] The source screenshot is cropped before the composer while the implementation retains a real iMessage-style composer and device frame. Both are durable prototype-owned surfaces.
- [P3] Message copy, message count, and clock differ because the implementation renders the active archive rather than hard-coded screenshot content.
- The search button remains intentionally visible because searching by text, sender name, or number inside the conversation is a durable product requirement.

## Functional Verification

- In-thread text search for `عزيزي` returned 3 of 4 messages without an empty state.
- In-thread sender-name search for `EJADA` returned all 4 messages, confirming the query covers message body, address, and contact name.
- Search was closed after the check and does not mutate archive data, selection, or XML timestamps.
- The phone remained horizontally contained; the measured two-pixel scroll-width delta is the intentional device-frame border, not content overflow.
- Dark mode rendered with the same iMessage anatomy, readable incoming bubbles, blue links, and visible composer controls.
- Sender normalization remains `EJADA`; the historical aliases are not shown in the preview.
- Final build and automated test results are recorded below after execution.

## Required Fidelity Surfaces

- Typography and links: Arabic body copy remains readable, URLs and long numeric identifiers are auto-detected and styled as iOS links, and wrapping stays within the bubble.
- Layout and spacing: status bar, header backdrop, avatar, name pill, back counter, separators, bubbles, and composer retain the reference hierarchy.
- Colors: light mode uses white, iOS gray, black, and `#007aff`; dark mode uses near-black surfaces and readable iOS gray bubbles.
- Icons: Material Design Icons are used consistently; no custom SVG or hand-drawn CSS icon asset was introduced.
- States and interactions: conversation search, empty state, theme toggle, message selection, and the existing Android/Huawei systems remain available.
- Accessibility: controls keep Arabic accessible names, the search field receives focus when opened, and content remains usable in the phone viewport.

## Build Verification

- `npm test`: passed, 27/27 tests.
- `npm run build`: passed; emitted `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- `npm run test:sites`: passed, 5/5 tests.

final result: passed
