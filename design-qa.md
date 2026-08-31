# N9 SMS Design QA — Android/Huawei Message Details

## Comparison Target

- Source visual truth: `C:\Users\win\AppData\Local\Temp\WhatsApp Image 2026-08-31 at 1.05.46 PM.jpeg` (Samsung/Android message details).
- Secondary source: `C:\Users\win\AppData\Local\Temp\WhatsApp Image 2026-08-31 at 1.05.46 PM (1).jpeg` (short-message state).
- User-reported implementation before the change: `C:\Users\win\AppData\Local\Temp\codex-clipboard-1253a761-c5cb-41a2-ada2-6369babdeb54.png`.
- Final Android implementation capture: `C:\Users\win\Downloads\1523486575-1591714 (3).png`.
- Huawei implementation capture: `C:\Users\win\Downloads\1523486575-1591714 (2).png`.
- Final normalized side-by-side comparison: `G:\ملفاتي\+N9 SMS\N9-SMS-Web\design-qa-comparison-final.png`.
- State: Arabic EJADA SMS, details view, original SMS clock, dark phone theme. Android and Huawei were each exported through the real PNG flow.

## Viewport And Normalization

- Source image: 720 × 1560 px, equivalent to a 360 × 780 logical mobile surface at 2× density.
- Implementation exports: 786 × 1704 px, generated from the fixed 393 × 852 CSS capture at 2× density.
- Both images share the same 0.4615 aspect ratio and were displayed side by side at the same 200 × 433 normalized size for comparison.
- The source uses English/LTR labels; the implementation intentionally mirrors the same hierarchy for Arabic/RTL.

## Comparison History

### Pass 1

- [P1] The old implementation inserted an SMS format badge and a sender identity header that do not exist in the reference details screen.
- [P1] A branded provenance/N9 card appeared at the bottom of the phone capture, making the screen look like a generated report rather than a phone details screen.
- [P2] Type and sender were placed in two boxed columns; the reference uses simple stacked Type and Priority text.
- [P2] Status rows used decorative check icons and blue headings instead of the source's quiet, plain status card.
- Fixes: removed the identity row, SMS badge, source card, N9 copy, status markers for Android/Huawei, and boxed metadata. Added a centered message bubble, received/sent rows, and plain type/priority values.

### Pass 2

- [P2] The initial rebuilt dark surface was cooler and darker than the warm Samsung reference.
- Fixes: aligned Android details surfaces to `#1f1e23`, retained the near-black message/status cards, and changed the incoming second status label from «أرسلها المرسل» to the direct «تم الإرسال».
- Post-fix evidence: the normalized final comparison shows the same five-region hierarchy—status/header, message well, status block, type, and priority—with no extra product explanation inside the phone.
- No actionable P0, P1, or P2 difference remains. RTL mirroring, Arabic copy, exact XML-derived dates, and different message length are intentional data/localization differences.

## Required Fidelity Surfaces

- Fonts and typography: Noto Sans Arabic provides a clean system-like Arabic hierarchy; title, section labels, values, dates, and message body retain distinct weights without tiny explanatory copy.
- Spacing and layout rhythm: the message well occupies the dominant upper region, status rows are grouped directly below it, and type/priority remain unboxed with native-like vertical spacing.
- Colors and visual tokens: Android dark uses the Samsung-like warm charcoal base with near-black cards and a neutral gray bubble; the light theme uses restrained neutral surfaces. Huawei uses the same practical hierarchy with EMUI-specific radii and surface colors.
- Image and icon fidelity: no image asset is needed in the reference screen. Existing MDI status/navigation icons are retained; the non-native badge and database icon were removed from the capture.
- Copy and content: only phone-relevant content remains—«التفاصيل»، الرسالة، «الحالة»، «تم الاستلام»، «تم الإرسال»، «النوع»، «رسالة نصية»، «الأولوية»، و«عادية».

## Functional Verification

