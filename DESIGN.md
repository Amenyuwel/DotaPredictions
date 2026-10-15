---
name: DotaPredictions
description: TI fantasy banner and roster projections, with an interval on every number.
colors:
  page: "oklch(1 0 0)"
  ink: "oklch(0.145 0 0)"
  ink-strong: "oklch(0.205 0 0)"
  ink-muted: "oklch(0.556 0 0)"
  wash: "oklch(0.97 0 0)"
  hairline: "oklch(0.922 0 0)"
  focus: "oklch(0.708 0 0)"
  alarm: "oklch(0.577 0.245 27.325)"
  page-dark: "oklch(0.145 0 0)"
  card-dark: "oklch(0.205 0 0)"
  ink-dark: "oklch(0.985 0 0)"
  ink-muted-dark: "oklch(0.708 0 0)"
  answer-gold: "oklch(0.955 0.045 88)"
  answer-gold-ink: "oklch(0.24 0.04 70)"
  answer-gold-edge: "oklch(0.62 0.12 75)"
  answer-gold-dark: "oklch(0.29 0.05 75)"
  answer-gold-ink-dark: "oklch(0.97 0.025 90)"
  answer-gold-edge-dark: "oklch(0.8 0.13 85)"
  emblem-red-hue: "oklch(0.68 0.11 21)"
  emblem-blue-hue: "oklch(0.68 0.11 274)"
  emblem-green-hue: "oklch(0.68 0.11 145)"
typography:
  headline:
    fontFamily: "'Space Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  figure:
    fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "'tnum'"
  body:
    fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  caption:
    fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  label:
    fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-strong}"
    textColor: "{colors.page}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  card:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  choice:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    height: "44px"
    padding: "8px 12px"
  choice-selected:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  tabs:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
---

# Design System: DotaPredictions

## Overview

**Creative North Star: "The Compendium Ledger"**

A ledger is where a careful person writes down what they hold and what it is
worth. This tool is that ledger for the TI compendium: the reader brings the
emblems they rolled and the players they are weighing, and the page writes back
a figure with its margin of error beside it. The compendium's own world - its
banners, the three emblem weaves, the stage - supplies the identity. The ledger
supplies the discipline: neutral paper, exact figures, nothing printed that was
not measured.

The surface is deliberately quiet so that two things can be loud: the projected
figure, and the colour of an emblem. Everything else is greyscale shadcn chrome
on Inter. Controls are tactile in the game's sense - chips and cards that read
as items you pick up and place, with a clear press, a clear selected state and
the emblem's weave arriving when you touch it.

The system is a refinement of what ships, not a new world. Keep the neutral
shell, the two-family type pairing and the weave palette; improve hierarchy,
first-visit clarity and the physical feel of selection.

**Key Characteristics:**
- Neutral, zero-chroma paper and ink; colour is reserved for emblems and alarms.
- Figures first: large tabular numerals, interval directly under the figure.
- Emblem colour is a woven pattern measured off the client, never a flat fill.
- Tactile controls: a visible press, a visible selected state, weave on touch.
- Light and dark are equals; each palette is tuned for its own page.

## Colors

A greyscale ledger with three woven inks and one gold; any other colour on
screen means something is wrong.

### Primary
- **Ledger Ink** (`ink-strong`): primary buttons, the active selection, the
  heaviest type. In dark it inverts to near-white (`oklch(0.922 0 0)`).

### Neutral
- **Paper** (`page`): page and card background in light.
- **Body Ink** (`ink`): running text and figures.
- **Pencil** (`ink-muted`): captions, intervals, secondary labels, the run date.
- **Wash** (`wash`): the tab track, a selected choice, muted fills.
- **Hairline** (`hairline`): borders and input strokes; cards use a 10%
  foreground ring instead of a border.
- **Focus Grey** (`focus`): focus rings, at 50% opacity, 3px.
- **Night** (`page-dark`, `card-dark`, `ink-dark`, `ink-muted-dark`): the dark
  palette; cards sit one step above the page, borders are 10% white.

### Tertiary - the emblem weaves
- **Red** (hue 21, 12px checkerboard), **Blue** (hue 274, 11px vertical
  stripes), **Green** (hue 145, crossing 45-degree lattice). One recipe at three
  hues: lightness and chroma are shared, only hue and pattern differ. The full
  ramp (ground, pattern, selected pair, 24px sample, mark, ink, ink-on) lives on
  `[data-emblem]` in `client/src/index.css`.

