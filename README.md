# DotaPredictions

Optimiser for the two things The International 2026 compendium asks you to fill
in: the **Predictions** grid and the **Fantasy** roster.

Both are driven by one Monte Carlo simulation of the Swiss group stage, because
both questions reduce to the same unknown — how far each team goes.

## The idea

**Predictions.** The grid has 16 slots in six buckets (1× 4-0, 2× 4-1, 5×
elimination-round winner, 5× elimination-round loser, 2× 1-4, 1× 0-4) and each
team fills exactly one. That is a *linear assignment problem*, not sixteen
independent guesses. Filling each row with its most likely team — the obvious
approach — is measurably worse, because the same team is the best answer for
several rows and can only be spent once. Solved optimally with the Hungarian
algorithm; on the current model this is worth about **+0.33 expected correct
picks** over greedy, for free.

`--variants N` also prints the next N−1 best *whole grids* via Murty's
algorithm, reported as swaps against the optimum. One catch worth knowing about:
the five Elimination Round Winner rows are the same question five times, so
constraints have to be applied per *bucket*, not per slot. Constrain per slot
and you enumerate 1!×2!×5!×5!×2!×1! = **57,600 reorderings of grid #1** before
reaching a genuinely different answer.

**Fantasy.** TI 2026 scores each player by their **single best game** of the
phase, not the sum. So the objective is

> `projected = E[ max over N games ]`, **not** `mean × N`

Three consequences that invert normal fantasy intuition:

* **Variance is an asset.** Two players with the same average are not
  equivalent — only the ceiling is ever recorded, so the one with the fatter
  right tail wins. A metronome support with SD 2.9 is a liability.
* **Games played barely matters.** Going 13 → 16 games is worth about **+7%**
  at the maximum, not +23% as it would be under a sum. The Swiss simulation
  still feeds in, but it no longer dominates.
* **Roster choice matters less overall.** Ceilings compress: the top 15 rosters
  span about 3%. The gap that remains is between good and bad rosters, not
  among good ones.

**The period is one stage, not the whole event.** TI fantasy runs per stage: you
build a Group Stage roster locking Aug 13, it scores only Group Stage series, and
you build a fresh Main Event roster from the eight survivors afterwards — each
stage grants its own 40 reroll tokens, its own banner, and its own answer.

Both stages are modelled, by two different simulators, because the two formats
behave nothing alike:

| | Group Stage (`dota/swiss.py`) | Main Event (`dota/bracket.py`) |
|---|---|---|
| Field | 16 teams, Swiss, drop-out at 4 | the 8 survivors, double elimination |
| Seeding | not public, so round one is random | already drawn, so transcribed |
| Series per team | 4–6, guaranteed | 2–6, earned |
| Formats | every series Bo3 | Bo3, except a Bo5 Grand Final |
| Does survival matter? | barely — see below | yes |

The Main Event inverts the group-stage conclusion. In the Swiss, a drop-out
format guarantees every
team 4-6 series whatever happens: a 0-4 team still plays four. Expected series
runs 5.32 to 5.62 across the field, and under an `E[max]` objective that 6%
spread compresses to about **0.3%** on the projection. Scoring one duo's stat
lines against another team's schedule moves the answer by less than half a
percent.

It is in fact mildly *inverted*: Team Yandex advances 85% but plays only 5.39
series, while LGD Gaming advances 68% and plays 5.57, because strong teams reach
4-0 early and skip the elimination round entirely. "Good team, more games" is
backwards inside the Swiss.

In the bracket none of that holds. A team can be knocked out in two series or
run the lower bracket for six, the tree is already drawn so there is no averaging
over seedings, and the Grand Final is a **Bo5** — which is worth more than a Bo3
under a top-two-games rule, because the top two of five draws beats the top two
of three. Deep runs are paid for twice, in series count and in series length, so
`scripts/main_event.py` weights the projection by where a team is likely to land.

### Four corrections the group-stage path did not make

`scripts/main_event.py` applies these, and its ablation table prints what each one
was worth rather than asserting it mattered. Measured on the eight survivors:

