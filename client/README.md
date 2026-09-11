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
  identical rankings — the model does not know who is asking — and saves
  nothing. The dialog says so before the choice, not after.
- The stage switcher, built from what the server actually holds. A stage nobody
  has published does not appear, and switching clears the banner rather than
  carrying it: three emblems sitting in five slots would read as a banner still
  being built, not as the answer to a different question.
- Banner size read from `run.bannerSlots`, never inferred from the stage name.
- Saved banners, owned per user by row-level security. Loading one resolves
  emblem ids against the current run's catalog; an id this run does not
  generate comes back as an empty slot rather than silently scoring a shorter
  banner.
- The banner builder: a stat already placed cannot be placed twice, order is an
  input because two emblem traits are positional, and an emblem carrying a stat
  the model cannot measure is marked before it is chosen rather than after it
  scores zero.
- `POST /api/banner/optimize` through `useOptimize` — the player -> banner
  direction. Pick a player, list the emblems you rolled, and every legal
  arrangement of them is scored. Notes on it:
  - Only teams this stage projects are in the picker, read off `stageTeamIds`.
    A Main Event run carries sixteen rosters and eight projections, so listing
    every team would offer eight knocked-out sides, each a pick that 404s.
  - The inventory allows two emblems carrying the same stat and the banner
    builder does not. Both are right: a banner may repeat a colour but never a
    stat, so owning both is precisely the choice the search resolves, and
    placing both is illegal.
  - The cap on how many emblems you may own comes from the server
    (`limits.maxInventory`), because it is a latency bound rather than a rule of
    the game. A copy of it here would start refusing at the wrong place the day
    it is tuned.
  - The answer names who actually wears the banner. Core and support are duos,
    and which two players the run has joint samples for is a fact only the
    server holds — so the picker offers a player and the panel reports the pair.
  - What the ORDER is worth is shown as a measured gap: the winning emblems in
    their worst arrangement, scored the same way. It is the only part of the
    answer someone can act on without owning anything else.

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
fix — run `publish.py` — is useless advice for the second.

## What is deliberately not wired

- The whole-catalog search — "the best banner to aim for, out of everything".
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

Three pieces are shared by both directions on purpose, because both produce a
ranked list with intervals on it and a reader who saw one of them hedge and the
other not would reasonably conclude the second knew more: `tie-note.tsx`,
`tournament-context.tsx`, and `verdictFor` in `lib/ranking.ts`, which takes ids
rather than rows for exactly that reason.

`emblem-card.tsx` is NOT the banner builder's row, which looks similar. That row
is a control with an empty state, a "no data" badge and a dialog behind it, and
half its markup exists for the emblem that is not there yet; the card always has
an emblem and is drawn twelve to a screen. They share the palette by calling
`colorStyle`, never by repeating any of it.
