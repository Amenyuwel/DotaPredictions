# DotaPredictions Web Tool — Build Plan

Plan for `.claude/dotapredictions-build-prompt.md`: a free, no-login web tool
answering **player → banner** and **banner → player**, tournament-aware, backed by
the existing Python engine running batch-only behind immutable Mongo snapshots.

---

## Decision: one monorepo

**Recommendation: keep everything in this repo.** Four reasons, in order of weight.

1. **The schema is the product.** `shared/run-schema.json` is written by Python,
   read by Express, and generates the client's types. The spec's own words: "A
   schema change is one commit touching all three sides." Across three repos that
   is three PRs, a version matrix, and a window where writer and reader disagree —
   exactly the failure the spec demands must crash rather than silently render
   wrong numbers. A monorepo makes that commit atomic and the crash unreachable.
2. **Checkpoint 4 is a cross-language test.** Comparing a TypeScript score against
   Python's `out/analysis.json` digit by digit needs both trees at compatible
   commits. In one repo that is a test. Across repos it is a CI integration with a
   pinned submodule.
3. **The server ships the client.** The spec already requires Express to serve
   `client/dist` in production "so there is one origin and no CORS configuration
   at all." Two halves of one deploy artifact do not want two repos.
4. **Single maintainer.** Separate repos buy independent release cadence, separate
   issue trackers and per-repo access control. None applies here.

**The honest counterargument**, and why it loses: Python is batch/cron and the web
app is a long-running service, so they deploy differently. True — but that is a
*deploy* boundary, solved by one Dockerfile per service inside one repo. Splitting
the repo to express a deploy difference costs the atomic schema commit and buys
nothing back.

**Cost of restructuring now: one commit, zero code changes.** Verified:
`dota/config.py:11` derives `ROOT` from `__file__`, and every path (`CONFIG_DIR`,
`DATA_DIR`, `CACHE_DIR`, `OUT_DIR`) hangs off it. A grep for a literal `open(...)`
or `Path(...)` string across `dota/`, `scripts/` and `tests/` returns nothing. Move
the Python tree under `engine/` and `ROOT` re-derives to `engine/` on its own. Only
the invocation directory changes.

---

## Phase 0 — Restructure

```bash
git mv dota scripts config data tests requirements.txt engine/
mkdir -p server client shared
```

Stays at root: `README.md`, `CLAUDE.md`, `docs/`, `public/`, `.gitignore`,
`.env.example`, `.claude/`.

Follow-ups in the same commit:

- `.gitignore` — repoint `data/cache/` and `out/` to `engine/data/cache/` and
  `engine/out/`; add `node_modules/`, `client/dist/`, `server/dist/`.
- Add `jsonschema` to `engine/requirements.txt` (not currently installed).
- Update run commands in `README.md` and file paths in `CLAUDE.md`.

**Done when:** `cd engine && python -m pytest tests -q` passes and
`python -m scripts.bracket_outcomes` still runs offline off the existing cache.
Do not touch a `.py` file in this commit — if one needs editing, the move is wrong.

---

## Phase 1 — `shared/run-schema.json`

The contract. Version it `schemaVersion: 1` and treat every later change as
breaking until the tool has users.

Four corrections to the spec's draft data model, each traced to engine behaviour.

### 1. `playerSamples` rows need a match key and per-game context

The spec keys rows by `seriesIndex`. That cannot reproduce a slot score:
`engine/dota/fantasy.py:role_game_scores` averages the duo **within the same
match**, keeping only matches where both members appear — deliberately, to
preserve teammate correlation. And `project_slot` fits **one shared banner** to the
duo's combined means. Per-player rows with no join key silently produce wrong core
and support numbers.

Stat matrix layout stays as the spec has it. Add these per-row scalars, all already
on `engine/dota/sources/base.py:PlayerGame`:

| Column | Needed by |
|---|---|
| `matchId` | duo join, dedupe |
| `heroId` | coach prefix (`Cerulean` fires on Valve's `Blue` flag) |
| `won` | suffix `the Underdog` |
| `durationSeconds` | `the Decisive`, `the Lucky` |
| `firstBloodTime` | `the Patient`, `the Flayed Twins Acolyte` (negative = pre-horn) |
| `startTime` | recency weights in the bootstrap |

Keep them in a parallel block — one scalar per row, not part of the stat matrix.

### 2. Series structure is simulated, not observed

`seriesIndex` does not exist in history. Observed games are only a **bootstrap
pool**; the schedule is drawn by `engine/dota/bracket.py:simulate`, which emits
`series_samples` (games-per-series shapes such as `(3,2,3)`) and `decider_samples`
(did the series go the full distance — needed by `the Clutch`, and not recoverable
from a game count, since a 3-game Bo5 is not a decider).

So `stageProjections` carries, per team:

```js
{
  runId, teamId,
  swiss: { bucketProbs, advanceProb },
  bracket: { placementProbs, winProb },
  seriesSamples: <BSON Binary>,   // Int8, nSims x maxSeries, 0-padded
  deciderSamples: <BSON Binary>,  // Uint8 bitmask, same shape
  nSims,
  expectedSeries, eliminationRisk
}
```

`expectedSeries: 3.2` alone is insufficient, and the README says why: a game count
cannot express "top two games *within* a series, then best series."

### 3. Emblems carry a trait; the multiplier is derived

The spec's `{emblemId, stat, multiplier, tier}` makes the multiplier a property of
the emblem. It is not. Vampiric charges each **neighbour** −10% and Benevolent pays
each **+20%**, so the displayed value comes from tier + trait + neighbours
(`engine/dota/emblems.py:multipliers`). Without `trait`, all 120 permutations score
identically and the ordering feature is inert.

```js
{ emblemId, stat, tier, trait, displayName }   // multiplier derived, never stored
```

Port `emblems.check_against_client` as a publish-time assertion so a transcription
error fails the run.

### 4. Unmeasurable stats are absent, not discounted

The spec's example caveat reads "lotuses_grabbed unmeasurable — treated as flat
1.20". The engine does the opposite on purpose: unmeasurable stats are excluded
from valuation, never scored (`banner.stat_points` returns `None`;
`config/scoring.yaml` lists `watchers_taken` and `lotuses_grabbed`). Correct caveat
text: *"scores 0 for every player — real points the model cannot see."* This matters
because the Main Event support banner carries Lotuses at ×1.20 with no rerolls
left, which is exactly why support ordering deserves less confidence than its
numbers suggest.

**Done when:** the schema validates a hand-written fixture run and
`json-schema-to-typescript` emits types the server compiles against.

---

## Phase 2 — `engine/scripts/publish.py`

One new script. It must not reimplement anything — it calls `pipeline.analyse`,
then serialises.

Emits, all scoped to one `runId`:

- `runs` — `engineVersion` from the git SHA, `configHash` over `config/*.yaml`,
  `params` from CLI flags, `dataWindow` from `corpus.matches`.
- `teams` / `players` — from `cfg.roster`, by ID only. Fold `also_team_ids` into
  `alsoTeamIds`: this is the Iron Wing failure mode, one org with two ids and
  sixteen TI games nearly lost.
- `emblems` — `config/banners.yaml` plus the tier/trait tables in
  `config/scoring.yaml`.
- `playerSamples` — `analysis.adjusted_games`, i.e. lines **after** the factor
  stack, plus `analysis.game_weight`. Publishing raw lines would make the server
  disagree with `report.py`.
- `stageProjections` — the `SwissOutcome` and `BracketOutcome` fields above.
- `factorAudit` — `analysis.factor_reports`, including `kind: "absent"` rows, so a
  known hole shows up as a hole.

Publish-time assertions, all fail-loud:

- every probability distribution sums to `1.0 ± 1e-9`;
- schema validation via `jsonschema`;
- `emblems.check_against_client` returns empty;
- `nGames` matches the matrix row count for every player;
- flip `isCurrent` in a transaction — the old run stays queryable, never mutated.

**Done when:** one real run lands in Mongo and `db.playerSamples.countDocuments()`
matches the roster size.

---

## Phase 3 — Express, `/api/player/rank` only

Boot: load the current run into memory once, validate against the schema on read,
crash on mismatch. Binary reads become `Float32Array` views with no parsing.

Port exactly these, in order — they are the scoring chain, and nothing else matters
until they agree:

| Python | TypeScript |
|---|---|
| `banner.banner_score_for_game` | per-game banner score |
| `emblems.multipliers` / `best_order` | positional traits, 120 permutations |
| `titles.game_multiplier` | prefix per hero, suffix per game |
| `fantasy.role_game_scores` | **duo join on `matchId`** |
| `fantasy.plan_series` / `score_plan` | top-2-in-series, best-series |
| `fantasy.best_series_interval` | Dirichlet bootstrap CI |

Perf: `best_series_interval` defaults to 160 replicates × 800 sims **per slot**.
Across 16 candidate duos that is the one thing between this and an interactive UI.
Vectorise over typed arrays the way `score_plan` already does (grouped by series
length), and make the replicate count server config so it is tuned against measured
latency rather than guessed.

Ranking unit: for `core` and `support` the unit is a team's **duo**, not a player —
return `{teamId, slot, nicks[]}`. Only `mid` is a single player.

**Done when:** `/api/player/rank` returns a score for one banner.

---

## Phase 4 — The checkpoint that matters

Before any more breadth. Take one locked slot — `support / Team Spirit` under the
Main Event banner is the best candidate, since `docs/ti2026-main-event-picks.md`
records it at **15,379** — and compare the TypeScript number against Python digit
by digit.

Sources of truth, in order: `engine/out/analysis.json` (full precision), then
`python -m scripts.main_event`.

Pin both sides to the same RNG seed (the engine uses `20260813` and `20260820`) and
the same `n_sims`. Commit the comparison as `server/test/parity.test.ts` with a
golden fixture so a later refactor cannot quietly break it.

**Any mismatch is a serialization bug. Stop and fix it — do not build past this.**

---

## Phase 5 — Client, banner → player only

Vite SPA, one screen: banner builder → ranked duos/players, filterable by role.
TanStack Query, TanStack Table, Recharts for intervals. Debounce 250 ms, POST on
change. Header shows run timestamp and data window.

**Ship here.** One direction is already a usable tool.

The interval rule is a requirement, not a nicety: on the current banners no slot's
#1 is separated from its #2 — core leads by 45 against a 737-point joint sampling
error, mid by 146 against 580, support by 280 against 565. When #2 falls inside
#1's interval the UI must render them **tied**. Crowning a winner there is the
specific error this tool exists to avoid.

Caveats render in the result panel, never in a footnote.

---

## Phases 6-10 — Breadth

6. **Group stage run + stage switcher.** Publish `{ti2026, group}` and add the
   switcher. This is the first real test that nothing hardcodes an emblem count
   (3 in the group stage, 5 in the main event) or a bracket shape. Requires
   `dota/swiss.py` to emit `decider_samples` beside `series_samples`, so both
   stages feed the scorer identically.
7. `/api/banner/optimize` and the player → banner direction: emblem inventory →
   best orderings, exhaustive over 120.
8. Share URLs (`?t=&s=&p=&e=`), then print stylesheet + `window.print()`. No
   html2canvas. Tournament and stage go in the URL or links rot on the next event.
9. `/api/roster/score`, alternatives table, caveats panel. The roster scorer must
   sample all three slots on the **same** simulated bracket
   (`plan_series(indices=...)`); independent draws leave the mean correct and
   understate the spread by ~0.9%, which is the entire question a risk view asks.
10. **`scripts/new_tournament.py` and the tournament switcher.** Validate it by
    scaffolding a *past* event from its league ids and diffing the derived roster
    against the config already committed — the one test that proves onboarding
    works without waiting a year for the next TI.

---

## Multi-tournament: what makes a stale roster fail loudly

The costliest bug this project has produced was a stale org id that raised no
error — sixteen TI games landed on a team the model had never heard of, and it
was rated on no evidence while still printing a projection. `publish.py` turns
that class of bug into a refusal to publish:

- every player resolves; no fuzzy matches, no duplicate `account_id`s
  (`resolve.problems` already returns this as a blocking list);
- every team's rating fit saw at least `--min-team-games` result rows
  (`ratings.evidence`) — this is the gate that would have caught Iron Wing;
- roster drift: the five configured accounts match the five most-played accounts
  in that team's recent games;
- orphan-id sweep: a pinned `team_id` whose recent matches carry an unknown name
  is reported as an `also_team_ids` candidate;
- `verified_against_client: true`, so a scoring table copied forward from last
  year and never re-checked cannot ship.

`--force` exists, records which gate was overridden on the run document, and is
the only way past any of them.

Config becomes per-tournament (`engine/config/<tournamentId>/`), with only
`hero_adjectives.yaml` global since it comes from the game client rather than an
event. `scripts/discover_rosters.py:29` hardcodes the TI 2026 qualifier league
ids in a module constant — that moves into each tournament's `tournament.yaml`.

---

## Ops

- **Mongo:** Atlas free tier. Docker is not installed on this machine, so
  `docker-compose.yml` is a later convenience, not a prerequisite.
- **Indexes:** `{runId, playerId}` unique on `playerSamples`; `{isCurrent}` on
  `runs`; `{runId, teamId}` on `stageProjections`.
- **No auth:** rate limit 60 req/min by IP; `Cache-Control: public, max-age=3600`
  on `/api/run/current`; LRU memo on POST bodies keyed by hash.
- **Numbers:** doubles end to end. Format in React only — never in the API or DB
  layer.
- **Dev:** Vite proxy for `/api`. **Prod:** Express serves `client/dist`, one
  origin, no CORS.

---

## Open questions

**Answered.** *Both stages ship*, group and main, with `stage` part of the run key
and part of every request. Main Event goes first because its banners are the ones
currently in `config/banners.yaml`; the group stage follows in Phase 6 and doubles
as the test that no emblem count is hardcoded. *Multi-tournament is a requirement*,
not a later nicety — see the phase 10 and freshness sections above.

**Still open.**

1. **Whose emblem inventory?** `banner/optimize` takes an inventory the user owns.
   Nothing in the engine models an inventory today — it is a pure client concept,
   so it lives in the querystring and never in Mongo.
2. **Run cadence.** Cron during an event, or manual publish? Decides only whether
   `publish.py` needs a scheduler.
3. **Group-stage banners for past events.** `config/banners.yaml` keeps the TI 2026
   group-stage emblems as a comment, not as data. Phase 6 needs them promoted to a
   real `stage:` block before that run can publish.
