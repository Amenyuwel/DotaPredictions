"""Pick the Main Event fantasy roster from the eight teams still alive.

    python -m scripts.main_event
    python -m scripts.main_event --no-ablation --boot 0     # fastest useful run

Three things change between the Group Stage answer and this one, and all three
push in different directions:

1. **The field is eight teams, not sixteen.** Anyone eliminated is worth zero,
   however good their stat lines were. A locked slot pointing at a dead team is
   the single most expensive mistake available here.
2. **The banner is a different hand.** `config/banners.yaml` now holds five
   emblems per role instead of three, on different stats. Players are worth what
   *these* emblems pay, so the Group Stage ranking does not transfer.
3. **Bracket position matters now.** In the Swiss every team was guaranteed 4-6
   series, which flattened survival to a rounding error. Here a team can play two
   series or six, and the Grand Final is a Bo5 -- worth more than a Bo3 under a
   top-two-games rule. So `dota/bracket.py` simulates the drawn bracket and the
   projection is E[best series] over that.

Four corrections that the group-stage path did not make, each measured rather
than assumed, and each reported in the ablation table at the end:

* **Recency in the bootstrap.** Stat *means* were always recency-weighted, but the
  bootstrap the projection samples was not, so a February game was drawn as often
  as one from the group stage that just finished.
* **Coach Titles.** Cerulean and the Clutch are equipped and were priced at zero.
  Both are per-game conditions, applied per game -- see `dota/titles.py`.
* **Expected opponent strength.** Lines are normalised to a 16-team average that
  no longer exists; the Main Event field is the eight best, and each team's
  expected opposition differs with its bracket path.
* **Expected game length.** TI runs longer than the 40-minute yardstick the
  elasticities normalise to, and stats scale with length at very different rates.

Point estimates also carry a bootstrap interval, because a 40-game sample and a
112-game sample are not the same claim.
"""
from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass, field

import numpy as np
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, factors as factors_mod, pipeline
from dota.banner import STAT_SOURCE
from dota.config import Config, Player
from dota.fantasy import (
    best_series_interval,
    expected_best_series,
    recency_weights,
    role_game_scores,
    weighted_stat_means,
)
from dota.optimize import enumerate_fantasy_rosters
from dota.pipeline import SLOT_ROLES
from dota.ratings import Ratings
from dota.sources.base import PlayerGame
from dota.titles import Titles
from scripts.fixed_banner import _Shim, fixed_plan, load_banners

console = Console()

SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}

# Short names, so the points breakdown fits one line per team instead of ten.
ABBREV = {
    "gold_per_min": "GPM",
    "creep_score": "CS",
    "tower_kills": "towers",
    "roshan_kills": "roshan",
    "tormentor_kills": "torm",
    "madstone_collected": "madstone",
    "rune_pickups": "runes",
    "seconds_stunned": "stuns",
    "teamfight_participation": "teamfight",
    "smokes_used": "smokes",
    "lotuses_grabbed": "lotus",
}

# The corrections, as switches, so each one's contribution can be measured by
# turning it on rather than argued about.
ABLATIONS = [
    ("group-stage model", dict(recency=False, titles=False, restate=False)),
    ("+ recency", dict(recency=True, titles=False, restate=False)),
    ("+ coach titles", dict(recency=True, titles=True, restate=False)),
    ("+ opponent & length", dict(recency=True, titles=True, restate=True)),
]


@dataclass
class Fit:
    """Coefficients the pipeline already fitted, recovered from its audit trail."""

    elasticity: dict[str, float] = field(default_factory=dict)
    reference_minutes: float = factors_mod.REFERENCE_MINUTES
    slope: dict[str, float] = field(default_factory=dict)
    reference_rating: float = 0.0

    @classmethod
    def from_reports(cls, reports: list[factors_mod.FactorReport]) -> "Fit":
        out = cls()
        for r in reports:
            if r.name == "duration" and r.enabled:
                out.elasticity = {
                    k: float(v["elasticity"]) for k, v in r.detail["elasticities"].items()
                }
                out.reference_minutes = float(
                    r.detail.get("reference_minutes") or out.reference_minutes
                )
            elif r.name == "opponent" and r.enabled:
                out.slope = {k: float(v["slope"]) for k, v in r.detail["slopes"].items()}
                out.reference_rating = float(r.detail.get("reference_rating") or 0.0)
        return out