| Correction | Why it was wrong | Worth |
|---|---|---|
| **Coach Titles** | Cerulean and the Clutch are equipped and were priced at zero | **+4 to +8%** |
| **Expected game length** | lines are normalised to 40 minutes; TI runs 45 | **+1% core, +7 to +9% mid/support** |
| **Expected opponent** | normalised to a 16-team average; the field is now the 8 best | small, negative |
| **Recency in the bootstrap** | a February game was drawn as often as a group-stage game | **±0.3%, i.e. nothing** |

### Choosing the Title pair

`scripts/titles.py` evaluates the whole 8 × 8 grid against a specific roster, with
every rate **measured on that roster's own games** rather than read from the static
table. Three results that the printed bonuses do not predict:

* **The biggest bonus is usually the wrong prefix.** Prefixes key on hero
  appearance, so their worth is the share of *these players'* games on a tagged
  hero. Cerulean is the largest at +11% but fires on only 16% of this roster's
  games; Heroic at +9% fires on 22%. The whole top five sit within 0.25% of each
  other, which is far inside the sampling band — the prefix is close to a free
  choice, and worth no agonising.
* **`the Clutch` is the clear suffix**, +3.9% against +3.1% for `the Lucky` and
  under +1.5% for everything else.
* **Two suffixes are traps that a rate calculation cannot spot.** `the Underdog`
  fires on 34.8% of games — the highest rate on the list — and is worth only +1.4%,
  because it pays on losses and only your *best* series is ever counted.
  `the Decisive` advertises +24% and delivers +0.9%: sub-25-minute games are 1.8% of
  the sample and they suppress every cumulative stat on the banner.
* **One config value was simply wrong.** `the Flayed Twins Acolyte` was recorded at
  `p: 0.0` ("zero occurrences in 833 sampled matches"). First blood *before the
  horn* shows up in the objectives log as a **negative** timestamp, so the earlier
  measurement had looked for it in the wrong place; the real rate is **9.9%**, worth
  +1.4%. Not enough to change the pick, but it was not zero.

Two things about Titles are worth stating plainly because they are the opposite of
what you would guess:

* **Coach Titles are the largest single term, and they are free.** They cost no
  roll tokens and are conditional per *game*, so they must be applied per game.
  `the Clutch` fires on the last possible game of a series, which under a
  top-two-games rule is also a game that is *more likely to be counted* — placed
  properly it is worth **+3.6%**, against the **+3.1%** the old flat
  `bonus x P(decider)` estimate assumed. `Cerulean` keys on the hero being blue,
  and blue share varies enormously by player: 33% of Nisha's sampled games, 1% of
  Nigma's core duo. A season-average rate would have erased exactly that.
* **Recency weighting changed almost nothing**, which is worth knowing precisely
  because it looked like the obvious fix. The stat *means* were always decayed;
  only the bootstrap was flat. Adding it moves projections by ±0.3% — form over
  six months is stable enough here that the flat draw was not the problem.

### Head-to-head records predict worse than ratings do

`ratings.py` pools every result into one strength number per team, so a matchup is
predicted transitively — through common opponents — and a pair that has never met is
priced as easily as one that has. That is an assumption worth testing rather than
defending, especially since **4 of the 28 pairs in this bracket never met** in the last six
months, two of them plausible upper-bracket matches (Iron Wing vs PARIVISION, PARIVISION vs
Yandex).

`dota/h2h.py` supplies the alternative: a pairwise record folded in by shrinkage,
`p = (weighted wins by A + k · p_rating) / (weighted meetings + k)`, with `k` a prior in
pseudo-games. `scripts/validate_h2h.py` then walks forward through the corpus in six time
slices, fitting on everything before each slice and scoring the games inside it — 298
games the fit never saw, 187 of them between pairs with a prior record.