- Android dark PNG export completed and produced a readable 786 × 1704 image.
- Android light PNG export completed with the same hierarchy.
- Huawei dark PNG export completed with no reappearance of SMS/provenance cards.
- Original message content and XML-derived timestamps were not changed; only presentation labels and layout changed.
- The complete message, both status rows, type, priority, and navigation bar fit inside the 393 × 852 export without clipping.
- Local browser console: no visual-flow error was observed during theme switching, device switching, and three PNG exports.

## Build Verification

- `npm test`: passed, 37/37 tests.
- `npm run build:vercel`: passed.
- Final source diff has no whitespace errors.

## Follow-up Polish

- [P3] Samsung and Huawei use different proprietary system fonts and navigation glyphs; N9 intentionally keeps its bundled Arabic font and common MDI navigation set for stable cross-browser export.
- [P3] The supplied Android reference is English/LTR while N9 is Arabic/RTL, so header and label alignment are mirrored rather than copied literally.

final result: passed

---

# N9 SMS Design QA — iPhone Single-Message Evidence

## Comparison Target

- Source visual truth: `C:\Users\win\Downloads\1734198-1-3.pdf`.
- Rendered source pages: `tmp/pdfs/iphone-reference/page-1.png`, `page-2.png`, and `page-3.png` at 144 DPI.
- Initial corrected export: `C:\Users\win\Downloads\1523486575-1591714 (6).png`.
- Long-message fit export: `C:\Users\win\Downloads\1523486575-241400071101 (2).png`.
- Final in-app verification capture: `tmp/product-design/iphone-preview-final.png`.
- Same-size comparison input: `tmp/product-design/iphone-reference-vs-final.png` (reference on the left, implementation on the right).
- State: Arabic incoming EJADA SMS, original XML date, Apple iPhone selected, dark and light themes checked.

## Source Anatomy

- The reference is a compact horizontal conversation crop, not an iOS details page.
- Its visible structure is limited to a thin top rule, sender at the upper left, date at the upper right, one gray incoming iMessage-style bubble, a back chevron aligned with the lower edge of the bubble, and an avatar only for a numeric sender.
- No device frame, status bar, Dynamic Island, title, status rows, type, priority, provenance, or N9 explanation appears in the evidence crop.

## Comparison History

### Pass 1

- [P1] The old iPhone evidence reused the Android/Huawei details screen and displayed «التفاصيل»، received/sent rows, type, priority, and device chrome.
- Fix: introduced `IphoneEvidencePhone` and routed Apple iPhone evidence to a dedicated conversation-crop component.
- [P2] Long identifiers could break across lines, and the light theme inherited white number styling.
- Fix: long numeric tokens are isolated and kept on one line; the light incoming bubble renders them in the same dark ink as the body.

### Pass 2

- [P2] A long real SMS initially clipped at the lower edge.
- Fix: added message-length classes and capture-specific typography so the complete SMS fits within the fixed export surface.
- [P2] LTR URLs could reorder inside Arabic text, and the footer arrow sat at the bottom of the canvas instead of the lower edge of the bubble.
- Fix: URL tokens use isolated LTR flow; the message and footer now share the same grid row so the arrow follows the bubble height, matching the reference behavior.

## Fidelity And Functional Verification

- Capture CSS size is `562.5×441.75px`; `pixelRatio: 2` produces approximately `1125×884px`, matching the rendered reference density and aspect ratio.
- Sender aliases still normalize to the user-confirmed `EJADA`, despite the older `EJADH` text visible in the reference PDF.
- The displayed date comes from `message.date` through a dedicated Arabic-digit Gregorian formatter; no XML timestamp is changed.
- Dark and light previews both preserve the compact anatomy, readable number contrast, bubble tail, and arrow alignment.
- The real image-export path completed successfully in the browser and reported a high-resolution evidence export; no browser console error was recorded.
- Android and Huawei remain on their separate native details-screen path and were not visually changed by the iPhone branch.
- No actionable P0, P1, or P2 difference remains. Message wording, current dataset date, and the corrected sender spelling are intentional data differences.

final result: passed