@dataclass(frozen=True)
class Draws:
    """How hard to sample, and from where -- the knobs, separated from the data.

    These five travel together everywhere and mean nothing apart: `seed` without
    `n_sims` sets up a reproducible nothing, and `n_boot` without `seed` makes an
    interval that moves between runs of the same command. Passing them as one
    frozen value is also what stops the reproducibility from being accidental --
    `score_slot` derives every generator it needs from `seed`, so two runs with
    the same `Draws` give the same table and two with different ones differ for
    a reason that is written down.
    """

    half_life: float
    n_sims: int
    n_boot: int
    seed: int
    variants: bool


def event_minutes(corpus: pipeline.Corpus, league_name: str) -> float | None:
    """Median game length at the event itself, or None if it has not started."""
    lengths = [
        m.duration_seconds / 60.0
        for m in corpus.matches
        if m.duration_seconds and (m.league_name or "") == league_name
    ]
    return statistics.median(lengths) if len(lengths) >= 20 else None


def expected_opponent_rating(
    outcome: bracket.BracketOutcome, ratings: Ratings, team: str
) -> float:
    """Strength of the field this team expects to face, weighted by series."""
    faced = outcome.opponent_series.get(team) or {}
    total = sum(faced.values())
    if not total:
        return 0.0
    return sum(ratings.get(o) * n for o, n in faced.items()) / total


def team_games(
    cfg: Config,
    games: dict[int, list[PlayerGame]],
    players: list[Player],
    *,
    fit: Fit,
    minutes_to: float | None,
    rating_to: float | None,
) -> dict[int, list[PlayerGame]]:
    """That slot's stat lines, restated onto the conditions expected at TI."""
    out: dict[int, list[PlayerGame]] = {}
    for p in players:
        rows = games.get(p.account_id or -1, [])
        out[p.account_id or -1] = factors_mod.restate(
            rows,
            elasticity=fit.elasticity,
            minutes_from=fit.reference_minutes,
            minutes_to=minutes_to,
            slope=fit.slope,
            rating_from=fit.reference_rating,
            rating_to=rating_to,
        )
    return out


@dataclass
class SlotRow:
    team: str
    players: list[Player]
    proj: float
    mean: float
    n: int
    contrib: dict[str, float]
    means: dict[str, float]
    sd: float = 0.0
    lo: float = 0.0
    hi: float = 0.0
    prefix_rate: float = 0.0
    opp_rating: float = 0.0
    variants: dict[str, float] = field(default_factory=dict)