| Head-to-head weight | Log-loss | vs baseline | Correct |
|---|---|---|---|
| **off (rating only)** | **0.6667** | — | 57.4% |
| prior of 40 pseudo-games | 0.6682 | +0.0015 | 57.4% |
| prior of 20 | 0.6699 | +0.0032 | 57.4% |
| prior of 10 | 0.6736 | +0.0069 | 56.0% |
| prior of 5 | 0.6815 | +0.0148 | 55.7% |
| prior of 2 | 0.7043 | +0.0377 | 56.7% |
| head-to-head only | 1.7053 | +1.0386 | 56.0% |

Monotone, and in the wrong direction: every weight is worse than switching the term off,
and trusting the record alone is worse than a coin flip (log-loss 0.693). Head-to-head is
not carrying signal here, it is carrying variance — a 2-0 record over a six-month window
is two games.

It is worth being precise about *why*, because "we used head-to-head" sounds strictly more
informed than not using it. A pairwise record adds a free parameter per pair and will
always fit the past better; measured on unseen games it loses, because the same results
are already in the ratings, where they are pooled with every other result rather than
sliced into buckets of two or three. The user's own example makes the case: Falcons and
Liquid have met 15 times and split them 8-7, so the record says "even" while the ratings
say Falcons by a little — and blending the record in moves the number from 56.6% to 55.6%,
a change with no predictive value behind it.

The module stays in the tree with its validation, because a negative result that took real
work is worth keeping next to the thing it rules out.

### The draft is modelled, and it changes nothing

`dota/draft.py` reads `picks_bans` from the cached replays — 23,832 draft actions over
993 matches, all 109 at TI included — and estimates, per hero, the chance an opponent
bans it or takes it first. Rates are per *team*, shrunk toward the field's contest rate
with a 20-pseudo-match prior, then weighted by each team's expected bracket opponents.
Availability multiplies into the bootstrap weights and into the coach-prefix firing
rates.

TI's ban phase is brutal at the hero level: Treant Protector banned in **93%** of
matches, Keeper of the Light 70%, Largo 58%, Lina 57%. The effect on a fantasy
projection is **+0.14%** on the roster total, fitted on TI's own games.

That null result is the correct answer rather than a failure to find a signal.
Availability is a near-uniform discount across a player's whole pool — most heroes sit
between 60% and 90% — and the bootstrap normalises its weights, so a uniform factor
cancels exactly. Only relative contest levels survive, and a player's contested heroes
are not systematically his high- or low-scoring ones. It does settle one open question:
bans do **not** void a coach prefix. Weighting by availability moves Cerulean's rate
*up*, 17.3% → 18.2%.

### Elimination risk is smaller than it feels

The natural fear — "I picked a player, his team goes out, my slot is dead" — is
built on a premise the rules do not support. A period keeps the **best series** a
role played, so a team knocked out after two series still scores its better one.
You lose *chances at a good series*, not the points.

`scripts/elimination_risk.py` prices it off the drawn bracket. Across all eight
teams and all three slots, being gone after two series costs between **−2.9% and
−7.1%** of the slot's projection. Two consequences:

* **Bracket seeding is a weak input to a fantasy pick.** PARIVISION are the safest
  team in the field (13% chance of exiting in two series) and Iron Wing the most fragile
  (40%) — a 3× difference in survival that moves the projections by about 1%.
* **Downside is driven by a player's floor, not by his team's odds.** Nisha has the
  worst bracket path of any leading mid and the *best* p10 in the slot, because his
  per-game distribution has the highest floor. A consistent player on a doomed team
  beats a spiky player on a safe one, under a rule that keeps only your best series.

Roster totals are sampled with the three slots **joined on the same simulated
bracket**, since your picks sit in one tree and two of them can meet. That leaves the
mean alone and widens the spread, which is the part a risk question is about.

### Picks that fight each other cost nothing

`scripts/roster_conflict.py` reconstructs, per simulated bracket, exactly who played
whom, and prices the collision. On the locked roster PARIVISION and Team Spirit meet
**59.1%** of the time — most often in UB R2 (34.0%), where the loser drops to the
lower bracket rather than going out. The result is not a small penalty; it is *no*
penalty:

| | Mean | Meets the other pick | Loses that match | Knocked out by it |
|---|---|---|---|---|
| Core PARIVISION | 17,689 | +0.4% | −0.7% | −1.1% |
| Mid Team Liquid | 20,080 | +1.6% | +0.9% | +0.8% |
| Support Team Spirit | 15,379 | +0.7% | −0.3% | −0.8% |

Conditioning on a meeting is *slightly positive*, which is a selection effect and not
a paradox: two of your teams can only meet if both got far enough to meet, and a
deeper run is more series. Across the roster total, collisions move the mean by
**0.00%** — expectation is linear, so who your picks play cannot change what they
score on average — and the spread by **+0.9%**. Avoiding same-half picks is not worth
one point of projection.

### The projection carries an error bar, and it is wider than the gaps

A duo with 40 observed games and one with 112 are not the same claim. Every
projection is reported with a 90% band from a Bayesian bootstrap over the observed
games, and on the current banners **no slot's first place is separated from its
second**: core #1 leads by 45 points against a 737-point joint sampling error, mid
by 146 against 580, support by 280 against 565. The top seven whole rosters span
0.4%. Treat the ranking as a tie-break, not a verdict — and note that the interval
covers sampling error only, not the model risks listed at the end of this file.

Two statistical traps this is built to avoid, both of which produce confident
nonsense:

1. **Sample-size bias.** Ranking by *best observed game* is invalid — the max of
   58 draws beats the max of 6 from an identical distribution, so historical
   sample count masquerades as skill. Instead we fit a per-game score
   *distribution* and simulate the max over projected TI games. Sample size then
   affects only confidence in the fit (via shrinkage), never the projection.
   `tests/test_fantasy.py::test_no_sample_size_bias` pins this down.
2. **Disaster games inflating ceilings.** A maximum depends only on the right
   tail, but a full-sample variance is driven just as hard by the left one. Fit
   naively, shiro's log-sigma is 0.656 across all games versus 0.335 from the
   upper tail alone — and the projection claimed a best game of **38.8** when his
   actual best in 41 games was **26.7**. Being blown out in lane does not make
   your best game better. So sigma is estimated from observations at or above
   the median, anchored on the median rather than the mean.

## Setup

The Python engine lives in `engine/`. Every command below runs from there.

```bash
python -m venv .venv
.venv\Scripts\pip install -r engine/requirements.txt   # PowerShell
cd engine
```

Optional, for faster refreshes — free key from https://stratz.com/api:

```
# .env
STRATZ_API_TOKEN=ey...
OPENDOTA_API_KEY=...     # also optional, raises the rate limit
```

Neither is required. OpenDota works keyless and pro-league matches are fully
parsed there, so every stat the scoring config uses is available either way.

## Use

```bash
python -m scripts.resolve_ids       # map config names -> OpenDota IDs (run first)
python -m scripts.run               # fetch, simulate, and print both answers
python -m scripts.run --only fantasy --sims 50000
python -m scripts.discover_rosters  # rebuild the team list from match data
python -m tests.test_swiss          # structural checks on the simulator
```

Once the banners are rolled and the group stage is over, the question is no
longer "which banner should I aim for" but "who stands behind the banner I have":

```bash
python -m scripts.fixed_banner      # score all 16 teams against config/banners.yaml
python -m scripts.main_event        # the same, restricted to the 8 survivors,
                                    # over the drawn bracket, plus a reroll audit
python -m scripts.predict_bracket   # fill in the bracket, six months of evidence
python -m scripts.bracket_outcomes  # all 16,384 outcomes, exactly, fitted on
                                    # this TI's own games; scores your submitted
                                    # bracket against every one of them
python -m tests.test_bracket        # structural checks on the bracket
```

