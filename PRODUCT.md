# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally:

- **Casual compendium players.** Dota fans filling in The International's fantasy
  game mid-event, often on a phone, who want a quick answer to "which banner" or
  "which units" and are not stats people.
- **Min-maxers.** Engaged fantasy players who compare options carefully, usually
  at a desk, and want the intervals, caveats and the reasoning behind a number.

The tool launches publicly (Reddit, Discord, social) to people who have never
heard of it, so every screen must explain itself to a stranger. Neither audience
can audit the model themselves.

## Product Purpose

A free web tool for the TI compendium fantasy game. It answers two mirrored
questions, per fantasy slot (core, mid, support):

1. **"I have a banner"** - the user builds a War Banner (emblems, in order); the
   tool ranks the units that score best through it.
2. **"My roster"** - the user picks a core, a mid and a support; the tool names
   the banner each should roll for, searched over the whole emblem catalog, and
   projects the roster total.

Success: a reader leaves with a decision they can act on in the client, and
knows how sure the tool is about it.

## Positioning

Projections come from a Monte Carlo simulation of the actual tournament format
(Swiss group stage, double-elimination Main Event), and fantasy is scored as
**E[best game]**, not mean x games - the rule TI fantasy actually uses. That is
why variance counts as an asset and games played barely matters here, which
inverts normal fantasy intuition. Every number carries an interval, and the
engine reports what it cannot measure rather than scoring it as zero.

## Operating Context

- Used during a live event, per stage: a Group Stage roster and banner, then a
  fresh Main Event roster from the survivors. Each stage has its own banner size
  (3 emblems in Group Stage, 5 in Main Event), catalog, and 40 reroll tokens.
- The user works between this tool and the Dota 2 client: they read emblems they
  rolled in-game and enter them here, then act on the answer in-game.
- Numbers come from immutable published "runs" (snapshots built by the Python
  engine). The client renders only what a run contains.
- Optional sign-in (Google, GitHub via Supabase) saves banners and rosters;
  **continue as guest** gets identical answers and saves nothing.
- An admin page edits tournament config and publishes runs.

## Capabilities and Constraints

- Not a TI 2026 tool: tournaments, stages, rosters, scoring and banner sizes are
  data scoped to a `tournamentId`. UI must never hard-code a tournament detail.
- Banner slot count and slot colours are read off the run, never inferred.
- Terminology the UI uses and must keep consistent: **banner**, **emblem**,
  **slot** (core / mid / support), **unit** (core and support are duos, mid is
  one player), **stage** (Group Stage, Main Event), **run**, **Coach Titles**,
  **reroll tokens**.
- Stack is fixed by the codebase: React + Vite + TypeScript, Tailwind v4,
  shadcn/ui on Base UI, TanStack Query, Express server, Supabase.
- Light and dark themes, plus follow-system.

## Brand Commitments

- Name: **DotaPredictions**.
- Voice: plain, exact, and honest about uncertainty. Sentences explain why, not
  just what. No hype.
- Binding honesty rules (confirmed by the owner; simplify presentation freely,
  never break these):
  - No placeholder or mock numbers. A loading or missing value is shown as such;
    a fabricated number is indistinguishable from a real one.
  - Every projection shows its interval.
  - Caveats are rendered in the UI, next to the number they qualify, not buried
    in a footnote.
  - The run's date and data window are always visible.
  - A missing measurement is not a zero; unmeasurable stats are marked as such.

## Evidence on Hand

- Measured results and their numbers: `README.md` (e.g. +0.33 expected correct
  picks from optimal assignment; top 15 rosters span about 3%; Coach Titles worth
  +4 to +8%).
- Client rules for the fantasy game: `docs/ti2026-how-to-play.md`.
- Worked analyses: `docs/ti2026-main-event-picks.md`,
  `docs/ti2026-bracket-outcomes.md`.
- Images: `public/Fantasy.png`, `public/Predictions.png`.
- None exist and must not be invented: testimonials, user counts, accuracy
  track record against past events, press. No statement of (non-)affiliation
  with Valve is in the UI today.

## Product Principles

1. **A wrong number must be loud.** Prefer showing uncertainty, staleness or a
   gap over a clean-looking answer that hides one.
2. **Answer first, depth on demand.** A casual reader gets a decision at a
   glance; the interval and caveat are on the same screen and the reasoning is
   one step away - never removed.
3. **One question per view.** Never show an answer to a question the user is not
   currently asking; a number on screen is read as an answer.
4. **Explain to a stranger.** Public users arrive cold, so terms like banner,
   unit, E[best game] and interval need a plain-language path.
5. **Phone and desk are both first-class.** The mid-event phone check and the
   careful desktop comparison are the same product.

## Accessibility & Inclusion

WCAG 2.2 AA. Text and emblem-chip contrast is enforced in code by
`client/scripts/check-tone.mjs`; colour must never be the only way two emblem
colours are told apart (each colour also carries a pattern). Existing
commitments to keep: skip link to answers, live region on the answer column,
light and dark themes.
