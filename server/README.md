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
| `ready` | serving | — |

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
GET  /api/health         load state and why, for every loaded run
GET  /api/run/current    ?tournamentId=&stage=  -> run metadata, teams, players,
                         emblem catalog, and `available` (what else is loaded)
POST /api/player/rank    { role, emblems:[{emblemId, order}], tournamentId?, stage? }
                         -> ranked units
```

**Every current run is loaded, not one.** A tournament has stages and they are
not versions of each other: different field, different format, different banner
size, different simulator. Both query parameters narrow and neither is required;
with none, the newest run answers. A request naming a stage nobody published
404s with `available` rather than falling back — a Group Stage question answered
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
published — that is a state for the client to render, not an error. Sample
matrices are not returned: they are megabytes of Float32 that only the scorer
reads.

Not built yet: `/api/banner/optimize`, `/api/roster/score`.

## Layout

The database read is one PostgREST request for one row, made once at boot.
There is no Postgres driver here and no `@supabase/supabase-js`: a dependency
that exists to make many queries convenient earns nothing against one. The
payload lives in a single `json` column, so the whole run arrives in that one
response.

`public.runs` has row-level security enabled and **no policy**. That is the
intended end state, not an oversight — only the secret key (which carries
BYPASSRLS) reads it, so a browser key pointed at that table returns an empty
set rather than the corpus.

```
src/config.ts      every knob, read from the environment once
src/validate.ts    the contract, and the crash that enforces it
src/run-store.ts   the in-memory run, loaded once at boot
src/routes/        one file per resource
src/scoring/       decode, banner arithmetic, seeded RNG, E[best series]
src/app.ts         wiring; the only file that knows the order
```

Types come from `../shared/run-types.ts`, generated from
`shared/run-schema.json` by `npm run gen:types`. Never hand-edit them, and never
declare a second copy of a contract type here or in the client.