`bracket_outcomes` differs from `predict_bracket` in both halves of the job. It
fits on one league — TI 2026 itself — instead of six months of pro Dota, and it
enumerates the tree exactly instead of sampling it. Fourteen binary matches is
2^14 = 16,384 outcomes, small enough to write down in full, so placements,
perfect-bracket odds and the score of a filled-in bracket come out with no
simulation error at all. `--all-history` runs the same enumeration on the wider
corpus, which is the honest way to see how much of an answer is the evidence and
how much is the method. `--h2h-k` blends each pair's own record into its rating,
for checking what a head-to-head view would do to the bracket — it is off by
default because it scores worse out of sample, and `scripts.validate_h2h
--offline` is the check that says so. The bracket you actually submitted lives in
`config/tournament.yaml` under `main_event.my_picks`.

### When the roll tokens are gone

The stats on the banner are then final, and exactly three levers remain. Ranked by
what they are actually worth on a locked roster, which is *not* the order anyone
guesses:

```bash
python -m scripts.titles            # pick the coach Title pair: +6.1% over none
python -m scripts.emblem_order      # rearrange emblems: +1.8% -- only if your
                                    # client lets you move them
python -m scripts.elimination_risk  # what an early exit costs each slot
python -m scripts.roster_conflict   # collisions between your own picks
python -m scripts.draft             # pick/ban availability, and what it is worth
python -m scripts.validate_h2h --offline   # does head-to-head beat the ratings? (no)
```

| Lever | Worth | Cost |
|---|---|---|
| **Coach Titles**, correctly chosen | **+6.1%** over running none | free |
| **Emblem order** | **+1.8%** | free |
| Swapping to the top-ranked players | 1.3%, *inside* the error bars | your picks |

**Emblem order matters because two traits are positional.** Vampiric pays itself
+50% and charges each *neighbour* −10%; Benevolent pays each neighbour +20% and
itself nothing. So a Vampiric emblem wants the cheapest neighbours available —
usually an end of the banner, where it has one neighbour instead of two — and a
Benevolent emblem wants the most expensive. "Cheapest" is in points *this roster*
produces, so it is a per-roster answer. `dota/emblems.py` derives every displayed
percentage from tier + trait + neighbours, and `tests/test_emblems.py` demands
agreement with all fifteen values transcribed from the client — which is what makes
the optimiser's arithmetic trustworthy, and which pins two things that look like
client bugs and are not:

* a **Fractal emblem showing −10%** is Fractal *not firing* (0%) plus a Vampiric
  neighbour charging it,
* a **Fractal showing +20%** is a Benevolent neighbour paying it.

Fractal, Friendly and Unique are whole-banner conditions and no rearrangement can
help them. On these banners Fractal is dead in all three slots (it needs every
quality to differ; Core has three Tier IIs), which is worth +60% on two emblems to
anyone with a spare emblem of another tier in inventory.

First run pulls ~400 match details at the keyless rate limit and takes several
minutes. Everything is cached under `data/cache/`, so later runs are fast.

Useful knobs:

| Flag | Does |
|---|---|
| `--sims` | Monte Carlo iterations (default 20,000) |
| `--history-days` | how far back to pull results (default 180) |
| `--detail-matches` | how many TI-team matches to pull stat lines for (default 400). The main lever on thin-sample teams — a fresh qualifier squad can sit at 6 sampled matches at the default, which is not enough to bootstrap a ceiling from |
| `--half-life` | recency half-life in days for team ratings (default 90) |
| `--prior-strength` | shrinkage toward field average; raise it if qualifier-only teams look too strong |
| `--elim-pairing` | `seeded` or `random` bracket for the elimination round |
| `--variants` | prediction grids to print, and rosters to print banners for (default 5) |
| `--patch-strength` | scale the patch layer; `0` applies nothing but still reports what it would have done |
| `--no-patch` | ignore `config/patch.yaml` entirely |

## The patch layer

Ratings and stat profiles are fit on ~6 months of results. When a balance patch
lands days before the event there is no post-patch data to fit on — 7.41e
shipped 2026-07-30, fourteen days before the lock — so the choice is between
pretending nothing changed and stating an assumption out loud.
`config/patch.yaml` is the second option: per-role multipliers on individual
stats, optional additive team rating deltas, one `strength` dial, and a comment
on every line naming the change it comes from. What was applied is echoed into
the warning panel and into `out/analysis.json` under `patch`, so a locked pick
can always be traced back to what was assumed when it was made.