def score_slot(
    cfg: Config,
    slot: str,
    name: str,
    spec: dict[str, float],
    games: dict[int, list[PlayerGame]],
    gw: dict[int, float],
    outcome: bracket.BracketOutcome,
    ratings: Ratings,
    titles: Titles,
    fit: Fit,
    minutes_to: float | None,
    draws: Draws,
) -> SlotRow | None:
    """E[best series] for one slot on one team, over the drawn bracket.

    Returns None when the pair never appears in a game together, which is a
    thing that happens -- a mid-season roster move leaves a duo with no joint
    sample -- and is reported by the caller rather than scored as zero.

    `outcome` supplies the series shapes this team can expect and the opposition
    behind them, `fit` supplies the pipeline's own coefficients so nothing is
    refitted here, and `draws` supplies the sampling budget. Each ablation in
    `ABLATIONS` re-scores the same slot with one correction switched off, which
    is what fills `SlotRow.variants` and makes "is this correction worth
    anything" a number in the table rather than a claim in a docstring.
    """
    team = cfg.roster.get(name)
    players = [team.by_role(r) for r in SLOT_ROLES[slot]]
    opp = expected_opponent_rating(outcome, ratings, name)
    shapes = outcome.series_samples.get(name, [])
    deciders = outcome.decider_samples.get(name, [])

    scored: dict[str, list] = {}
    for label, flags in (ABLATIONS if draws.variants else ABLATIONS[-1:]):
        pg = (
            team_games(
                cfg, games, players, fit=fit, minutes_to=minutes_to, rating_to=opp
            )
            if flags["restate"]
            else {p.account_id or -1: games.get(p.account_id or -1, []) for p in players}
        )
        combined: dict[str, float] = {}
        for p in players:
            m, _ = weighted_stat_means(pg[p.account_id or -1], game_weight=gw)
            for k, v in m.items():
                combined[k] = combined.get(k, 0.0) + v / len(players)
        plan = fixed_plan(f"{slot}/{name}", spec, cfg.scoring, combined)
        rows = role_game_scores(
            players,
            pg,
            {p.key: plan for p in players},
            cfg.scoring,
            game_multiplier=titles.game_multiplier if flags["titles"] else None,
        )
        if not rows:
            return None
        flat = titles.flat_suffix_multiplier if flags["titles"] else 1.0
        vals = [s * flat for s, _, _ in rows]
        weights = (
            recency_weights(rows, game_weight=gw, half_life_days=draws.half_life)
            if flags["recency"]
            else ([gw.get(mid, 1.0) for _, _, mid in rows] if gw else None)
        )
        proj = expected_best_series(
            vals,
            shapes,
            rng=np.random.default_rng(draws.seed),
            n_sims=draws.n_sims,
            weights=weights,
            decider_samples=deciders if flags["titles"] else None,
            decider_bonus=titles.decider_bonus if flags["titles"] else 0.0,
        )
        scored[label] = [proj, vals, weights, plan, combined, rows, flags]

    label = ABLATIONS[-1][0]
    proj, vals, weights, plan, combined, rows, flags = scored[label]
    sd = lo = hi = 0.0
    if draws.n_boot:
        sd, lo, hi = best_series_interval(
            vals,
            shapes,
            weights=weights,
            decider_samples=deciders,
            decider_bonus=titles.decider_bonus,
            n_boot=draws.n_boot,
            rng=np.random.default_rng(draws.seed + 1),
        )
    pool = [g for p in players for g in games.get(p.account_id or -1, [])]
    return SlotRow(
        team=name,
        players=players,
        proj=proj,
        mean=float(np.mean(vals)),
        n=len(vals),
        contrib={
            c.stat.key: c.stat.points(c.per_game_value) * c.multiplier
            for c in plan.choices.values()
        },
        means=combined,
        sd=sd,
        lo=lo,
        hi=hi,
        prefix_rate=titles.prefix_rate(pool),
        opp_rating=opp,
        variants={k: v[0] for k, v in scored.items()},
    )


def emblem_audit(
    cfg: Config, spec: dict[str, float], means: dict[str, float]
) -> list[tuple[str, float, float, str, float]]:
    """Per emblem: what it pays now, and the best stat you could reroll it into.

    A reroll is guaranteed to change the stat and cannot land on a stat already on
    the banner, so the candidate set is that emblem's colour minus everything else
    carried. The multiplier belongs to the emblem, not the stat, and applies
    unchanged to whatever the reroll produces -- which is why a dead stat sitting
    on a x2.50 emblem is the most expensive thing on a banner.
    """
    out = []
    for key, mult in spec.items():
        stat = cfg.scoring.stats[key]
        now = stat.points(means.get(STAT_SOURCE.get(key, ""), 0.0)) * mult
        best_key, best_pts = "", 0.0
        for cand in cfg.scoring.by_color(stat.color):
            if cand.key in spec:
                continue
            pts = cand.points(means.get(STAT_SOURCE.get(cand.key, ""), 0.0)) * mult
            if pts > best_pts:
                best_key, best_pts = cand.key, pts
        out.append((key, mult, now, best_key, best_pts))
    return sorted(out, key=lambda r: -(r[4] - r[2]))


