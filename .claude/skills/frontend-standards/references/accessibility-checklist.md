# Accessibility Audit Checklist (WCAG 2.2 AA)

Use when reviewing or auditing an interface. Report failures with element, criterion, and fix.

## Structure
- [ ] `<html lang>` set correctly
- [ ] Unique, descriptive `<title>`
- [ ] Landmarks present: `header`, `nav`, `main` (one), `footer`
- [ ] One `<h1>`; heading levels not skipped
- [ ] Lists and tables use proper markup; data tables have `<th scope>` and a `<caption>` where helpful
- [ ] Reading order in DOM matches visual order (watch CSS `order`, grid placement, absolute positioning)

## Keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11)
- [ ] All functionality operable by keyboard alone
- [ ] Tab order is logical; no positive `tabindex`
- [ ] No keyboard traps
- [ ] Focus indicator always visible and high-contrast
- [ ] Focused element never fully hidden behind sticky headers/footers or overlays
- [ ] Skip link to main content on pages with repeated navigation
- [ ] Custom widgets follow ARIA Authoring Practices keyboard patterns (arrow keys in tabs, menus, listboxes)

## Dialogs and overlays
- [ ] Use `<dialog>` with `showModal()` or equivalent `role="dialog"` + `aria-modal="true"` + label
- [ ] Focus moves into dialog on open, is trapped, returns to trigger on close
- [ ] Escape closes it
- [ ] Background content inert while modal is open

## Visual (1.4.x)
- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for large text)
- [ ] UI component and graphical object contrast ≥ 3:1
- [ ] Color not the only means of conveying information
- [ ] Content reflows at 320px CSS width without horizontal scroll (except data tables, maps)
- [ ] Text resizes to 200% without loss of content
- [ ] Text spacing overrides (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em) don't break layout
- [ ] Content shown on hover/focus is dismissible, hoverable, and persistent

## Pointer and touch (2.5.x)
- [ ] Targets ≥ 24×24 CSS px, or adequately spaced
- [ ] Dragging actions have a single-pointer alternative
- [ ] Actions fire on pointer up, not down (can be cancelled)
- [ ] Visible label text is included in the accessible name

## Images and media (1.1.1, 1.2.x)
- [ ] Informative images have meaningful alt; decorative have `alt=""`
- [ ] Complex images (charts) have a text alternative or data table
- [ ] Icon-only buttons/links have accessible names
- [ ] Video has captions; audio-only has transcript
- [ ] No autoplaying audio longer than 3 seconds without controls

## Forms (1.3.1, 3.3.x, 4.1.2)
- [ ] Every control has a programmatic label
- [ ] Required fields indicated in text, not only by color or asterisk without explanation
- [ ] Errors identified in text, associated to the field, and announced
- [ ] Suggestions for fixing errors provided
- [ ] `autocomplete` attributes on personal-data fields
- [ ] Don't ask users to re-enter info already provided in the same flow
- [ ] Authentication doesn't require a cognitive test (allow paste in password fields; support password managers)

## Motion and timing (2.2.x, 2.3.x)
- [ ] `prefers-reduced-motion` honored
- [ ] Nothing flashes more than 3 times per second
- [ ] Auto-moving content (carousels, tickers) can be paused
- [ ] Time limits can be extended or turned off

## Dynamic content
- [ ] Status messages (saved, results count, errors) use `aria-live` / `role="status"` / `role="alert"`
- [ ] Route changes in SPAs move focus or announce the new page
- [ ] Loading states announced for long operations

## Quick tools
- Browser DevTools accessibility tree and contrast checker
- axe DevTools or Lighthouse accessibility audit (catches ~30-40% of issues; manual checks still required)
- Keyboard-only walkthrough and a screen reader pass (VoiceOver, NVDA) for key flows