Multipliers are applied to the raw per-game stat lines rather than to the
computed means. `weighted_stat_means` decides which emblem wins a colour, but
`role_game_scores` re-scores every observed game under that banner and sets the
right-tail sigma the projection depends on; scaling only the means would move
the emblem choice while leaving the score distribution alone, and the two would
silently disagree.

Run with `--patch-strength 0` to see exactly what the layer moved. For 7.41e the
honest answer is *very little*: the patch mostly hits kills and tower damage,
and the banners this model selects are built on Deaths / Creep Score, Wards /
Runes / Camps, and Teamfight Participation.

## The scoring values are verified — don't re-screenshot them

`docs/ti2026-how-to-play.md` is the client's HOW TO PLAY transcribed in full: all
18 base stat values, the stat→colour table, quality tiers I–V, the five traits and
the exact scoring chain. `config/scoring.yaml` is cross-checked against it and
carries `verified_against_client: true`. Correct the doc if Valve changes a
number; do not go back to the client for something already written down.

Two mechanics recorded there that drive `scripts/main_event.py`'s reroll audit:
an emblem's **stat is rerollable and a reroll is guaranteed to change it**, and a
banner may repeat a *colour* but **never a stat**. So a dead emblem is always
fixable, and its cost is what the same multiplier would pay on the best stat left
in its colour.

Relative rankings are fairly robust to the exact multipliers; absolute
projections are not.

`config/tournament.yaml` likewise assumes each prediction bucket is worth the
same. If HOW TO PLAY shows otherwise, edit `points:` per bucket — the optimiser
maximises expected *points*, not raw hit count, so uneven weights change the
answer.

## Teams and the naming trap

The 16 teams are in `config/teams.yaml`; their OpenDota IDs are pinned in
`config/overrides.yaml`. The pins are not paranoia — automatic name lookup gets
this wrong in three different ways:

* **Rebrands.** BetBoom competes as `BoomBoys`, Iron Wing spent the season as
  `1w`, PARIVISION as
  `TEAM VISION`, L1GA as `HULIGANI`.
* **Recycled team IDs.** "Aurora Gaming" and "Nigma Galaxy" each map to several
  `team_id`s from different eras, most carrying a dead roster.
* **Name reuse.** The LGD Gaming at TI 2026 is the South American squad
  (ex-HEROIC), not Chinese PSG.LGD.
* **A second banner for the same five players.** **Iron Wing** (`10150413`) are
  the TI 2026 entry; the same roster spent the qualifier season on the `1w` id
  (`10182357`). A pinned id is not enough here, because the pin is one id and
  the org carries two. Extra ids go in `also_team_ids` in `config/teams.yaml`
  and are folded in by `pipeline.canonicalise`. Get this wrong — as the config
  did until 2026-08-18, where the team was named `1win` and pinned to the
  season id — and all sixteen of their TI games vanish from the rating fit,
  leaving the model to price them as a team with no evidence at all.

Player names are worse. OpenDota's `personaname` is whatever a player last set
on Steam, so a global search for `Suma1L` returns **Ammar's** account. That is
why resolution is roster-scoped: team → `team_id` → that team's five current
members → match the nickname inside those five. Matching a nick against five
teammates is safe; matching it against 5,000 pros is not.

A wrong `account_id` does not raise an error. It produces a confident,
completely wrong projection. `scripts.resolve_ids` refuses to guess and tells
you what to pin.

## Layout

The repo is a monorepo: `engine/` is this Python model, `server/` and `client/`
are the web tool built on top of it, and `shared/` holds the data contract
between them. See `docs/web-tool-build-plan.md`.