def apply_rerolls(
    cfg: Config, banners: dict[str, dict[str, float]], specs: list[str]
) -> list[str]:
    """Swap a stat on an emblem, keeping that emblem's multiplier.

    `--reroll support:rune_pickups=observer_wards_planted` answers the question the
    audit raises but cannot price: what the *projection* does if the token is
    spent, rather than what the stat pays per game. Validated against the two real
    constraints -- an emblem's colour is fixed, and no banner may carry a stat
    twice -- so an illegal roll is refused rather than quietly scored.
    """
    notes = []
    for raw in specs:
        try:
            slot, rest = raw.split(":", 1)
            old, new = rest.split("=", 1)
        except ValueError:
            raise SystemExit(f"--reroll wants slot:old=new, got {raw!r}")
        slot, old, new = slot.strip(), old.strip(), new.strip()
        if slot not in banners:
            raise SystemExit(f"--reroll: unknown slot {slot!r}")
        if old not in banners[slot]:
            raise SystemExit(f"--reroll: {slot} banner does not carry {old!r}")
        if new in banners[slot]:
            raise SystemExit(f"--reroll: {slot} banner already carries {new!r}")
        for key in (old, new):
            if key not in cfg.scoring.stats:
                raise SystemExit(f"--reroll: unknown stat {key!r}")
        c_old = cfg.scoring.stats[old].color
        c_new = cfg.scoring.stats[new].color
        if c_old != c_new:
            raise SystemExit(
                f"--reroll: {old} is {c_old}, {new} is {c_new}; an emblem's colour "
                f"cannot be rerolled, only its stat"
            )
        mult = banners[slot][old]
        banners[slot] = {(new if k == old else k): v for k, v in banners[slot].items()}
        notes.append(f"{slot}: {old} -> {new} on the x{mult:.2f} {c_old} emblem")
    return notes


