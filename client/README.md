# client

React + Vite + TypeScript SPA for the DotaPredictions web tool. shadcn/ui
components, Tailwind v4, TanStack Query.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to localhost:3000
npm run build    # -> dist/, served by Express in production
```

The app renders nothing it cannot source from a published run. With no server
running it says so; with a server but no run it says how to publish one. No mock
data and no placeholder scores: an unmeasured value is not a zero, and a
fabricated one is indistinguishable from a real result.

## What is wired

- `GET /api/run/current` through `useRun`, with the empty and error states.
- `POST /api/player/rank` through `useRank`, gated on a complete banner: a
  partial banner is a different question, not a cheaper version of the same one.
- Supabase auth (Google, GitHub) and **continue as guest**. A guest gets
  identical rankings - the model does not know who is asking - and saves
  nothing. The dialog says so before the choice, not after.
- The stage switcher, built from what the server actually holds. A stage nobody
  has published does not appear, and switching clears the banner rather than
  carrying it: three emblems sitting in five slots would read as a banner still
  being built, not as the answer to a different question. It is a menu, and the
  header no longer badges the stage beside it - a row of buttons put the
  current stage on screen twice, and two places to read one fact is one place
  too many the day they disagree.
- Tournament ids are the API's key and travel lowercase; `lib/labels.ts`
  capitalises the International's `ti<year>` form for display only (`TI2026`).
  The edition number is not derived from the year - that is Valve's schedule,
  not arithmetic.
- Banner size read from `run.bannerSlots`, never inferred from the stage name.
- Saved banners, owned per user by row-level security. Loading one resolves
  emblem ids against the current run's catalog; an id this run does not
  generate comes back as an empty slot rather than silently scoring a shorter
  banner.
- The banner builder: **the colour of each slot is fixed by role** and read off
  the run (`scoring.bannerColors`), so slot 2 of a Core banner offers six green
  stats rather than all eighteen and the dialog shows the colour instead of
  asking for it. A stat already placed cannot be placed twice, order is an input
  because two emblem traits are positional, and an emblem carrying a stat the
  model cannot measure is marked before it is chosen rather than after it scores
  zero.
- Both tabs ask for three sets of emblems, one per fantasy slot, and both fold
  each set behind a count (`EmblemSetDialog`). Fifteen emblem cards stacked in a
  sidebar pushed the questions a tab is actually asking off the screen, and an
  emblem stops changing once it is entered - so it is the part that folds away
  and the count, which is still in flux, is what stays out. The shell is shared
  because the two sets differ only in wording and in what goes inside: a banner
  is ordered and exactly the stage's length, an inventory is neither.
- The banner tab was one role dropdown and one banner. Switching it swapped the
  question *and* the answer, so comparing what core and support were wearing
  meant holding one of them in your head. Three cards ask all three at once, and
  there is no total across them: those are three separate rankings, and the best
  unit from each is not a roster anybody is fielding.
- `POST /api/banner/target` through `useTarget` - the roster tab's whole
  question. Pick a core, a mid and a support; each gets the banner worth most to
  it out of the entire catalog, and the three scores sum to a ceiling for the
  roster. No inventory is involved, which is the point: the answer is a goal to
  roll toward, so it does not move when what you own does. What was searched is
  on screen, because the two halves of it are different claims - every
  quality/trait combination that any stat values could make best was compared
  (20 of 9,765,625, the rest beaten in every slot at once), while the stats were
  screened down to the top twelve of eighteen.
- `POST /api/banner/optimize` through `useOptimize` - the player -> banner
  direction, and on the roster tab the follow-up rather than the question. It
  appears under a slot's target once emblems have been entered for that slot,
  with the gap between the two stated as a number: what rolling for the target
  is actually worth. Pick a player, list the emblems you rolled, and every legal
  arrangement of them is scored. Notes on it:
  - Only teams this stage projects are in the picker, read off `stageTeamIds`.
    A Main Event run carries sixteen rosters and eight projections, so listing
    every team would offer eight knocked-out sides, each a pick that 404s.
  - The inventory holds exactly one banner's worth of emblems - three in a
    group stage, five in a main event - read off `run.bannerSlots` like the
    banner builder, so a period with a different banner size needs no client
    release. The server's `limits.maxInventory` is a looser latency bound
    behind it and never binds first.
  - A stat already entered is unselectable, and so is every stat of a colour
    whose slots are already spoken for. At this size both are load-bearing
    rather than tidy: an inventory that is five emblems in the wrong colours is
    a full inventory that cannot be worn, and the search would come back empty.
  - The answer names who actually wears the banner. Core and support are duos,
    and which two players the run has joint samples for is a fact only the
    server holds - so the picker offers a player and the panel reports the pair.
  - What the ORDER is worth is shown as a measured gap: the winning emblems in
    their worst arrangement, scored the same way. It is the only part of the
    answer someone can act on without owning anything else.

- Light, dark and **system** themes. Three states rather than a toggle's two:
  a reader who never touched the control wants the OS followed, and one who
  picked light at noon wants light at midnight - collapsing them means the only
  way back to following the OS is clearing site data. The choice is stored, and
  a blocking script in `index.html` applies it before the stylesheet paints, so
  a dark reader never gets a white frame. That script is a deliberate second
  copy of `lib/theme.ts`, documented at both ends: importing a module there
  would be too late to matter.

The rule that matters in `lib/ranking.ts`: results whose intervals overlap
render as **tied**, with no rank number and no winner. On the current banners no
slot's #1 is separated from its #2, so crowning one is the specific error this
tool exists to avoid.

The tabs are controlled rather than left to themselves, because the answer
column belongs to whichever question is open. An answer to the question you are
not looking at is worse than no answer: it is still a number.

`ApiError` carries the server's own `error` code and `reason` alongside the
status, and `states.tsx` matches on the code. "Nothing published for this
stage" and "that team is not in this stage" are both 404, and the first one's
fix - run `publish.py` - is useless advice for the second.

## What is deliberately not wired

- The whole-catalog search - "the best banner to aim for, out of everything".
  Five slots from 450 generatable emblems is around 10^13 ordered arrangements,
  so it cannot be answered exhaustively and would have to be a heuristic's guess
  reported as a result.
- Saving an inventory. Saved banners are a banner; an inventory is a different
  object with a different lifetime, and reusing that table for it would make one
  row mean two things.
- Anything that would let a guest's work be silently discarded. A guest is
  never offered a save button that does nothing.

## Configuration

```bash
# Root .env (client/vite.config.ts sets envDir to the repo root)
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only `VITE_`-prefixed names reach the bundle, which is why `SUPABASE_SECRET_KEY`
can share the same file. With neither set the app still runs: everyone is a
guest, ranking works, and the header says sign-in is unavailable.