```
engine/
config/
  teams.yaml         16 teams, five players each, with roles
  overrides.yaml     pinned team_ids and account_ids
  scoring.yaml       fantasy point values  <- verify against the client
  tournament.yaml    format, buckets, lock time, the drawn Main Event bracket
  banners.yaml       the emblems you rolled: stat, tier, trait and POSITION
  patch.yaml         gameplay-patch prior  <- hand-entered, one comment per line
  hero_adjectives.yaml  hero -> Valve appearance flags, for coach Title prefixes
docs/
  ti2026-how-to-play.md  the client's HOW TO PLAY, transcribed. The reference.
dota/
  sources/           OpenDota + STRATZ adapters behind one interface
  resolve.py         roster-scoped name -> ID resolution
  ratings.py         Bradley-Terry MLE, recency weighted, L2 shrinkage
  swiss.py           Monte Carlo of the 16-team drop-out Swiss
  bracket.py         Monte Carlo of the 8-team Main Event double elimination
  draft.py           pick/ban availability per hero, per opponent
  h2h.py             pairwise records + the validation that rejects them
  emblems.py         banner arithmetic incl. positional traits, order optimiser
  titles.py          coach Title conditions, applied per game
  fantasy.py         per-player projection
  patch.py           applies config/patch.yaml to stat lines and ratings
  optimize.py        Hungarian + Murty k-best, exhaustive roster search
  pipeline.py        wires it together
  report.py          terminal tables
scripts/             CLI entry points
tests/               structural checks
out/analysis.json    full numeric output of the last run
```

## What limits the accuracy

Everything below degrades the answer. They are grouped by *kind*, because the
kinds behave differently: measurement error can be fixed, definition risk can only
be verified against the client, and sampling error can only be reported.

### 1. Definition risk — the model may be scoring the wrong quantity

Worse than noise, because it is silent, systematic, and no interval covers it.

* **`teamfight_participation` is assumed linear.** The client says "max 2,124
  points for participating in team fights"; the model pays `2,124 x fraction`.
  If the real curve is stepped or thresholded, this is wrong — and it is the
  single largest term on the support banner (~2,500 of ~8,900 per game) and a
  large one on mid. A wrong functional form here outweighs every ranking gap.
* **`seconds_stunned` may not mean stun-seconds.** OpenDota's `stuns` is the
  duration of *disables* the player applied. If the client counts hard stuns only,
  the support banner's x2.50 emblem is overstated, and overstated most for the
  duos whose heroes root and slow rather than stun.
* **`madstone_collected` is a proxy.** `item_uses.madstone_bundle` counts bundles
  consumed. If a bundle carries more than one madstone, every madstone emblem is
  understated — a floor, not an estimate.
* **Tormentor attribution.** Read from `killed["npc_dota_miniboss"]`, i.e. kill
  credit. Some Tormentor kills appear in the objectives log with `slot: -1` and no
  player attached; those become zeros for everyone, so the stat is mildly
  understated.
* **Coach Title stacking is assumed multiplicative.** Cerulean and the Clutch are
  applied as `x1.11 * x1.16` on a game that satisfies both. If the client adds
  them instead (`x1.27`), affected games are ~1.4% high.
* **Emblem percentages are transcribed by hand.** `config/banners.yaml` is a
  screenshot read by a human. One mistyped multiplier moves everything downstream,
  and Vampiric/Benevolent are *positional* — reordering emblems in the client
  silently invalidates the file.

### 2. Unmeasurable — stats with no data at all

* **`lotuses_grabbed` and `watchers_taken` have no OpenDota field at any depth.**
  A banner emblem carrying one scores **0 for every team**, so it cannot separate
  them, yet it is not worth 0 in the client. The Main Event support banner carries
  Lotuses at x1.20; that is real points the model cannot see, and it is the reason
  the support ordering should be treated as softer than the numbers suggest.
  A STRATZ token might close this; OpenDota cannot.

### 3. Sampling error — reported, not eliminated

* **The pool is 40 to 112 games.** Every projection carries a 90% Bayesian
  bootstrap band, and on the current banners no slot's #1 is separated from its
  #2. Rankings inside a band are tie-breaks, not findings.
