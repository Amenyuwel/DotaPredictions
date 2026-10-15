---
target: main tool page
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\Amenyuwel\\desktop\\Projects\\DotaPredictions\\client\\src\\App.tsx"
target_fingerprint: "sha256:35de1346409e3988a0a9a74f9eea1e925ef1410a944a807c7e5ed2c378cbb1c0"
target_path: "C:\\Users\\Amenyuwel\\desktop\\Projects\\DotaPredictions\\client\\src\\App.tsx"
timestamp: 2026-10-14T01-51-27Z
slug: client-src-app-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Mobile answer dialog hides run date |
| 2 | Match System / Real World | 2 | "at 90%", "unit", rung names unexplained |
| 3 | User Control and Freedom | 2 | Stage switch silently wipes inputs; builder Clear has no undo |
| 4 | Consistency and Standards | 2 | Interval beside score in lists, under it on cards; tie marking inconsistent; duo name order flips |
| 5 | Error Prevention | 3 | Strong legality rules; no warning for unmeetable trait conditions |
| 6 | Recognition Rather Than Recall | 2 | Built banner collapses to "5 of 5 placed" next to its ranking |
| 7 | Flexibility and Efficiency | 2 | ~25 taps per banner, no share/URL state |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; 70-word caveat under total; flat ranked list |
| 9 | Error Recovery | 2 | RunError shows python/npm commands to public users |
| 10 | Help and Documentation | 2 | FAQ lacks "what is this"; hidden in phone menu |
| Total | | 23/40 | Acceptable |

## Design Specificity
Mostly category-interchangeable shadcn form-and-results; only the emblem weave is authored. Ledger form absent (no ruled figures, #1 rank same weight as #8), banner never drawn as a banner, no player/team imagery, tactile press only on Button.
Detector: CLI 0 findings. URL/overlay: line-length on AwaitingInput (~91ch, App.tsx:537) and roster-total paragraph (~116ch, roster-answer.tsx:71-77, true positive); flat-type-hierarchy (h1 16px = dialog h2 16px, run-header.tsx:72); repeating-stripes-gradient = false positive (emblem weaves are product data). check:tone ok, oxlint clean.

## Priority Issues
- [P1] Cold open serves neither audience: defaults to 25-tap banner tab, empty answer column, no statement of purpose. Fix: orientation in answer column, roster as front door, real CTA in mobile bar. /impeccable onboard
- [P1] Banner-tab answer has no hierarchy and banner disappears: 8 equal rows at text-sm, interval beside score, banner shown as "5 of 5 placed". Fix: #1 hero row with Figure + interval beneath, ruled ledger rows, weave strip of placed emblems in the card. /impeccable layout, /impeccable typeset
- [P1] Building an emblem costs too much on phone: stat/quality/trait in one scroll, Save below fold, disabled locked-colour chip row. Fix: sticky footer, drop locked colour fieldset to header swatch, press state on Choice. /impeccable adapt, /impeccable distill
- [P2] Honesty edges: roster total has no interval or stated reason on screen; run date absent in mobile answer dialog; tie logic differs between ResultPanel and BannerResultPanel. /impeccable clarify, /impeccable harden
- [P2] Developer copy in RunError reaches public users (states.tsx:54-68). /impeccable harden

## Persona Red Flags
Casual phone-first from Reddit: lands on banner tab before owning a banner; muted 12px bar hint; FAQ in hamburger; Save below 6 traits; 70-word paragraph; silhouettes only.
Desk min-maxer: no side-by-side banner compare; no share state; inconsistent ties; picker shows no figures; stage switch wipes work.
Keyboard/SR: quality stamps look like buttons but inert; stacked modals; mobile dialog autofocus ring reads as selection.

## Minor Observations
Selected unit-picker text centred; "Each is 5 emblems" copy; hyphen instead of en dash in ranges; TI2026 badge looks interactive; guest Saved card takes full card; empty Mid/Support answer tabs unmarked; tier stamp looks like an icon button; label tracking drifts 0.1-0.14em.

## Questions
Why is the 25-tap path the front door? What if the banner were drawn as the in-game banner everywhere? Can the total's uncertainty be said in one glyph instead of a paragraph?
