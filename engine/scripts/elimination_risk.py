"""What an early exit actually costs a fantasy slot.

    python -m scripts.elimination_risk
    python -m scripts.elimination_risk --core PARIVISION --mid "Iron Wing" --support "Team Spirit"

The fear is reasonable and the premise is usually wrong. Fantasy scores **the best
series a role played in the period**, so a team knocked out in round one does not
zero your slot -- it keeps whatever its best of two series was worth. You lose
*chances at a good series*, not the points, and the two cost very different amounts.

This prices the difference from the drawn bracket:

* how likely each team is to be gone after two series,
* what a slot scores conditional on that happening,
* the whole distribution of the period score, so the downside is a number rather
  than a worry: p10 is the bad-but-not-catastrophic case, p50 the typical one.

The roster total is sampled with the three slots **joined on the same simulated
bracket**, because your teams are in one tree -- if two of your picks meet, one of
them loses. That leaves the expected total unchanged and widens its spread, which is
exactly what a risk question is about.
"""
from __future__ import annotations

import argparse

import numpy as np
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, pipeline
from dota.config import Config
from dota.fantasy import (
    plan_series,
    recency_weights,
    score_plan_samples,
    weighted_stat_means,
)
from dota.pipeline import SLOT_ROLES
from dota.titles import Titles
from scripts.fixed_banner import fixed_plan, load_banners
from scripts.main_event import (
    Fit,
    event_minutes,
    expected_opponent_rating,
    team_games,
)
from scripts.titles import base_components

console = Console()
SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}