* **Thin samples cannot show a tail.** The bootstrap can never draw above the
  observed maximum, so a 40-game duo (Nigma's cores) has its *ceiling* truncated
  under an E[max] objective — biased low, not just uncertain. No shrinkage toward
  the field distribution is applied.
* **Games within a series are drawn independently.** Real games in a series share
  an opponent, a draft and a scoreline; correlation changes the distribution of a
  top-two sum. A block bootstrap over real series would fix this and is not done.
* **Duo joint-game requirement.** Only matches where *both* duo members appear are
  used, which is correct for teammate correlation but shrinks the sample further.
* **Monte Carlo noise** on top: 20,000 bracket sims and 8,000 period draws leave
  a few tenths of a percent, well inside the sampling band.

### 4. Fitted-correction error

* **Elasticities and slopes are pooled, not per role.** One `creep_score`
  elasticity (+1.24) is fitted across carries and supports alike.
* **Two opponent slopes come out the wrong sign** (`roshan_kills` +0.030,
  `madstone_collected` +0.018 — stronger opposition should not *help*). They are
  clamped in magnitude but not sign-constrained, so sparse stats can pick up noise.
* **The restatement targets are themselves estimates.** 45.0 minutes is the median
  of 109 group-stage games; expected opponent rating comes from the bracket sim,
  which comes from Bradley-Terry ratings.
* **Corrections are applied in sequence**, so each later fit sees the previous
  one's residuals. Order matters and is asserted, not proven.

### 5. What the simulation cannot know

* **Draft and matchup effects.** Teams are one strength number: no hero pools, no
  head-to-head styles, no bans. A duo whose signature hero gets banned in every
  game of the Main Event is projected as if it did not happen.
* **Games are independent within a series.** No momentum, no side selection, no
  in-series adaptation — all of which are real in a Bo3.
* **Meta and patch drift.** The patch layer is a hand-entered prior on stat rates;
  it knows nothing about drafts. A balance patch landing mid-event is unmodelled.
* **LAN, stakes and pacing.** The Main Event is a different environment from the
  online games that dominate the corpus.
* **Roster and lineup risk.** Stand-ins, illness, visa problems, or a role swap
  inside a team all invalidate a slot. Re-run `scripts.resolve_ids` near the lock.
* **Forfeits and technical losses** are not simulated.
* **Correlation between your slots.** Expected totals add correctly, but two slots
  from the same team share a fate. For a top-100 push, variance is an asset and the
  optimiser will not suggest a contrarian roster; for a good average, it is right.

### 6. Scope — real points the model does not optimise

* **Emblem inventory.** The Fractal condition is failing in all three slots —
  it pays +60% only when *every* emblem quality on the banner differs, and Core
  carries three Tier IIs. Quality cannot be rerolled, but swapping in an emblem of
  another tier from inventory would flip two emblems from −10% to +60%. The model
  cannot see your inventory, so it cannot suggest which.
* **Emblem ordering is optimised, exhaustively, but only within one banner.**
  `dota/emblems.py` enumerates all 120 arrangements per slot. It assumes adjacency
  means *linear* neighbours as the client draws the banner top-to-bottom; if the
  layout is a ring, position 1 and position 5 are also neighbours and the optimum
  changes. Verify against the percentages the client shows after rearranging —
  they are the ground truth, and `check_against_client` will catch a disagreement.
* **Reroll strategy.** `--reroll` prices a *specified* swap and the audit ranks
  single swaps by mean points; neither searches sequences of rolls, and neither
  knows how many tokens you have left.
* **Title rerolls.** The dialog offers 8 prefixes of 18 and 8 suffixes of 21, and
  a reroll can surface titles you have not seen. `Bestial` and `Hirsute` fire on
  30% and 12% of this roster's games but carry no bonus in `scoring.yaml`, so they
  cannot be priced until the client shows one.
* **Prediction-grid points.** `config/tournament.yaml` assumes every bucket is
  worth the same.

Treat the output as a well-calibrated starting point, not an oracle.
