# Code principles

SOLID, YAGNI, KISS, DRY - stated here as they apply to *this* codebase, with the
existing code that already follows them. A principle with no example is a slogan,
so every rule below names a file.

Paths are written relative to their own tree: engine files (`ratings.py`,
`config/*.yaml`, `tests/`) live under `engine/`, and the web tool under `server/`,
`client/` and `shared/`.

The project has one property that shapes all four: **a wrong number does not
raise.** A bad `account_id`, a mistyped multiplier or an unmodelled condition
produces a confident, completely wrong projection. So the principles are applied
in service of one goal - making a wrong answer *loud* - and any reading of them
that hides a mistake is the wrong reading.

---

## SOLID

### Single responsibility
One module answers one question, and the question is in its docstring.
`ratings.py` turns results into strengths. `swiss.py` turns strengths into bucket
probabilities. `fantasy.py` turns stat lines into `E[best series]`. `optimize.py`
turns probabilities into picks. `report.py` prints. None of them fetch, and only
`pipeline.py` knows the order.

Keep it that way: if a change needs a module to know about a second stage of the
pipeline, the wiring belongs in `pipeline.py`, not in the module.

### Open/closed
`sources/base.py` defines `MatchResult`, `PlayerGame` and the `Source` protocol.
STRATZ was added behind it without touching `pipeline.analyse` - the corpus
builder asks `stratz.available()` and falls through. A third source should cost
one file in `sources/` and nothing else.

### Liskov
Any `Source` must be substitutable, including in failure. `Stratz.available()`
returns `False` with no token and the bulk fetch is wrapped so an exception
degrades to OpenDota with a note in `corpus.source_notes` - it never fails the
run. A source that raises where another returns empty is not substitutable.

### Interface segregation
The `Source` protocol carries five methods, not everything OpenDota can do.
Endpoints only one caller needs (`_teams`, `_pro_players`, `heroes`,
`league_matches`) stay off the protocol.

### Dependency inversion
Nothing above `sources/` sees OpenDota JSON. Field translation happens once at
the boundary - `FIELD_MAP` in `sources/opendota.py`, `STAT_SOURCE` in
`banner.py` - and every model works in canonical stat keys. Keep new API fields
behind that line.

---

## DRY

**One translation map, one fitted coefficient, one place.**

* `patch.source_field_multipliers` reuses `STAT_SOURCE` rather than keeping a
  second scoring-stat-to-OpenDota map, because two copies drift and the drift is
  silent.
* `main_event.Fit.from_reports` recovers the duration elasticity and opponent
  slope from the pipeline's own audit trail instead of refitting them. Refitting
  would produce a second set of coefficients that could disagree with the ones
  the projection used.
* `factors.restate` evaluates those same coefficients at different conditions -
  45 minutes instead of 40, an 8-team field instead of 16 - so no new assumption
  enters.
* `score_plan` is `score_plan_samples(...).mean()`; the distribution and the
  point estimate cannot disagree.

**What DRY does not mean here.** Duplication is allowed when the two copies are
answers to different questions, and then it must say so. `emblems.load` reads the
structured banner form (tiers and traits) and `fixed_banner.load_banners` reads
the flat form; both are documented at the point of duplication. Numbers
transcribed from the client are deliberately redundant - `banners.yaml` carries
`displayed:` percentages that `emblems.multipliers` derives independently, and
`tests/test_emblems.py` fails if they disagree. That redundancy is the check.

---

## KISS

**Prefer the exhaustive answer over the clever one, whenever it fits in memory.**
Five emblems is 120 permutations (`emblems.best_order`). The roster space is
4,096 (`optimize.enumerate_fantasy_rosters`). The Main Event tree is 2^14 =
16,384 (`outcomes.enumerate_outcomes`). All three are enumerated, so the result
is the optimum rather than a heuristic's guess, and there is no search to debug.

Optimise only where the profile demands it, and write down why.
`fantasy.score_plan` vectorises by series length - not for elegance, but because
a bootstrap interval needs the scorer run 160 times and a per-simulation Python
loop makes it unaffordable. `tests/test_projection.py` keeps the original loop as
a reference implementation and asserts they agree.

Config beats code. Formats, buckets, scoring values, banners, patch priors and
pinned ids all live in `config/*.yaml` with comments. Do not encode a tournament
detail in a function when a YAML line does it.

---

## YAGNI

**Do not model something because it sounds rigorous. Model it, measure it, and
report the number - including when the number is zero.**

* `h2h.py` blends pairwise records into the ratings. `scripts/validate_h2h.py`
  showed it scores *worse* out of sample at every prior strength, so it is off by
  default. Both stay in the tree: a negative result is worth keeping next to the
  thing it rules out.
* `draft.py` prices pick/ban availability at **+0.14%** on a roster total. That
  null result is reported, not buried.
* `patch.yaml`'s `team_rating_delta` is empty *on purpose*, with a comment
  saying so - claiming a team got stronger from a patch with no post-patch
  results would move the grid more than anything measured.
* `factors.FactorReport` has an `absent` kind, so an unmodelled effect
  (`coach_titles` before it was implemented, `emblem_inventory` now) appears in
  the audit as a known hole rather than as silence.

Corollary: `scripts/audit.py` re-runs the pipeline with each factor disabled. A
factor that changes nothing is decoration and should be visible as such.

---

## Rules that follow from all four

1. **Degrade, never fail the run.** Fetch errors are caught, counted, and
   surfaced in `corpus.source_notes` - a missing match shrinks the sample, it
   does not crash the answer. `# noqa: BLE001 - degrade, never fail the run`
   marks these deliberately.
2. **Label data versus assumption.** Every `FactorReport` carries a `kind`. Hero
   viability magnitudes are `assumption`; the hero a game was played on is
   `data`. Never let one masquerade as the other.
3. **A missing measurement is not a zero.** `banner.stat_points` returns `None`
   for an unmeasured stat, and unmeasurable stats are excluded from emblem choice
   rather than scored as 0, so the model never recommends an emblem it cannot
   value.
4. **Comments explain why, not what.** The existing docstrings carry the reason a
   design is what it is - bucket-level Murty constraints, right-tail sigma,
   duo-shared banners. Match that density; delete nothing that explains a trap.
5. **Tests pin the traps, not the arithmetic.** Every test file targets a failure
   that would produce plausible nonsense: sample-size bias, k-best returning 57,600
   reorderings of one grid, a patch layer leaking when off, emblem percentages
   disagreeing with the client.
6. **Assumptions belong in README's "What limits the accuracy".** A new
   simplification is not finished until it is listed there under the right kind:
   definition risk, unmeasurable, sampling error, fitted-correction error, or scope.
