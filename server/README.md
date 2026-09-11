# server

Express 5 + TypeScript. Loads one published run into memory at boot and computes
answers per request. It never calls Python and never runs the pipeline.

```bash
npm install
cp .env.example .env      # Supabase credentials optional; see below
npm run dev               # http://localhost:3000
npm test                  # contract validation
npm run build && npm start
```

## Boot states

The server distinguishes three situations because they need three different
answers from whoever is looking:

| `/api/health` | Means | Fix |
|---|---|---|
| `unconfigured` | neither `RUN_FILE` nor `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | set one |
| `empty` | reachable, nothing published, or the database is unreachable | publish a run |
| `ready` | serving | - |

A fourth outcome is deliberately not a state. **A payload that fails schema
validation kills the process at boot.** Everywhere else in this project a
missing input degrades into a smaller sample, because less evidence is still
honest evidence; a payload that does not match its own schema means the writer
and the reader disagree about what the bytes mean, and every number computed
from it would be confidently wrong. `npm test` pins that behaviour.

Byte lengths are checked alongside the schema, because they are the failure JSON
Schema cannot see: a base64 blob of the wrong length is a perfectly valid string
that decodes into a matrix with every column shifted.

## Endpoints

```
GET  /api/health          load state and why, for every loaded run
GET  /api/run/current     ?tournamentId=&stage=  -> run metadata, teams, players,
                          emblem catalog, `stageTeamIds`, `limits`, and
                          `available` (what else is loaded)
POST /api/player/rank     { role, emblems:[{emblemId, order}], tournamentId?, stage? }
                          -> ranked units
POST /api/banner/optimize { role, teamId, inventory:[{emblemId}], tournamentId?, stage? }
                          -> ranked banners for that unit
```

**Every current run is loaded, not one.** A tournament has stages and they are
not versions of each other: different field, different format, different banner
size, different simulator. Both query parameters narrow and neither is required;
with none, the newest run answers. A request naming a stage nobody published
404s with `available` rather than falling back - a Group Stage question answered
with Main Event numbers is a wrong answer wearing the right shape.

`RUN_FILE` loads runs from `publish.py --out` payloads instead of Supabase
(comma-separated, one per stage). It is
validated by the same schema on the same code path, so it is a real run that
skips the database -- which is what makes the whole stack runnable before the
database exists.

`/api/player/rank` ranks a team's **duo** for core and support and a single
player for mid, because the client scores a role rather than a person. `role` is
required for exactly that reason. Answers are memoised per run and body: a run
is immutable, so the same banner has the same answer for the life of the
process. Cold ~115ms for eight units, warm ~2ms.

`/api/run/current` returns 404 with a `reason` and a `hint` when nothing is
published - that is a state for the client to render, not an error. Sample
matrices are not returned: they are megabytes of Float32 that only the scorer
reads. Two fields on it are not properties of the run and travel with it anyway,
because a client that has to guess either would offer a choice this server then
refuses: `stageTeamIds` is the teams this stage actually projects (a Main Event
payload carries sixteen rosters and eight projections), and `limits.maxInventory`
is the search bound below.

### The banner search

`/api/banner/optimize` is `/api/player/rank` from the other end: the unit is
fixed and the banner is the free choice. It searches the emblems you **own**
rather than the catalog, because the catalog is not a choice anyone has - five
slots drawn from 450 generatable emblems is around 10^13 ordered arrangements,
and an exhaustive answer over an inventory beats a heuristic's guess over
everything.

Three things make it exhaustive and still fit in a request:

* **Order is a candidate, not a tie-break.** Vampiric charges each neighbour
  -10% and Benevolent pays each +20%, so the search enumerates ordered
  selections. Twelve emblems in five slots is 95,040.
* **A banner and its mirror image score identically.** Reversing maps every
  emblem's neighbours onto the reversed position's, and the whole-banner
  conditions do not depend on order at all, so exactly half of those are
  duplicates and only one of each pair is kept. 47,520 remain.
* **One schedule, drawn once.** Every candidate is scored against the same pool
  of observed games under the same recency weights, so `scoring/screen.ts`
  draws the simulated periods ONCE and replays them. That is common random
  numbers: candidates share their sampling error instead of adding to it, which
  is why 240 simulations separate banners there and would not here. It is also
  about ten times cheaper than re-drawing, which is the whole latency budget.

The leading ten emblem *sets* are then rescored at `scoring.sims` with a
bootstrap interval, and the answer reports how many. Alternatives are one row
per set and never reorderings of the winner - what the order is worth is said
once, by rescoring the winning set in its worst arrangement. Cold ~930ms for the
full 47,520, warm ~3ms.

`config.search.maxInventory` is a latency bound and not a rule of the game.
Raising it costs roughly a factor per extra emblem.

`test/optimize.test.ts` pins the four traps, each of which produces a plausible
number rather than an error: the screen and the full rescoring disagreeing about
what a simulated period is, the mirror fold discarding a banner that is not its
mirror's equal, the two directions scoring one banner differently, and the
alternatives filling up with reorderings of one set.

Not built yet: `/api/roster/score`.

## Layout

The database read is one PostgREST request for one row, made once at boot.
There is no Postgres driver here and no `@supabase/supabase-js`: a dependency
that exists to make many queries convenient earns nothing against one. The
payload lives in a single `json` column, so the whole run arrives in that one
response.

`public.runs` has row-level security enabled and **no policy**. That is the
intended end state, not an oversight - only the secret key (which carries
BYPASSRLS) reads it, so a browser key pointed at that table returns an empty
set rather than the corpus.

```
src/config.ts         every knob, read from the environment once
src/validate.ts       the contract, and the crash that enforces it
src/run-store.ts      the in-memory run, loaded once at boot
src/memo.ts           answers remembered per run and request body
src/routes/           one file per resource
src/scoring/
  decode.ts           base64 columns -> typed arrays, once at boot
  units.ts            the duo or player a banner is worn by
  banner.ts           what a stat pays, and what a multiplier does to it
  project.ts          E[best series] and its bootstrap interval
  screen.ts           the same simulated periods, drawn once and replayed
  optimize.ts         which banner to build out of the emblems you own
  answer.ts           the tie rule and the caveats, shared by both directions
  random.ts           seeded RNG, weighted sampling, Dirichlet
src/app.ts            wiring; the only file that knows the order
```

`banner.ts` is split into a stat half and a multiplier half on purpose. What a
stat pays in a game does not depend on the banner it lands on, so the search
computes that once and rebuilds only the multipliers - and, more to the point, a
banner scored by the search and the same banner scored by `/api/player/rank`
cannot come out differently, because there is one implementation of either half.

Types come from `../shared/run-types.ts`, generated from
`shared/run-schema.json` by `npm run gen:types`. Never hand-edit them, and never
declare a second copy of a contract type here or in the client.
