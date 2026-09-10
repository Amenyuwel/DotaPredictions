"""Reorder a spent banner. Free, and worth real points.

    python -m scripts.emblem_order
    python -m scripts.emblem_order --core PARIVISION --mid "Iron Wing" --support "Team Spirit"

With no roll tokens left, the stats on the banner are final -- but two traits are
positional and rearranging emblems costs nothing:

    Vampiric     +50% to itself, -10% to each ADJACENT emblem
    Benevolent     0% to itself, +20% to each ADJACENT emblem

So the arithmetic is: a Vampiric emblem should be given the cheapest neighbours
available (ideally sit at an end, where it has one neighbour instead of two), and a
Benevolent emblem should be given the most expensive. "Cheapest" is measured in
points this roster's players actually produce, which is why this is a per-roster
answer and not a general rule.

The derivation of every displayed percentage from tier + trait + neighbours is
checked against all fifteen values transcribed from the client in
`tests/test_emblems.py`, so the numbers below rest on arithmetic rather than on a
reading of the screenshot.
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, emblems as emblems_mod, pipeline
from dota.banner import STAT_SOURCE
from dota.config import Config
from dota.fantasy import weighted_stat_means
from dota.pipeline import SLOT_ROLES
from dota.titles import Titles
from scripts.fixed_banner import fixed_plan
from scripts.main_event import (
    ABBREV,
    Fit,
    event_minutes,
    expected_opponent_rating,
    team_games,
)
from scripts.titles import base_components, project

console = Console()
SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Optimise emblem order on a spent banner")
    ap.add_argument("--core", default="PARIVISION")
    ap.add_argument("--mid", default="Iron Wing")
    ap.add_argument("--support", default="Team Spirit")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--period-sims", type=int, default=12000)
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
    roster = {"core": args.core, "mid": args.mid, "support": args.support}
    banners = emblems_mod.load()
    if not banners:
        raise SystemExit(
            "config/banners.yaml has no structured `emblems:` blocks; ordering needs "
            "each emblem's tier and trait, which the flat form does not carry"
        )
    for slot, banner in banners.items():
        problems = emblems_mod.check_against_client(banner, cfg.scoring)
        if problems:
            raise SystemExit(
                "config/banners.yaml disagrees with the derived multipliers: "
                + "; ".join(problems)
            )

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

    grand_now = grand_best = 0.0
    for slot, name in roster.items():
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

        # Bare per-game points per stat, before any emblem multiplier. This is what
        # decides who should absorb a Vampiric penalty.
        banner = banners[slot]
        base_points = {
            e.stat: cfg.scoring.stats[e.stat].points(
                means.get(STAT_SOURCE.get(e.stat, ""), 0.0)
            )
            for e in banner
        }
        order, pts_best, pts_now = emblems_mod.best_order(banner, cfg.scoring, base_points)

        shapes = b.series_samples.get(name, [])
        deciders = b.decider_samples.get(name, [])
        projections = {}
        for label, arrangement in (("as rolled", banner), ("best order", order)):
            spec = {
                e.stat: m
                for e, m in zip(
                    arrangement, emblems_mod.multipliers(arrangement, cfg.scoring)
                )
            }
            plan = fixed_plan(f"{slot}/{name}", spec, cfg.scoring, means)
            rows = base_components(players, pg, plan, cfg.scoring)
            if not rows:
                raise SystemExit(f"no joint games sampled for {slot}/{name}")
            projections[label] = project(
                rows,
                titles,
                shapes,
                deciders,
                a.game_weight,
                args.half_life,
                args.period_sims,
                20260820,
            )
        grand_now += projections["as rolled"]
        grand_best += projections["best order"]

        t = Table(
            title=f"{SLOT_LABEL[slot]} - {name}: {pts_now:,.0f} -> {pts_best:,.0f} "
            f"points per game ({pts_best / pts_now - 1:+.2%}), "
            f"projection {projections['as rolled']:,.0f} -> "
            f"{projections['best order']:,.0f} "
            f"({projections['best order'] / projections['as rolled'] - 1:+.2%})"
        )
        t.add_column("Slot", justify="right")
        t.add_column("As rolled")
        t.add_column("x", justify="right")
        t.add_column("Move to")
        t.add_column("x", justify="right")
        t.add_column("Trait")
        t.add_column("Bare points", justify="right")
        now_mult = emblems_mod.multipliers(banner, cfg.scoring)
        best_mult = emblems_mod.multipliers(order, cfg.scoring)
        for i in range(len(banner)):
            moved = order[i].stat != banner[i].stat
            t.add_row(
                str(i + 1),
                escape(ABBREV.get(banner[i].stat, banner[i].stat)),
                f"{now_mult[i]:.2f}",
                ("[bold green]" if moved else "")
                + escape(ABBREV.get(order[i].stat, order[i].stat)),
                f"{best_mult[i]:.2f}",
                escape(order[i].trait),
                f"{base_points[order[i].stat]:,.0f}",
            )
        console.print(t)

    console.print(
        f"[bold]roster total {grand_now:,.0f} -> {grand_best:,.0f} "
        f"({grand_best / grand_now - 1:+.2%})[/bold] from rearranging emblems alone, "
        f"no tokens spent."
    )
    console.print(
        "[dim]Only Vampiric and Benevolent care about position; Fractal, Friendly "
        "and Unique are whole-banner conditions and cannot be fixed by moving "
        "anything. Order is listed top to bottom as the client draws it -- if your "
        "client lays emblems out in a row or a ring, adjacency is whatever is "
        "visually next to what, and the two ends are the positions with one "
        "neighbour.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
