"""Score one specific roster against every legal alternative.

    python -m scripts.evaluate_roster --supports "BetBoom Team" --cores "Iron Wing" --mid "No[o]ne"

Reports where your roster ranks among all legal combinations, what each slot
contributes, and the single best swap for each slot held independently -- which
is what you actually want when deciding whether to spend a change.
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import pipeline, report
from dota.optimize import enumerate_fantasy_rosters

console = Console()


def main() -> int:
    ap = argparse.ArgumentParser(description="Evaluate a specific fantasy roster")
    ap.add_argument("--supports", required=True, help="team supplying both supports")
    ap.add_argument("--cores", required=True, help="team supplying carry + offlane")
    ap.add_argument("--mid", required=True, help="mid laner nickname")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--history-days", type=int, default=180)
    args = ap.parse_args()
    load_dotenv()

    analysis = pipeline.analyse(
        n_sims=args.sims, history_days=args.history_days, top_rosters=1, verbose=True
    )
    cfg = analysis.config
    slots = analysis.slots

    def find_team(name: str) -> str:
        exact = [t for t in cfg.roster.names if t.lower() == name.lower()]
        if exact:
            return exact[0]
        near = [t for t in cfg.roster.names if name.lower() in t.lower()]
        if len(near) == 1:
            return near[0]
        raise SystemExit(f"team {name!r} not found; known: {cfg.roster.names}")

    supports = find_team(args.supports)
    cores = find_team(args.cores)
    mids = [(t, cfg.roster.get(t).by_role("mid")) for t in cfg.roster.names]
    mid_hit = [(t, p) for t, p in mids if p.nick.lower() == args.mid.lower()]
    if not mid_hit:
        mid_hit = [(t, p) for t, p in mids if args.mid.lower() in p.nick.lower()]
    if len(mid_hit) != 1:
        raise SystemExit(
            f"mid {args.mid!r} not resolved; known: {[p.nick for _, p in mids]}"
        )
    mid_team, mid_player = mid_hit[0]

    # Full enumeration, so a rank is a true rank rather than a top-N guess.
    everything = enumerate_fantasy_rosters(
        cfg.roster,
        slots,
        distinct_teams=cfg.tournament.fantasy_distinct_teams,
        top_n=10**6,
    )
    mine = next(
        r
        for r in everything
        if r.support_team == supports
        and r.core_team == cores
        and r.mid_player == mid_player.nick
    )
    rank = everything.index(mine) + 1
    best = everything[0]

    console.print(
        f"\n[bold]Your roster[/bold]: supports {escape(supports)} | cores "
        f"{escape(cores)} | mid {escape(mid_player.nick)} ({escape(mid_team)})"
    )
    console.print(
        f"Projected [bold]{mine.projected_total:,.0f}[/bold] - rank "
        f"[bold]{rank}[/bold] of {len(everything):,} legal rosters "
        f"(best is {best.projected_total:,.0f}, "
        f"{best.projected_total - mine.projected_total:+,.0f})\n"
    )

    # Per-slot contribution, and the best alternative with the other two frozen.
    t = Table(title="Slot analysis (other two slots held fixed)")
    t.add_column("Slot")
    t.add_column("Your pick")
    t.add_column("Contributes", justify="right")
    t.add_column("Best available")
    t.add_column("Gain", justify="right")

    sup_alt = max(
        (r for r in everything if r.core_team == cores and r.mid_player == mid_player.nick),
        key=lambda r: r.projected_total,
    )
    core_alt = max(
        (r for r in everything if r.support_team == supports and r.mid_player == mid_player.nick),
        key=lambda r: r.projected_total,
    )
    mid_alt = max(
        (r for r in everything if r.support_team == supports and r.core_team == cores),
        key=lambda r: r.projected_total,
    )

    t.add_row(
        "Supports",
        escape(supports),
        f"{mine.breakdown['supports']:,.0f}",
        escape(sup_alt.support_team),
        f"{sup_alt.projected_total - mine.projected_total:+,.0f}",
    )
    t.add_row(
        "Cores",
        escape(cores),
        f"{mine.breakdown['cores']:,.0f}",
        escape(core_alt.core_team),
        f"{core_alt.projected_total - mine.projected_total:+,.0f}",
    )
    t.add_row(
        "Mid",
        escape(mid_player.nick),
        f"{mine.breakdown['mid']:,.0f}",
        escape(f"{mid_alt.mid_player} ({mid_alt.mid_team})"),
        f"{mid_alt.projected_total - mine.projected_total:+,.0f}",
    )
    console.print(t)

    # The banner each slot should chase, and what it is worth. Same renderer the
    # main run uses, so the two reports can never drift apart.
    report.print_roster_banners(analysis, mine)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
