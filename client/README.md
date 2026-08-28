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
- The banner builder: a stat already placed cannot be placed twice, order is an
  input because two emblem traits are positional, and an emblem carrying a stat
  the model cannot measure is marked before it is chosen rather than after it
  scores zero.

## What is deliberately not wired

- `/api/player/rank` — the server does not exist yet. `result-panel.tsx` and
  `lib/ranking.ts` are ready for it and carry the rule that matters: results
  whose intervals overlap render as tied, with no rank number and no winner.
- The player -> banner direction, which needs a constrained search over an
  emblem inventory that no engine function performs yet.

## Layout

```
src/
  types/run.ts       the server contract. REPLACE with types generated from
                     shared/run-schema.json as soon as that file exists
  lib/api.ts         the only module that knows the server exists
  lib/format.ts      the only place a number becomes a string
  lib/ranking.ts     when two answers cannot be told apart
  hooks/use-run.ts   the current run
  components/        one job each; ui/ is shadcn
```