def slot_samples(
    cfg: Config,
    slot: str,
    name: str,
    spec: dict[str, float],
    a,
    b,
    fit: Fit,
    minutes_to: float | None,
    titles: Titles,
    *,
    half_life: float,
    indices: np.ndarray,
    seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """(period score per simulation, series played per simulation)."""
    team = cfg.roster.get(name)
    players = [team.by_role(r) for r in SLOT_ROLES[slot]]
    pg = team_games(
        cfg,
        a.adjusted_games,
        players,
        fit=fit,
        minutes_to=minutes_to,
        rating_to=expected_opponent_rating(b, a.ratings, name),
    )
    means: dict[str, float] = {}
    for p in players:
        m, _ = weighted_stat_means(pg[p.account_id or -1], game_weight=a.game_weight)
        for k, v in m.items():
            means[k] = means.get(k, 0.0) + v / len(players)
    plan_obj = fixed_plan(f"{slot}/{name}", spec, cfg.scoring, means)
    rows = base_components(players, pg, plan_obj, cfg.scoring)
    if not rows:
        raise SystemExit(f"no joint games sampled for {slot}/{name}")

    flat = titles.flat_suffix_multiplier
    scored = [
        (
            sum(base * titles.game_multiplier(p, g) for p, g, base in comps)
            / len(comps)
            * flat,
            when,
            match_id,
        )
        for match_id, when, comps in rows
    ]
    weights = recency_weights(scored, game_weight=a.game_weight, half_life_days=half_life)
    pool = np.asarray([s for s, _, _ in scored], dtype=float)
    w = np.clip(np.asarray(weights, dtype=float), 0.0, None)
    p = w / w.sum() if w.sum() > 0 else None

    plan = plan_series(
        b.series_samples.get(name, []),
        decider_samples=b.decider_samples.get(name, []),
        indices=indices,
        rng=np.random.default_rng(seed),
    )
    if plan is None:
        raise SystemExit(f"no simulated schedule for {name}")
    samples = score_plan_samples(
        pool, plan, np.random.default_rng(seed), p=p, decider_bonus=titles.decider_bonus
    )
    # Series played per simulation, recovered from the flattened plan.
    counts = np.diff(np.append(plan.starts, plan.n_series))
    return samples, counts


def main() -> int:
    ap = argparse.ArgumentParser(description="Price elimination risk per slot")
    ap.add_argument("--core", default="PARIVISION")
    ap.add_argument("--mid", default="Iron Wing")
    ap.add_argument("--support", default="Team Spirit")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--group-sims", type=int, default=2000)
    ap.add_argument("--detail-matches", type=int, default=900)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--half-life", type=float, default=60.0)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")
    banners = load_banners(scoring=cfg.scoring)
    titles = Titles.load(cfg.scoring, cfg.scoring.coach_equipped)

    a = pipeline.analyse(
        cfg,
        n_sims=args.group_sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        top_rosters=1,
        verbose=True,
    )
    fit = Fit.from_reports(a.factor_reports)
    minutes_to = event_minutes(a.corpus, cfg.tournament.name)
    b = bracket.simulate(
        me.pairings,
        a.ratings.win_prob,
        n_sims=args.sims,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )

    # Every slot reads the same simulated brackets, in the same order, so the three
    # slots stay joined.
    n_kept = len(b.series_samples[me.teams[0]])
    indices = np.arange(n_kept)

    opponent = {x: y for pair in me.pairings for x, y in (pair, pair[::-1])}
    per_slot: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    for slot in ("core", "mid", "support"):
        per_slot[slot] = {}
        rows = []
        for name in me.teams:
            samples, counts = slot_samples(
                cfg,
                slot,
                name,
                banners[slot],
                a,
                b,
                fit,
                minutes_to,
                titles,
                half_life=args.half_life,
                indices=indices,
                seed=20260820,
            )
            per_slot[slot][name] = (samples, counts)
            early = counts <= 2
            deep = counts >= 5
            rows.append(
                (
                    name,
                    float(samples.mean()),
                    float(np.percentile(samples, 10)),
                    float(np.percentile(samples, 50)),
                    float(early.mean()),
                    float(samples[early].mean()) if early.any() else float("nan"),
                    float(samples[deep].mean()) if deep.any() else float("nan"),
                )
            )
        rows.sort(key=lambda r: -r[1])

        t = Table(
            title=f"{SLOT_LABEL[slot]} - what an early exit costs "
            f"(all figures = projected period score)"
        )
        t.add_column("Team")
        t.add_column("Round 1")
        t.add_column("Mean", justify="right")
        t.add_column("p50", justify="right")
        t.add_column("p10", justify="right")
        t.add_column("P(out in 2)", justify="right")
        t.add_column("If out in 2", justify="right")
        t.add_column("If 5-6 series", justify="right")
        t.add_column("Cost of exit", justify="right")
        for name, mean, p10, p50, p_early, if_early, if_deep in rows:
            t.add_row(
                escape(name),
                escape(f"vs {opponent[name]}"),
                f"[bold]{mean:,.0f}[/bold]",
                f"{p50:,.0f}",
                f"{p10:,.0f}",
                f"{p_early:.0%}",
                f"{if_early:,.0f}",
                f"{if_deep:,.0f}",
                f"{if_early / mean - 1:+.1%}",
            )
        console.print(t)

    # -- roster totals, joined on the bracket ------------------------------
    picks = {"core": args.core, "mid": args.mid, "support": args.support}
    alts = {
        "your picks": picks,
        "highest mean": {
            slot: max(per_slot[slot], key=lambda n: per_slot[slot][n][0].mean())
            for slot in per_slot
        },
        "safest (best p10)": {
            slot: max(
                per_slot[slot], key=lambda n: np.percentile(per_slot[slot][n][0], 10)
            )
            for slot in per_slot
        },
    }
    t = Table(title="Roster totals, three slots joined on the same simulated bracket")
    t.add_column("Roster")
    t.add_column("Cores")
    t.add_column("Mid")
    t.add_column("Supports")
    t.add_column("Mean", justify="right")
    t.add_column("p50", justify="right")
    t.add_column("p10", justify="right")
    t.add_column("p90", justify="right")
    for label, sel in alts.items():
        total = sum(per_slot[slot][sel[slot]][0] for slot in ("core", "mid", "support"))
        t.add_row(
            escape(label),
            escape(sel["core"]),
            escape(sel["mid"]),
            escape(sel["support"]),
            f"[bold]{total.mean():,.0f}[/bold]",
            f"{np.percentile(total, 50):,.0f}",
            f"{np.percentile(total, 10):,.0f}",
            f"{np.percentile(total, 90):,.0f}",
        )
    console.print(t)
    console.print(
        "[dim]Spread here is bracket luck plus game-to-game variance, not sampling "
        "error in the stat lines -- that band is reported by scripts.main_event and "
        "is roughly +-350 per slot on top of this.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