### Secondary - compendium gold (the answer)
- **Compendium Gold** (`answer-gold*`): fill and ink of the cards that ARE the
  answer: the lead unit on the banner tab, the roster total on the roster tab.
  Never outlined; the edge token only tints dividers inside. Applied by
  `data-answer`, which re-points `--card`, `--foreground`, `--muted-foreground`,
  `--muted` and `--secondary` inside the card so its children follow without
  per-element classes. Measured: ink on fill above 13:1, secondary ink above
  6.3:1, edge above 3.3:1 against fill and page, in both themes. A 6% white
  top-edge gradient lifts the fill into a surface; it only lightens, so the
  measured pairs hold.

### Alarm
- **Alarm Red** (`alarm`): destructive actions and errors only.

### Named Rules
**The Four Inks Rule.** Hue appears only as an emblem colour, an alarm, or the
answer's gold. A new accent, a coloured heading or another tinted card is a
further meaning for colour, and a reader will look for what it means. Gold is
never used on an input, a button or a heading: it marks the answer and nothing
else.

**The One Recipe Rule.** Emblem colours differ by hue and weave only. Never
tune one hue's lightness or chroma on its own; `client/scripts/check-tone.mjs`
fails the build when gamut or AA contrast breaks.

**The Weave Is Not The Signal Rule.** The colour word ("RED") is always printed;
the weave confirms it. Colour is never the only way to tell two emblems apart.

## Typography

**Display Font:** Space Grotesk Variable (with Segoe UI, system-ui)
**Body Font:** Inter Variable (with system-ui, Segoe UI)

**Character:** Same grotesque skeleton, two jobs. Inter carries every number -
true tabular figures, unambiguous 0/O and 1/l - and Space Grotesk marks a
heading as a heading.

### Hierarchy
- **Brand** (Space Grotesk 600, 1.25rem): the page name in the header, one
  step above a dialog title.
- **Figure** (600, 1.5rem, tabular): the projected score. The largest thing
  on any card.
- **Answer Figure** (600, 2.25rem, tabular, -0.025em, leading 1): the figure on
  a gold answer card only. The one deliberate break in the tight scale, because
  the answer has to win the page at a glance.
- **Headline** (Space Grotesk 500, 1rem): card and dialog titles.
- **Body** (400, 0.875rem / 1.43): sentences and control labels. Cap prose at
  65-75ch.
- **Caption** (400, 0.75rem): intervals, run date, helper lines.
- **Label** (600, 0.7rem, uppercase, 0.12em tracking): fieldset legends, team
  names above players, emblem trait names.

### Named Rules
**The Names In Inter Rule.** Player and team names go in Inter, never Space
Grotesk: it lacks Cyrillic and Greek, and a nickname would render in two fonts.

**The Tight Scale Rule.** Steps between type roles are about 1.125, as
product UI wants, not the 1.25 a landing page would use. The detector's
`flat-type-hierarchy` warning is a known, accepted exception here; hierarchy
comes from weight, the Figure size and placement, not from bigger headings.

**The Interval Sits Under The Figure Rule.** A projection is set as figure, then
caption interval directly below. Never split them across a column or a fold.

## Layout

A max 72rem (`max-w-6xl`) container, 16px gutters on phone, 24px from 640px.
From 1024px the page is two columns: a 24rem question column and a fluid answer
column. Below 1024px it is one column and the answer moves into a dialog opened
from a bar pinned to the bottom of the viewport. The header carries brand,
tournament badge and stage switcher left; help, theme and account right (a menu
on phone). The footer is one centred line: data window and publish time.

Rhythm is the 4px Tailwind scale: 16px between cards, 16px card padding, 12px
compact. Answer cards grid three-up on desktop.

## Elevation & Depth

Flat by default. Cards are separated by a 1px 10% foreground ring, not a shadow.
Depth appears only for things that float above the page: dialogs and popovers
(shadow-md/lg with a blurred backdrop), a selected choice (shadow-xs), and the
active tab (shadow-sm).

### Named Rules
**The Gold Answer Rule.** The cards that ARE the answer (the lead unit on the
banner tab, the roster total on the roster tab) are filled in compendium gold,
with no outline. Everything else keeps the neutral 10% ring, including the
three slot cards: they are the parts the total is made of, not the output. Gold is how a reader finds the result first; spend it on
nothing else.

**The Lift Means Picked Rule.** A shadow on an in-page control means it is
selected or pressed. Do not use shadow for decoration.

