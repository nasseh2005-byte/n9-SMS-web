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

- `npm test`: passed, 32/32 tests.
- `npm run build:vercel`: passed.
- Final source diff has no whitespace errors.

## Follow-up Polish

- [P3] Samsung and Huawei use different proprietary system fonts and navigation glyphs; N9 intentionally keeps its bundled Arabic font and common MDI navigation set for stable cross-browser export.
- [P3] The supplied Android reference is English/LTR while N9 is Arabic/RTL, so header and label alignment are mirrored rather than copied literally.

final result: passed