## Layout

```
src/
  types/run.ts       the API response envelope; run types re-exported from
                     shared/run-types.ts, never redeclared
  lib/api.ts         the only module that knows the server exists
  lib/supabase.ts    the only module that knows Supabase exists
  lib/format.ts      the only place a number becomes a string
  lib/ranking.ts     when two answers cannot be told apart
  hooks/use-run.ts   the current run
  hooks/use-rank.ts  units through a fixed banner
  hooks/use-optimize.ts  banners for a fixed unit
  components/        one job each; ui/ is shadcn
```

Two pieces are shared by both directions on purpose, because both produce a
ranked list with intervals on it and a reader who saw one of them hedge and the
other not would reasonably conclude the second knew more: `tournament-context.tsx`
and `verdictFor` in `lib/ranking.ts`, which takes ids rather than rows for exactly
that reason.

A third used to be `tie-note.tsx`, a sentence under each list saying how many
rows were indistinguishable and how many of them were shown. It is gone. A tie
is now marked only on the row -- no rank number, a `tied` badge -- so the SIZE
of a tie, and the fact that the banner panel shows two of them out of ten, is no
longer stated anywhere.

`emblem-card.tsx` is NOT the banner builder's row, which looks similar. That row
is a control with an empty state, a "no data" badge and a dialog behind it, and
half its markup exists for the emblem that is not there yet; the card always has
an emblem and is drawn twelve to a screen. They share the palette by calling
`colorStyle`, never by repeating any of it.
