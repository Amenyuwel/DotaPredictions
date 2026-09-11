---
name: frontend-standards
description: Standard engineering practices for building web frontends - semantic HTML, accessibility (WCAG 2.2 AA), responsive layout, CSS architecture, forms, UI states, and performance. Use this skill whenever building or reviewing any web page, landing page, component, HTML/CSS/JS file, React/Vue/Svelte UI, or artifact with a user interface, even if the user only asks for "a page" or "a quick UI". Pairs with aesthetic/design skills - those decide how it looks, this one makes sure it works for everyone on every device.
---

# Frontend Standards

This is the quality floor every interface must meet, regardless of visual style. A beautiful page that breaks on mobile, can't be used with a keyboard, or shifts around while loading is a broken page.

Apply silently while building. Don't lecture the user about these practices unless they ask - just ship work that meets them.

## 1. Semantic HTML first

Correct elements give you accessibility, SEO, and keyboard support for free.

- Use landmarks: `<header>`, `<nav>`, `<main>` (exactly one), `<footer>`, `<section>` with a heading, `<article>`, `<aside>`.
- Headings in order: one `<h1>`, then `<h2>`, `<h3>` without skipping levels. Choose heading level by structure, style it with CSS.
- `<button>` for actions, `<a href>` for navigation. Never a clickable `<div>`.
- Lists are `<ul>`/`<ol>`, tables are `<table>` with `<th scope>` - only for tabular data, never layout.
- `<html lang="…">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, and a meaningful `<title>` on every page.
- Elements that come in pairs need their parent: `<dt>`/`<dd>` only inside `<dl>`, `<li>` inside `<ul>`/`<ol>`, `<option>` inside `<select>`. Outside it they are styled divs with no meaning, and nothing warns you.
- Reach for ARIA only when no native element does the job. Wrong ARIA is worse than none.

## 2. Accessibility (target WCAG 2.2 AA)

- **Contrast**: 4.5:1 for body text, 3:1 for large text (≥24px, or ≥18.66px bold) and for UI component boundaries/icons.
- **Keyboard**: every interactive element reachable by Tab, operable by Enter/Space, in logical order. No keyboard traps. Modals trap focus while open and return it on close; Escape closes them.
- **Focus visible**: never `outline: none` without a replacement. Use `:focus-visible` with a clear, high-contrast ring.
- **Targets**: interactive elements at least 24×24px (aim 44×44 on touch).
- **Images**: meaningful `alt` text; `alt=""` for decorative images. Icon-only buttons get an `aria-label`.
- **Don't rely on color alone** for meaning (errors, status, links in body text).
- **Motion**: respect `prefers-reduced-motion`; no flashing more than 3 times per second. Reduce to a near-zero duration (`0.01ms`), not `none` - `animation: none` never fires `animationend`, and any library that waits on it to unmount a closing dialog leaves the box on screen with the page under it inert.
- Provide a "Skip to main content" link on pages with repeated navigation.
- Dynamic updates (toasts, form errors, loading results) announced via `aria-live` regions. Wrap the **smallest** element that changes: a live region around a whole results panel re-reads the entire panel on every keystroke that touches it. Give any named region an `aria-label` - "region" alone tells a screen-reader user nothing.
- Nested modals: the inner one traps focus and Escape closes it first, not the stack. Many libraries suppress the child's backdrop so the parent shows through - then nothing separates two same-width cards, so dim the parent yourself while a child is open.

Full checklist: `references/accessibility-checklist.md` - read when reviewing or auditing.

## 3. Responsive layout

- **Mobile-first**: base styles for small screens, `min-width` media queries to enhance.
- Test mentally at 320px, 375px, 768px, 1024px, 1440px. Nothing overflows horizontally at 320px.
- Use **Flexbox** for one-dimensional alignment, **Grid** for two-dimensional layout. Avoid floats and absolute positioning for layout.
- Prefer intrinsic sizing: `minmax()`, `auto-fit`, `clamp()`, `min()`, `max-width` - fewer breakpoints needed.
- Container queries (`@container`) for components that live in varying widths.
- Use `dvh`/`svh` instead of `100vh` for full-height mobile sections (address bar issue).
- Readable line length: roughly 45-80 characters (`max-width: 65ch` on text blocks).
- In a wrapping flex row, push a **group**, not one item: `margin-inline-start: auto` on a bare label leaves everything after it free to break off one at a time, and the last control lands alone on the next line under something it has nothing to do with. Wrap the trailing cluster in one element and put the auto margin on that - auto margins resolve per flex line, so the cluster stays aligned on whichever line it lands on.
- Zoom to 200% must not break layout or hide content.

## 4. CSS architecture

- **Design tokens as custom properties** on `:root`: colors, spacing scale, type scale, radii, shadows, durations. No raw hex values scattered through rules.
  ```css
  :root {
    --space-1: 0.25rem; --space-2: 0.5rem; --space-4: 1rem; --space-8: 2rem;
    --text-base: 1rem; --text-lg: clamp(1.125rem, 1rem + 0.5vw, 1.25rem);
    --radius-sm: 4px;
  }
  ```
- **Units**: `rem` for font sizes and most spacing (respects user font settings); `px` for borders and hairlines; `%`/`fr`/viewport units for layout.
- **Low specificity**: single class selectors. Avoid IDs for styling, deep nesting (>3 levels), and `!important` (except utility overrides). Consider `:where()` to keep base styles overridable, and `@layer` to order resets, base, components, utilities.
- Use a light modern reset (`box-sizing: border-box`, `margin: 0`, `img { max-width: 100%; display: block; }`).
- Logical properties (`margin-inline`, `padding-block`) when internationalization or RTL may matter.
- Consistent naming convention (BEM, utility-first, or CSS Modules) - pick one per project and stick with it.
- Dark mode via `prefers-color-scheme` swapping token values, not duplicating rules.
- **Theme is three states, not two**: light, dark, and *follow the system*. A toggle can only express the palette currently painted, so a reader who chose light at noon has no way back to following the OS at midnight except clearing site data. Store the three-way choice; resolve it to a palette at render.
- Set `color-scheme` (and `<meta name="color-scheme">`) alongside the class, or the browser keeps painting scrollbars, form controls, the caret and the over-scroll canvas in the other theme.
- Apply the stored theme from a **blocking inline script in `<head>`**, before the stylesheet paints. Any module-based approach runs after first paint, so a dark reader gets a white frame. That script is the one place duplicating the theme logic is correct - comment it at both ends.
- Scrims and overlays are not one value across themes. On a light page a faint dark scrim pushes content back; on a dark page the dialog's surface is *lighter* than the page behind it, so the same value leaves the two reading as one surface.

## 5. Uniformity - the user should never have to point at a size

Inconsistent spacing is not a cosmetic bug, it is a bug you make the reader find
for you. Assume nobody will ever report it and design so it cannot happen.

**Every size comes from the scale.** No arbitrary one-offs (`text-[0.7rem]`,
`p-[13px]`, `h-[42px]`). If a value is genuinely needed twice, it is a missing
token - add it to the theme and name it. The same magic number written in three
components is three things that drift the moment one is edited.

**Peers are one size, decided by the group, not by their content.** Options in a
picker, cards in a row, buttons in a bar: set the height, padding and gap once on
the container or a shared component, never per child. If one item is taller than
its neighbours, the layout is reporting a bug in your CSS, not a fact about the
data.

**Content must not resize its own box.** The failure is always the same shape: an
item picks up a badge, a second line, a longer label, or a conditional note - and
its row grows while the others stay short.

```css
/* An option with a subtitle must not make its row taller than the rest. */
.options { display: grid; grid-template-columns: repeat(2, 1fr); grid-auto-rows: 1fr; }
```
Tailwind: `grid auto-rows-fr`. For flex rows, `items-stretch` plus one height on
the shared child. Reserve space for anything conditional (`min-h`, an empty
placeholder) rather than letting it appear and push.

**One rhythm per group.** Pick the gap once at the container with `gap`, not with
per-child margins. Mixed `mt-*` on children is how a list ends up with four
different spacings nobody chose.

**Stateful variants keep the same box.** Selected, disabled, hovered, loading and
error states change colour, weight or border - never padding, font size or height.
A border that appears on selection must be there all along, transparent.

**Colour variants are one recipe at different hues.** A set like red / blue /
green is the same control three times, so write it once and let only the hue
change. Three hand-written blocks drift the moment one is edited, and named
ramps make it worse - Tailwind's `red-200`, `blue-200` and `emerald-200` sit at
different lightness and chroma, so "the same shade" is not the same weight.

Define them in a perceptual space (`oklch`) with lightness and chroma **shared**
and hue as the only variable:

```css
[data-tone]        { --tone-ink: oklch(0.48 0.10 var(--tone-hue)); }
[data-tone="red"]  { --tone-hue: 25; }
[data-tone="blue"] { --tone-hue: 260; }
```

One trap makes equal numbers render unequal: **sRGB is far narrower in green
than in red or blue**, so a chroma every hue cannot reach is honoured for some
and clipped for the rest. At L=0.62, red reaches C≈0.25 and green stops at
≈0.14. Pick the tightest hue's limit, not the roomiest. Check it rather than
eyeballing it - clipping is invisible in the stylesheet, and each variant still
has to pass contrast on its own.

Check it by asking what breaks the alignment, not by looking at the happy path:
double one label's length, empty another, give one item the optional badge and
the rest none. If the grid still lines up, it is right.

## 6. Density - say it once, in the place it is actionable

A page can pass every rule above and still be unusable because there is too much
on it. Crowding is not a styling problem, it is a placement problem: the same
fact written in several places at once, or written where the reader cannot act
on it.

**One fact, one place.** If a label appears twice on a screen - a badge naming
the current stage beside a control that also names it - a reader treats them as
two facts and compares them. Delete the one that cannot change; keep the one
that is also the control.

**A note repeated per instance belongs to the container.** Mount three pickers
and a caveat rendered inside each one is on screen three times with one word
different. Either lift it to the group, or push it into the thing it is about -
a note about which items a list omits belongs in that list's dialog, next to the
list, not under the closed trigger.

**N peers get one empty state, not N.** Before anything is chosen, three slots
have nothing to say that distinguishes them, and three identical dashed boxes
are the whole viewport. Show one sentence for the group until there is something
specific to say, then switch to per-item.

**Explanation goes where the action is.** Rules about what may be entered belong
in the editor, not beside the summary. The summary keeps only what is still in
flux - a count, a shortfall - because that is what the reader is checking
without opening anything.

**Progressive disclosure is for settled inputs, not for warnings.** An input
that stops changing once entered (a list of items already chosen) folds into a
dialog. Anything qualifying a number - a caveat, a tie, a missing measurement -
travels with that number and never folds away. "Less text" is never a reason to
hide a limit of the answer.

**Placeholder boxes are sized by how many are on screen.** One standing alone is
the column and can take the room; three stacked are a frame drawn three times
around one short line. Give the component the two sizes and pick by count, so
the set stays one size decided by the group (§5).

## 7. Typography

- Base body size ≥16px for prose; line-height ~1.5 for body, ~1.1-1.25 for headings. A data-dense tool (tables of figures, dashboards) may set a 14px base, but nothing that is read as a sentence goes below it, and every step down from there is a named token, never an inline one-off.
- Fluid headings with `clamp()`.
- Web fonts: limit families and weights, `font-display: swap`, preload the critical one, provide a fallback stack with similar metrics.

## 8. Images and media

- Always set `width` and `height` attributes (or `aspect-ratio`) to prevent layout shift.
- Modern formats (AVIF/WebP) with fallback via `<picture>`; responsive `srcset` + `sizes`.
- `loading="lazy"` and `decoding="async"` for below-the-fold images. **Never** lazy-load the LCP/hero image - give it `fetchpriority="high"`.
- SVG for icons and logos; inline or sprite for icons that need `currentColor`.
- Video: `muted` + `playsinline` for autoplay, captions for speech, poster image.

## 9. Forms

- Every input has a visible `<label for>`. Placeholder is not a label.
- Correct `type` (`email`, `tel`, `url`, `number`) and `autocomplete` values - mobile keyboards and autofill depend on them.
- `inputmode` for numeric fields that aren't really numbers (PINs, card numbers).
- Validate on blur/submit, not every keystroke. Show errors next to the field, in text, linked with `aria-describedby`; set `aria-invalid="true"`.
- Error messages say what's wrong and how to fix it: "Enter a date after today", not "Invalid input".
- Disable the submit button only while submitting (and show progress), not as a validation mechanism.
- Group related controls with `<fieldset>` + `<legend>` (radio groups especially).

## 10. UI states

Every data-driven view needs all of these designed, not just the happy path:

- **Loading** - skeleton or spinner; reserve space to avoid layout shift.
- **Empty** - explain why it's empty and give the next action.
- **Error** - what happened, how to recover, retry option.
- **Partial / long content** - long names, many items, missing images, 0 and 1 items.
- **Interactive states** - hover, focus-visible, active, disabled, selected, for every control.

## 11. Performance (Core Web Vitals)

Targets: **LCP < 2.5s**, **INP < 200ms**, **CLS < 0.1**.

- Ship less JavaScript. Use native HTML/CSS features (`<details>`, `<dialog>`, CSS `:has()`, scroll-snap) before JS libraries.
- `defer` or `type="module"` on scripts; nothing render-blocking except critical CSS.
- Avoid layout shift: reserve space for images, ads, embeds, and late-loading fonts.
- Keep main-thread tasks short; debounce input handlers; animate only `transform` and `opacity`.
- Lazy-load below-the-fold components and heavy third-party embeds.
- Preconnect to critical third-party origins.

## 12. JavaScript behavior

- **Progressive enhancement**: core content and links work before JS loads where feasible.
- Use event delegation for lists; clean up listeners, timers, and observers.
- Use `IntersectionObserver` instead of scroll listeners for reveal/lazy behavior.
- Never trust the client for validation or security - server validates too.
- Secrets never go in frontend code.

## 13. Meta and SEO basics (for public pages)

- Unique `<title>` (≤60 chars) and `<meta name="description">` (~150 chars).
- Open Graph tags (`og:title`, `og:description`, `og:image`) for link previews.
- Favicon, canonical URL, and descriptive link text ("Read the pricing guide", not "Click here").

## Before delivering

- [ ] Semantic landmarks, one `<h1>`, ordered headings
- [ ] Keyboard-only walkthrough works; focus always visible
- [ ] Contrast passes AA; color isn't the only signal
- [ ] No horizontal scroll at 320px; works at 200% zoom
- [ ] Images have dimensions and alt text; hero not lazy-loaded
- [ ] Forms have labels, correct types, autocomplete, clear errors
- [ ] Loading, empty, and error states exist
- [ ] `prefers-reduced-motion` respected
- [ ] No console errors; no unused libraries
- [ ] Tokens used instead of scattered raw values; no arbitrary one-off sizes
- [ ] Peer elements share one height, padding and gap - checked with the longest
      label, an empty one, and one item carrying an optional badge or subtitle
- [ ] Selected/disabled/loading states change colour, not size
- [ ] Colour variants share lightness and chroma, vary only hue, and no hue
      is clipped out of gamut; each still passes contrast
- [ ] No fact stated twice on one screen; per-instance notes lifted to the group
      or moved into the thing they describe
- [ ] N empty peers show one empty state, not N
- [ ] Live regions wrap only what changes; named regions have a label
- [ ] Theme offers light / dark / system, applied before first paint, with
      `color-scheme` set
- [ ] Reduced motion shortens durations rather than removing animations

If the environment allows screenshots or a headless browser, render at mobile and desktop widths and check before delivering.