## Shapes

Gently rounded, from one `--radius` of 10px: 6px small controls, 8px inputs,
10px buttons, 14px cards and choices, full pills for badges. Empty slots use a
dashed border so an unfilled place reads as a place to fill.

## Components

### Buttons
- **Shape:** gently rounded (10px), 32px tall default, 36px large.
- **Touch:** under a coarse pointer every button, tab and select grows to 44px
  (`pointer-coarse:` in `ui/button.tsx`, `ui/tabs.tsx`, `ui/select.tsx`).
  Keyed to the input, not the width: a narrow desktop window stays compact.
  Overlaid row controls (the X, Undo) widen their row's right padding to match.
- **Primary:** Ledger Ink fill, paper text; hover drops to 80%.
- **Outline / Ghost:** paper with hairline / no border; hover to Wash.
- **Press:** translates 1px down on active - the tactile press.
- **Focus:** 3px Focus Grey ring at 50%.

### Choices (signature chips)
- **Style:** 44px min height, 14px radius, hairline border, a faint top-to-bottom
  2% ink gradient at rest.
- **Selected:** Focus Grey border, Wash fill, medium weight, shadow-xs.
- **Emblem colour chips:** neutral at rest; the client weave arrives on hover
  and deepens on selection, with the colour word on top in `--emblem-ink-on`.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Paper (light), one step above Night (dark).
- **Border:** 1px 10% foreground ring.
- **Internal Padding:** 16px, 12px for `size="sm"`.

### Inputs / Pickers
- **Style:** dashed-border empty slot with a plus icon ("Build a 5-emblem
  banner", "Choose a core player"); filled, it becomes a solid row with avatar,
  name and a clear (x) button.
- **Unit picker:** a dialog of team cards, uppercase team label over player
  names over roles.

### Navigation
- **Tabs:** segmented control on a Wash track; the active tab is a paper pill
  with shadow-sm.
- **Stage switcher:** outline select in the header. The tournament id beside
  the brand is plain Pencil text, not a chip, because it does nothing.

### Answer card (signature)
Slot label, unit name in Pencil, Figure, caption interval "29,886–31,625 · 90%
range" (always from `interval()` in `lib/format.ts`), then a "See the 5
emblems" link. The figure and its interval are the card's whole job.

### Ranked ledger (signature)
The first unit is a gold lead card in two mirrored halves on one grid: name
over team Label on the left, Answer Figure over its interval on the right, each
row shared across the axis (stacked under a 24rem container). A tie is a
`tied with N` badge on the interval line. The team outlook sits below in a
recessed well (6% card ink, no rule), facts as equal columns, value over label,
outer ones flush to the edges. The rest are one ruled list: rank, name over team, score
over interval right-aligned in tabular figures. Tied rows lose their number and
carry a `tied` badge in both directions of the tool. Only the lead figure says
"90% range"; rows below show the bare range (`range()`), since the label would
repeat on every row.

### Limits and outlook (quiet by rule)
Caveats render as a caption-sized "Limits" list with no box, directly under the
answer: visible, never louder than the figure. The team outlook is a labelled line
("Team outlook: ~3.7 series to play · 17.6% chance to be out within 2 series ·
16.8% chance to win the event"), worded per stage because the same fields mean
different things in each; on the banner tab it sits inside the lead card, since
it describes that unit's team only.

### Banner strip (signature)
A built banner stays visible in its card as a row of 24px weave swatches in
banner order, dashed where a slot is empty. 24px because the swatch weaves are
framed for that size.

## Do's and Don'ts

### Do:
- **Do** set every projection as Figure with its interval caption directly
  beneath it.
- **Do** keep colour to the three emblem weaves, Alarm Red and the answer gold.
- **Do** give every selectable thing a visible press (1px) and a selected state
  beyond colour (border, fill, weight).
- **Do** run `npm run check:tone` after touching any emblem token.
- **Do** keep prose blocks at or under 75ch (about 30rem at 14px).

### Don't:
- **Don't** show a placeholder figure; use the skeleton panel.
- **Don't** introduce another accent hue, gradient text, or tint any card that
  is not the answer.
- **Don't** fill an emblem chip with a flat colour; it wears the weave.
- **Don't** set player or team names in Space Grotesk.
- **Don't** use shadows on resting in-page surfaces.
- **Don't** explain a thing twice on one screen. Each sentence says one fact
  once; reasoning lives in the FAQ, not under the number.
- **Don't** put a card around a line of three facts.
