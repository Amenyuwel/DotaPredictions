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

The rule that matters in `lib/ranking.ts`: results whose intervals overlap
render as **tied**, with no rank number and no winner. On the current banners no
slot's #1 is separated from its #2, so crowning one is the specific error this
tool exists to avoid.

## What is deliberately not wired

- The player -> banner direction, which needs a constrained search over an
  emblem inventory that no engine function performs yet.
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
  components/        one job each; ui/ is shadcn
```