def main() -> int:
    ap = argparse.ArgumentParser(description="Main Event fantasy roster")
    ap.add_argument("--sims", type=int, default=20000, help="bracket simulations")
    ap.add_argument("--period-sims", type=int, default=8000, help="period draws per slot")
    ap.add_argument("--boot", type=int, default=160, help="bootstrap replicates; 0 = off")
    ap.add_argument("--group-sims", type=int, default=2000)
    ap.add_argument("--detail-matches", type=int, default=900)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--half-life", type=float, default=60.0, help="bootstrap recency")
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--no-ablation", action="store_true")
    ap.add_argument("--no-titles", action="store_true")
    ap.add_argument(
        "--reroll",
        action="append",
        default=[],
        metavar="SLOT:OLD=NEW",
        help="price a spent reroll token, e.g. support:lotuses_grabbed=camps_stacked",
    )
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")
    alive = me.teams
    unknown = [t for t in alive if t not in cfg.roster.names]
    if unknown:
        raise SystemExit(f"main_event names not in teams.yaml: {unknown}")

    banners = load_banners()
    for note in apply_rerolls(cfg, banners, args.reroll):
        console.print(f"[bold magenta]reroll applied:[/bold magenta] {escape(note)}")
    blind = {
        slot: [s for s in spec if not cfg.scoring.stats[s].measurable]
        for slot, spec in banners.items()
    }
    titles = (
        Titles() if args.no_titles else Titles.load(cfg.scoring, cfg.scoring.coach_equipped)
    )

    # The full 16-team corpus still feeds ratings and the opponent correction --
    # throwing away the eliminated teams' games would weaken both.
    a = pipeline.analyse(
        cfg,
        n_sims=args.group_sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        top_rosters=1,
        verbose=True,
    )
    games, gw = a.adjusted_games, a.game_weight
    fit = Fit.from_reports(a.factor_reports)
    minutes_to = event_minutes(a.corpus, cfg.tournament.name)

    # Fixed rather than taken from the clock: every slot on every team is scored
    # from this one seed, so two teams' numbers differ because their games do
    # and not because they were drawn from different streams.
    draws = Draws(
        half_life=args.half_life,
        n_sims=args.period_sims,
        n_boot=args.boot,
        seed=20260820,
        variants=not args.no_ablation,
    )

    console.print(f"[bold]coach titles:[/bold] {escape(titles.describe())}")
    console.print(
        f"[bold]restating to:[/bold] "
        f"{minutes_to or fit.reference_minutes:.1f} min games "
        f"(fitted yardstick {fit.reference_minutes:.0f}), "
        f"per-team expected opponent rating "
        f"(fitted yardstick {fit.reference_rating:+.2f})"
    )
    console.print(f"[bold]simulating the drawn bracket x{args.sims:,}[/bold]")
    b = bracket.simulate(
        me.pairings,
        a.ratings.win_prob,
        n_sims=args.sims,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )

    t = Table(title="Main Event bracket - what each team is projected to play")
    t.add_column("Team")
    t.add_column("Round 1")
    t.add_column("Series", justify="right")
    t.add_column("Games", justify="right")
    t.add_column("Decider rate", justify="right")
    t.add_column("Opp rating", justify="right")
    t.add_column("Top 4", justify="right")
    t.add_column("Grand Final", justify="right")
    t.add_column("Wins TI", justify="right")
    opponent = {x: y for pair in me.pairings for x, y in (pair, pair[::-1])}
    for team in sorted(alive, key=lambda x: -b.champion_prob[x]):
        flags = b.decider_samples.get(team, [])
        rate = (
            sum(sum(f) for f in flags) / max(sum(len(f) for f in flags), 1) if flags else 0.0
        )
        t.add_row(
            escape(team),
            escape(f"vs {opponent[team]}"),
            f"{b.expected_series[team]:.2f}",
            f"{b.expected_games[team]:.2f}",
            f"{rate:.1%}",
            f"{expected_opponent_rating(b, a.ratings, team):+.2f}",
            f"{b.top4_prob[team]:.1%}",
            f"{b.grand_final_prob[team]:.1%}",
            f"[bold]{b.champion_prob[team]:.1%}[/bold]",
        )
    console.print(t)

    slots: dict[str, object] = {}
    all_rows: dict[str, list[SlotRow]] = {}
    for slot, roles in SLOT_ROLES.items():
        spec = banners[slot]
        rows: list[SlotRow] = []
        for name in alive:
            r = score_slot(
                cfg,
                slot,
                name,
                spec,
                games,
                gw,
                b,
                a.ratings,
                titles,
                fit,
                minutes_to,
                draws,
            )
            if r is None:
                console.print(f"[yellow]no joint games sampled for {slot}/{name}[/yellow]")
                continue
            rows.append(r)

        rows.sort(key=lambda r: -r.proj)
        all_rows[slot] = rows
        for r in rows:
            slots[f"{slot}/{r.team}"] = _Shim(slot, r.team, r.proj)

        spec_str = ", ".join(f"{k} x{v:.2f}" for k, v in spec.items())
        t = Table(
            title=f"{SLOT_LABEL[slot]} ({spec_str})"
            + (f"  -- BLIND: {', '.join(blind[slot])}" if blind[slot] else "")
        )
        t.add_column("#", justify="right")
        t.add_column("Team")
        t.add_column("Players")
        t.add_column("Per game", justify="right")
        t.add_column("Best series", justify="right")
        t.add_column("90% band", justify="right")
        t.add_column("Blue", justify="right")
        t.add_column("Sample", justify="right")
        t.add_column("Where the points come from")
        best = rows[0].proj if rows else 0.0
        for i, r in enumerate(rows[: args.top], 1):
            share = " ".join(
                f"{ABBREV.get(k, k)} {v:,.0f}"
                for k, v in sorted(r.contrib.items(), key=lambda kv: -kv[1])
            )
            gap = "" if i == 1 else f"  ({r.proj / best - 1:+.1%})"
            t.add_row(
                str(i),
                escape(r.team),
                escape(" + ".join(p.nick for p in r.players)),
                f"{r.mean:,.0f}",
                f"[bold]{r.proj:,.0f}[/bold]{gap}",
                f"{r.lo:,.0f}-{r.hi:,.0f}" if r.hi else "-",
                f"{r.prefix_rate:.0%}",
                f"{r.n}m",
                escape(share),
            )
        console.print(t)

        # Is the ordering actually resolved, or is it inside the error bars?
        if len(rows) > 1 and rows[0].sd:
            gap = rows[0].proj - rows[1].proj
            noise = (rows[0].sd**2 + rows[1].sd**2) ** 0.5
            verdict = (
                "separated" if gap > 2 * noise else
                "not separated" if gap < noise else
                "marginal"
            )
            console.print(
                f"[dim]{SLOT_LABEL[slot]}: #1 over #2 is {gap:,.0f} points against a "
                f"{noise:,.0f}-point joint sampling error -- {verdict}.[/dim]"
            )

        if rows:
            audit = emblem_audit(cfg, spec, rows[0].means)
            t = Table(
                title=f"{SLOT_LABEL[slot]} emblem audit, priced on {rows[0].team} "
                f"(reroll changes the stat, not the multiplier)"
            )
            t.add_column("Emblem", justify="right")
            t.add_column("Carries")
            t.add_column("Pays", justify="right")
            t.add_column("Best reroll in that colour")
            t.add_column("Would pay", justify="right")
            t.add_column("Delta", justify="right")
            for key, mult, now, cand, cand_pts in audit:
                delta = cand_pts - now
                mark = "[bold green]" if delta > 250 else ""
                t.add_row(
                    f"x{mult:.2f}",
                    escape(ABBREV.get(key, key)),
                    f"{now:,.0f}",
                    escape(ABBREV.get(cand, cand or "-")),
                    f"{cand_pts:,.0f}",
                    f"{mark}{delta:+,.0f}",
                )
            console.print(t)
            console.print(
                "[dim]One reroll at a time, priced on the top-ranked duo by mean "
                "points. No banner may carry a stat twice, so the suggestions are "
                "not additive -- recompute after each roll. `deaths` ranks too high "
                "here: it is a ~1,950 floor minus a small number, with no right tail "
                "for E[max] to exploit.[/dim]"
            )

    if not args.no_ablation:
        t = Table(title="What each correction moved (projected best series)")
        t.add_column("Slot")
        t.add_column("Team")
        for label, _ in ABLATIONS:
            t.add_column(label, justify="right")
        t.add_column("Total", justify="right")
        for slot in ("core", "mid", "support"):
            for r in all_rows.get(slot, [])[:3]:
                base = r.variants[ABLATIONS[0][0]]
                cells = []
                prev = base
                for label, _ in ABLATIONS:
                    v = r.variants[label]
                    cells.append(
                        f"{v:,.0f}" if label == ABLATIONS[0][0] else f"{v - prev:+,.0f}"
                    )
                    prev = v
                t.add_row(
                    SLOT_LABEL[slot],
                    escape(r.team),
                    *cells,
                    f"[bold]{prev / base - 1:+.1%}[/bold]",
                )
        console.print(t)

    best_rosters = enumerate_fantasy_rosters(
        cfg.roster,
        slots,  # type: ignore[arg-type]
        distinct_teams=cfg.tournament.fantasy_distinct_teams,
        top_n=args.top,
    )
    t = Table(title="Best Main Event rosters for the rolled banners")
    t.add_column("#", justify="right")
    t.add_column("Cores")
    t.add_column("Mid")
    t.add_column("Supports")
    t.add_column("Projected", justify="right")
    for i, r in enumerate(best_rosters, 1):
        t.add_row(
            str(i),
            escape(r.core_team),
            escape(f"{r.mid_player} ({r.mid_team})"),
            escape(r.support_team),
            f"{r.projected_total:,.0f}",
        )
    console.print(t)

    console.print(
        f"[dim]Eliminated and unpickable: {', '.join(me.eliminated)}[/dim]"
    )
    for slot, keys in blind.items():
        for k in keys:
            console.print(
                f"[yellow]{SLOT_LABEL[slot]} banner carries {k} "
                f"(x{banners[slot][k]:.2f}), which OpenDota does not expose. It "
                f"scores 0 here for every team, so it cannot separate them -- but "
                f"it is not worth 0 in the client.[/yellow]"
            )
    if "madstone_collected" in {k for spec in banners.values() for k in spec}:
        console.print(
            "[yellow]madstone_collected is read from item_uses.madstone_bundle "
            "(bundles consumed), a lower bound on madstones collected.[/yellow]"
        )
    missing = [s for spec in banners.values() for s in spec if s not in STAT_SOURCE]
    if missing:
        console.print(f"[red]no stat source mapped for: {sorted(set(missing))}[/red]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
