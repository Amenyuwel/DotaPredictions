# Build Prompt — DotaPredictions Web Tool (final)

## What we're building

A free, no-login web tool for the Dota 2 compendium fantasy game. It answers two questions:

1. **Player → Banner.** User picks a player and the emblems they own. Tool returns the best war banner orderings for that player.
2. **Banner → Player.** User builds a war banner. Tool returns the players who score best with it.

Both answers must account for tournament context (how deep the team is expected to go), not just raw stats.

**It is not a TI 2026 tool.** TI 2026 is the first tournament it serves. Every tournament-specific fact — the team list, the rosters, the format, the scoring table, the rolled banners, the patch prior — is data scoped to a `tournamentId`, never a constant in code. A new event is onboarded by running a bootstrap script and publishing a run, not by editing source.

There is an existing Python engine (~13,100 lines) that already does the modeling: Bradley-Terry ratings, Swiss and bracket Monte Carlo, fitted corrections, banner scoring, fantasy projection, roster optimization. **Do not rewrite it in JavaScript.** It stays as-is and gains a small number of additive changes, enumerated at the end.

## Stack

- **MongoDB** (Atlas free tier is fine)
- **Express 5 + TypeScript** — compute server
- **React + Vite + TypeScript** — client
- **Python** — existing engine, batch only, never in the request path

No authentication. No user accounts. No sessions.

## Architecture

Three processes, two of which never talk to each other:

```
Python engine  ──writes──>  MongoDB  <──reads──  Express  <──HTTP──  React
   (batch, cron)              (snapshots)         (compute)          (client)
```

- Python runs on a schedule or by hand. It publishes an immutable, versioned snapshot ("run") to Mongo and exits.
- Express loads the current run into memory at boot and computes answers per request. It never calls Python.
- React is a static SPA served by Express in production.

Never spawn Python from Express. Never put pipeline execution in the request path.

## Repo layout — one monorepo

```
dotapredictions/
  engine/     # existing Python. Add scripts/publish.py, scripts/new_tournament.py
  server/     # Express + TypeScript
  client/     # React + Vite + TypeScript
  shared/     # run-schema.json — the contract
  docs/       # engine documentation, build plan
  docker-compose.yml
```

One repo, not three. `shared/run-schema.json` is written by Python, read by Express, and generates the client's types, so **a schema change must be one commit touching all three sides** — across separate repos that is three PRs and a window where writer and reader disagree, which is the exact failure this spec demands must crash rather than silently render wrong numbers. The parity checkpoint below is likewise a cross-language test, and the server ships the client as a single deploy artifact.

Moving the existing Python tree under `engine/` costs zero code changes: `dota/config.py` derives `ROOT` from `__file__` and every path hangs off it, and no module contains a literal relative path.

`shared/run-schema.json` is the single source of truth for the data contract. Python validates against it on write (`jsonschema`). TypeScript types are generated from it (`json-schema-to-typescript`).

---

## Tournament lifecycle — the anti-staleness requirement

The most expensive bug this project has already produced was a stale roster, and it produced no error. A team was configured under a dead org id, all sixteen of its games at the event landed on a name the model had never heard of, and it was rated off **no evidence at all** — while still printing a confident projection. It moved from "weakest team in the field" to "third strongest" once fixed.

So freshness is not a maintenance chore here. It is a correctness gate.

### Config is per tournament

```
engine/config/
  hero_adjectives.yaml          # global: Valve's hero appearance flags
  <tournamentId>/
    tournament.yaml             # format, stages, lock times, league ids, bracket
    teams.yaml                  # teams, five players each, roles, also_team_ids
    overrides.yaml              # pinned team_ids and account_ids
    scoring.yaml                # stat values, tiers, traits, coach titles
    banners.yaml                # the emblems rolled, per stage
    patch.yaml                  # gameplay patch prior
```

Only `hero_adjectives.yaml` is global — it is extracted from the game client, not from a tournament. Everything else is versioned per event, because Valve changes scoring values, emblem traits and formats between years.

### Onboarding a new tournament

```bash
python -m scripts.new_tournament --tournament ti2027 --league <mainEventLeagueId> \
       --qualifier-league <id> --qualifier-league <id> ...
```

The script scaffolds `engine/config/ti2027/` by **deriving rosters from match data**, not from a wiki table:

1. Pull the named leagues, collect every `team_id` that played.
2. For each team, take the five accounts that actually played its most recent games — this is what `scripts/discover_rosters.py` already does, and it cannot drift the way a scraped page does.
3. Resolve nicknames roster-scoped (team → `team_id` → that team's current members → match the nick inside those five). Never search a nickname globally: OpenDota's `personaname` is whatever a player last set on Steam, so a global lookup for `Suma1L` returns a different player's account.
4. Write `teams.yaml` and `overrides.yaml` with every id pinned, and copy the previous tournament's `scoring.yaml` as a starting point marked `verified_against_client: false`.

Then a human verifies roles (soft vs hard support is editorial — replay parsing cannot tell them apart) and re-checks the scoring table against the client's HOW TO PLAY.

`scripts/discover_rosters.py` currently hardcodes the TI 2026 qualifier league ids in a module constant (`QUALIFIER_LEAGUES`, lines 29–35). That constant moves into each tournament's `tournament.yaml` under `qualifier_leagues:`.

### Publish-time freshness gates

`publish.py` must **refuse to publish** — non-zero exit, nothing written, no partial run — when any of these fail. Each one is a bug that would otherwise ship as a confident wrong number:

| Gate | Catches |
|---|---|
| Every player resolves to an `account_id`; no fuzzy matches, no duplicates | wrong player's stats projected under the right nick |
| Every team's rating fit saw at least `--min-team-games` (default 8) result rows | the stale-org-id failure, where a team is rated on nothing |
| No configured team has zero sampled stat lines | a roster that changed after config was written |
| Roster drift: the five configured accounts match the five most-played accounts in that team's last N days | mid-season substitutions, role swaps, stand-ins |
| Orphan-id sweep: any `team_id` whose recent matches carry a name not in this tournament's config is reported as a candidate for `also_team_ids` | one org playing under two ids, which splits its evidence in half |
| Probability distributions sum to `1.0 ± 1e-9` | simulation or serialization corruption |
| `emblems.check_against_client` returns empty | a mis-transcribed emblem multiplier |
| Config `verified_against_client: true` | scoring values copied forward from last year and never re-checked |
| Every `hero_id` in the samples exists in `hero_adjectives.yaml` | a newly released hero silently paying no coach prefix |

`hero_adjectives.yaml` is extracted from `pak01_dir.vpk` and therefore needs Dota
installed. Regenerate it locally after a hero patch and commit the result; publish
must never depend on a game install being present on the machine that runs it.

Failures print what to pin and where. `--force` exists for the operator who has genuinely decided a warning is acceptable, and every forced gate is recorded on the run document so a bad number can be traced back to the override that allowed it.

### Deprecation is by scoping, never by deletion

Runs are immutable and scoped to `{tournamentId, stage}`. A new event never mutates an old one; it publishes alongside. `isCurrent` is scoped per tournament, not global. Old tournaments stay queryable and renderable — they are the archive, and they are also the only way to check whether last year's answer was any good.

The client picks a tournament; it defaults to the newest one with a current run.

---

## Both stages are first class

Fantasy resets per stage. TI 2026 ran two: a Group Stage (Swiss, 16 teams, 3 emblems per banner) and a Main Event (8 teams, double elimination, 5 emblems per banner). Each stage has its own roster, its own banner, its own roll tokens and its own answer.

Nothing in the tool may assume an emblem count, a team count, or a bracket shape. The engine already reads whatever the banner config holds; the server must do the same.

`stage` is part of the run key and part of every request:

- **Group stage** projections come from `dota/swiss.py:simulate` — Swiss with drop-out at 4, every series Bo3.
- **Main event** projections come from `dota/bracket.py:simulate` — the drawn bracket, Bo3 with a Bo5 Grand Final.

The two behave nothing alike and the difference is the interesting part. In the Swiss every team is guaranteed 4–6 series, so survival compresses to about **0.3%** of the projection and is nearly irrelevant. In the bracket a team plays 2 to 6 series and the Grand Final is a Bo5 — worth more than a Bo3 under a top-two-games rule — so bracket position genuinely moves the answer. The UI should not present these as the same question with different numbers.

A tournament may define any number of stages. `tournament.yaml` lists them in order; the publisher emits one set of projections per stage that has enough information to simulate.

---

## Data model

All model output is scoped to a `runId` and is immutable. Never update a projection — publish a new run.

### `runs`
```js
{
  _id, tournamentId, stage: "group" | "main", schemaVersion: 1, createdAt,
  engineVersion, configHash,
  params: {
    statHalfLife: 60,       // days, stat means AND bootstrap weights
    ratingHalfLife: 90,     // days, Bradley-Terry fit
    asOf,                   // the timestamp both decays are measured against
    l2Prior, patchStrength, sims
  },
  dataWindow: { from, to, matchCount },
  gatesForced: [],          // any freshness gate overridden with --force
  isCurrent: true           // scoped per {tournamentId, stage}
}
```

**There are two half-lives and they differ.** Stat means and the bootstrap decay at
60 days (`dota/fantasy.py`); ratings decay at 90 (`dota/ratings.py`). Both, plus the
`asOf` they are measured against, must be published — the server cannot reproduce
`recency_weights` from one of them, and getting it wrong fails parity silently
rather than loudly.

### `teams`
```js
{ teamId, alsoTeamIds: [], name, tag, region, logoUrl, tournamentId }
```
`teamId` unique per tournament. Always resolve by ID, never by name — rebrands, recycled ids and name reuse are all known, observed failure modes. `alsoTeamIds` is load-bearing: one org can carry two ids in one season, and folding them is the difference between sixteen games of evidence and none.

### `players`
```js
{ playerId, nick, teamId, tournamentId, fantasyRole: "core"|"mid"|"support", lane: "carry"|"mid"|"offlane"|"soft_support"|"hard_support" }
```
`fantasyRole` is the slot the client scores; `lane` is the finer role the engine assigns. Both are needed: core and support are **duos**, so the fantasy unit is a pair, not a player.

### `emblems`
The **full generatable catalog**, not one rolled banner. Users own their own emblems,
so the catalog is every combination the client can produce: each scorable stat ×
5 quality tiers × 5 traits, roughly 450 rows. Generate it from that tournament's
`scoring.yaml`. Do **not** generate it from `banners.yaml` — that file holds one
operator's rolled banner and is a fixture, not a catalog.

```js
{ emblemId, tournamentId, stage, stat, tier, trait, displayName, measurable }
```

`measurable: false` for stats with no field in the data at any depth, so the client
can mark them at build time instead of after computing a score of zero. No
`slotIndex` — position is a property of a request, not of an emblem.

**The multiplier is derived, never stored.** Vampiric pays itself +50% and charges each *adjacent* emblem −10%; Benevolent pays each adjacent emblem +20% and itself nothing; Fractal, Friendly and Unique are whole-banner conditions. So an emblem's displayed percentage is a function of tier + trait + **neighbours**, and storing it as a scalar would make all 120 orderings score identically and silently disable the ordering feature. Derive it exactly as `dota/emblems.py:multipliers` does, and port `check_against_client` as a publish assertion.

### `playerSamples`
The important one. Per-player, per-game stat samples, **after** the engine's factor stack (duration, opponent, league, hero) — publishing raw lines would make the server disagree with the engine.

```js
{
  runId, playerId,
  stats: ["kills","deaths", ...],   // column order
  games: <BSON Binary>,             // Float32, nGames x nStats, row-major
  nGames,
  matchId:          <Int32 array>,  // REQUIRED — see below
  heroId:           <Int32 array>,
  won:              <Uint8 array>,
  durationSeconds:  <Int32 array>,
  firstBloodTime:   <Int32 array>,  // negative = before the horn
  startTime:        <Int32 array>,  // unix seconds, for recency weights
  gameWeight:       <Float32 array>,// league + hero evidence weight
  sampleWarnings: ["n=54 joint games; ceiling likely understated"]
}
```

Two things about `sampleWarnings`. Count **joint** games for a duo, not per-player
games: role scores use only matches where both members appear, so a 90-game player
beside a 40-game partner gives the slot about 40, and a per-player `n` overstates
confidence on exactly the duos where it is weakest. And state the *direction* of the
thin-tail bias — the bootstrap can never draw above a player's observed maximum, so
under an `E[max]` objective a small sample has its ceiling truncated. It is biased
low, not merely uncertain, and "thin tail" alone does not say so.

`matchId` is not optional and there is no `seriesIndex`. Two reasons, both fatal if ignored:

- **Duo scores join on the match.** A role score is the average of the duo's members **in the same game**, using only matches where both appear — that keeps teammate correlation, since a stomp inflates everyone. Averaging two independently-drawn per-player distributions understates the spread of the pair. Without `matchId` the join is impossible and core and support scores come out wrong in a way that still looks plausible.
- **Series structure is simulated, not observed.** Historical games are a bootstrap *pool* with no series grouping. The schedule is drawn from the stage simulation, below.

The per-game scalars exist because coach Titles are **per-game conditions**, not season rates: the prefix keys on the hero played, `the Underdog` on a loss, `the Decisive` and `the Lucky` on match duration, `the Patient` and `the Flayed Twins Acolyte` on first-blood timing.

Index `{runId, playerId}` unique. Rough size: ~80 players × ~40–120 joint games × ~20 stats × 4 bytes — a few MB. Fits in memory trivially.

### `stageProjections`
Tournament context. This is what makes answers tournament-aware.
```js
{
  runId, teamId, stage,
  swiss:   { bucketProbs: {...}, advanceProb },      // stage === "group"
  bracket: { placementProbs: {...}, winProb },       // stage === "main"
  seriesSamples:  <BSON Binary>,   // Int8, nShapeSamples x maxSeries, 0-padded
  deciderSamples: <BSON Binary>,   // Uint8, same shape
  nSims,                           // simulations run
  nShapeSamples,                   // shapes kept -- both simulators cap at 4,000
  expectedSeries, eliminationRisk
}
```

`nSims` and `nShapeSamples` are different numbers and both are needed. Both
simulators keep `min(n_sims, 4000)` series shapes, so a run at `--sims 20000`
publishes 20,000 simulations' worth of probabilities beside 4,000 shapes. Collapse
them into one field and the run looks like it disagrees with itself.

`expectedSeries: 3.2` alone is **not sufficient** and the scalar must never be used to score. A scoring period sums the top two games *within* a series and then keeps the best series, and a game count cannot express that structure. The sampled per-series shapes are the input the scorer actually needs.

`deciderSamples` marks whether each series went the full distance, which is what `the Clutch` pays on. It cannot be recovered from the game count alone once a Bo5 exists, since a 3-game Bo5 is a sweep while a 3-game Bo3 is a decider.

### `factorAudit`
Measured effect of each modeling factor, including rejected ones and unmodelled ones.
```js
{ runId, factor: "coach_titles", kind: "data"|"assumption"|"absent",
  delta: 0.061, ciCrossesZero: false, verdict: "keep"|"reject"|"missing" }
```
Publish `absent` rows too. An effect the model does not capture should appear as a known hole, not as silence.

The raw OpenDota cache (~308 MB on disk) stays on disk. It does not go in Mongo.

---

## Scoring rules — read carefully

These are non-negotiable and are the reason a naive implementation will be wrong.

- The objective is **E[max]**: banner stats → role average → **top 2 games in a series** → **best series across the stage**. It is NOT mean × games played.
- Because of this, **variance is an asset** and total games played barely matters. You cannot compute this from per-player means. You must run over the actual sample matrix.
- Ranking players by average stats will systematically favor consistent players over volatile ones. That is the specific error this tool exists to avoid.
- **Only the banner's stats score.** A player's overall quality is close to irrelevant; they are worth exactly what their banner stats pay. Base values are wildly unequal (Creep Score 3 per unit, Roshan 1,172), so a raw rate is meaningless until multiplied through.
- **Core and support are duos sharing one banner.** The banner is fitted to the pair's combined line, and the slot score is the pair's average, so a duo whose strengths do not overlap is worth less than either player looks alone.
- **A banner may repeat a colour but never a stat.** This is the rule that breaks
  the obvious implementation. `dota/banner.py:best_banner` picks the best stat in
  *each colour* — one red, one blue, one green — which is right for choosing three
  emblems and wrong for everything else here. The TI 2026 Core banner is 3 red,
  2 green and **no blue**, and `best_banner` can never produce it. Score a
  user-supplied banner through the fixed path instead, which slots emblems by index
  rather than by colour (`scripts/fixed_banner.py:fixed_plan`).
- **The player → banner direction needs an engine function that does not exist yet.**
  "Best banner for this unit" is a constrained search: maximise over the emblems the
  user owns, subject to no repeated stat, colours unconstrained, `slots` from the
  request, with the 120-permutation ordering evaluated inside each candidate set.
  Write it in Python beside `best_banner`, then mirror it in TypeScript. Building it
  only on the server guarantees the two directions eventually disagree and gives the
  parity test nothing to check it against.
- Emblem ordering matters, and it is free. Evaluate orderings exhaustively (5! = 120).
- Coach Titles apply per game and stack multiplicatively (assumed — record it as an assumption).
- **Unmeasurable stats are excluded, not discounted.** Some emblems carry stats with no field in the data at any depth. They are worth real points in the client and zero in the model. Never quietly substitute a placeholder multiplier — surface it as a caveat that says the emblem scores 0 for every player and the ranking is therefore softer than it looks.

Always report a confidence interval alongside every score, and always return the top ~10 alternatives, not just the winner. If alternative #2 falls inside #1's interval, the UI must present them as tied rather than crowning a winner. **This is the common case, not an edge case:** on the TI 2026 Main Event banners no slot's first place is separated from its second.

---

## API

Every endpoint takes `tournamentId` and `stage`; both default to the newest tournament's current stage.

```
GET  /api/tournaments
     -> tournaments with a current run, newest first, each with its stages

GET  /api/run/current?tournamentId=&stage=
     -> run metadata, teams, players, emblem catalog, data window

POST /api/player/rank
     { tournamentId, stage, emblems: [{emblemId, order}], role?: "support" }
     -> ranking units for this banner, best first

POST /api/banner/optimize
     { tournamentId, stage, playerId | teamId+role, inventory: [emblemId], slots }
     -> best banner orderings for that unit

POST /api/roster/score
     { tournamentId, stage, core: teamId, mid: playerId, support: teamId, titles: [] }
     -> expected roster score + interval
```

`slots` comes from the request, not a constant — three emblems in a group stage, five in a main event.

The ranking unit for `core` and `support` is a **team's duo**, not a single player; only `mid` is one player. Return `{ teamId, role, players: [...] }` so the client can render both nicks.

Every response includes:
```js
{
  runId, tournamentId, stage, computedAt,
  best: { ..., score, ci: { lo, hi } },
  alternatives: [ ...next 9 ],
  tied: [ ... ],            // ids whose interval overlaps best's — render as a tie
  breakdown: { perStat: {...}, titleContribution, emblemOrder },
  tournamentContext: { expectedSeries, advanceProb, eliminationRisk },
  caveats: ["lotuses_grabbed has no data — scores 0 for every player", "n=54, thin tail"]
}
```

`caveats` is required, not optional. The engine documents its own limits; the tool must surface them to users who cannot audit the model themselves. Render them in the UI, not in a footnote.

Since there is no auth: rate limit by IP (60 req/min), set `Cache-Control: public, max-age=3600` on `/api/run/current`, and memoize POST responses in an LRU keyed on a hash of the request body plus `runId`.

---

## Frontend

Single page, two mirrored entry paths, one shared result panel:

- **"I have a player"** → player picker + owned-emblem picker → ranked banner orderings
- **"I have a banner"** → banner builder → ranked players/duos, filterable by role

Result panel shows: the top pick, the next nine with intervals, per-stat breakdown, tournament context, caveats. Overlapping intervals render as a tie — same visual weight, no crown.

Header always displays the tournament, the stage, the run timestamp and the data window. Users must be able to see what event they are looking at and how fresh it is without digging. A tournament/stage switcher lives there; past tournaments stay browsable.

Libraries: TanStack Query for data, TanStack Table for tables, Recharts for interval/breakdown charts. Debounce input at 250ms and POST on change.

The confidence interval needs a gamma sampler on whichever side computes it. The
engine's interval is a Bayesian bootstrap over `rng.dirichlet`, which Node has no
equivalent of — Marsaglia–Tsang is about thirty lines, but budget it as real work
rather than meeting it mid-phase.

**Assets and attribution.** Hero portraits and emblem art belong to Valve. Pull
images from OpenDota's CDN, credit OpenDota as the data source in the footer, and
avoid any framing that implies Valve endorsement.

### Saving results

Ship in this order:

1. **Shareable URL** — encode input state in the querystring (`?t=ti2026&s=main&p=1234&e=a,b,c,d,e`). No storage, no DB. Include tournament and stage or the link rots the moment a new event is published.
2. **Print stylesheet + `window.print()`** — uses the browser's own Save-as-PDF. Real vector text, zero dependencies.
3. `@react-pdf/renderer` only if a custom layout is genuinely needed.

Do not use html2canvas. It produces raster output with poor text quality and large files.

---

## Build order

Build vertical slices. Get one real number end to end before adding breadth.

1. **Restructure** into the monorepo layout. Pure `git mv`; no `.py` file may change.
2. Write `shared/run-schema.json`, including the `playerSamples` binary layout and the per-game scalar arrays. Version it.
3. Write `engine/scripts/publish.py` with every freshness gate above. Publish one real run for `{ti2026, main}`.
4. Express: load the current run into memory at boot, validate on read, crash on mismatch. Implement `/api/player/rank` only.
5. **Verify, in two halves.** This is the checkpoint that matters, and it cannot be
   one test: numpy's PCG64 has no JavaScript equivalent, so a Monte Carlo estimate
   will never match digit for digit and chasing that difference wastes days on a
   serialization bug that is not there.
   - **Exact, to 1e-9:** per-game banner score, emblem multipliers under every
     ordering, the duo's role average, and the coach-title multipliers. All are
     deterministic given the published sample matrix. **A mismatch here is a real
     serialization bug — stop and fix it.**
   - **Within tolerance, ≤0.25%:** the projection and its interval, with a fixed
     TypeScript seed and `n ≥ 20,000`. Widen the tolerance only with a measured
     reason, never to make a failing test pass.

   Commit both as golden-fixture tests.
6. Vite client: banner → player direction, one screen. This alone is a usable tool. Ship it.
7. Publish the `{ti2026, group}` run and add the stage switcher. This is the first real test that nothing hardcodes an emblem count or a bracket shape.
8. Add `/api/banner/optimize` and the player → banner direction.
9. Share URLs and print stylesheet.
10. Roster scorer, alternatives table, caveats panel.
11. `scripts/new_tournament.py` and the tournament switcher — validated by scaffolding a *past* event from its league ids and checking the derived roster against the config already in the repo.

---

## Engine changes

Additive and small. The modeling code does not change.

| Change | Where | Why |
|---|---|---|
| `Config` accepts a `tournament_id`; config files move under `config/<tournamentId>/` | `dota/config.py` | one deployment serves many events |
| Qualifier league ids move from a module constant into `tournament.yaml` | `scripts/discover_rosters.py:29` | the constant is TI 2026-specific and would silently serve the wrong leagues next year |
| Emit `decider_samples` beside `series_samples` | `dota/swiss.py` | the group stage needs the same scorer input the bracket already provides |
| New constrained banner search: maximise over an inventory, no repeated stat, `slots` variable | `dota/banner.py` | the player → banner direction has no function today, and `best_banner`'s one-per-colour rule cannot express a real banner |
| Warn on a `hero_id` present in the samples but missing from `hero_adjectives.yaml` | `dota/titles.py` / publish gate | `prefix_multiplier` returns 1.0 for an unknown hero, so a newly released hero silently under-prices every prefix with no error |
| `tournament.yaml` gains `stages:` and `qualifier_leagues:` | config | stages become data, not code paths |
| New `scripts/publish.py` | engine | snapshot writer plus every freshness gate |
| New `scripts/new_tournament.py` | engine | scaffold a new event from league ids and match data |
| Add `jsonschema`, `pymongo` | `requirements.txt` | validation and write path |

---

## Constraints

- Probabilities stay as doubles all the way through. Format only in React, never in the API or DB layer.
- Assert that probability distributions sum to 1.0 ± 1e-9 on publish. Fail loudly.
- Validate the run payload against `shared/run-schema.json` on both write (Python) and read (server). A schema mismatch must crash, not silently render wrong numbers.
- Team and player resolution is always by ID, always scoped to a tournament.
- Nothing hardcodes a team name, a league id, an emblem count, a stage count or a bracket shape. If a tournament fact appears in a `.py`, `.ts` or `.tsx` file, it is a bug.
- A run that fails a freshness gate does not publish. Stale data must fail loudly, because a stale roster produces a confident wrong answer and no error.
- In development, use the Vite dev-server proxy for `/api`. In production, serve `client/dist` from Express so there is one origin and no CORS configuration at all.
