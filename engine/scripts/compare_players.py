"""Show the evidence behind a slot recommendation, player by player.

    python -m scripts.compare_players --slot support --teams "LGD Gaming" "BetBoom Team"

A projection is a single number and a single number is easy to distrust. This
prints what it was built from: each player's per-game rate on each banner stat,
raw and after the factor corrections, the spread and ceiling that drive an
`E[max]` objective, the sample behind it, and the hero pool that produced it.

The hero pool is the part worth reading closely. Banner stats are hero
properties as much as player properties -- a support who plays Tusk and Earth
Spirit will post different smoke and stun numbers from one who plays Warlock and
Dazzle, and neither is better in the abstract. Only better for a given banner.
"""
from __future__ import annotations

import argparse
from collections import Counter

import numpy as np
import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import pipeline
from dota.banner import STAT_SOURCE
from dota.config import CONFIG_DIR, Config
from dota.pipeline import SLOT_ROLES
from dota.sources import OpenDota

console = Console()


def main() -> int:
    ap = argparse.ArgumentParser(description="Evidence behind a slot pick")
    ap.add_argument("--slot", choices=("core", "mid", "support"), default="support")
    ap.add_argument("--teams", nargs="+", required=True)
    ap.add_argument("--detail-matches", type=int, default=833)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--heroes", type=int, default=8, help="hero pool entries to show")
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    banners = yaml.safe_load((CONFIG_DIR / "banners.yaml").read_text(encoding="utf-8"))
    spec: dict[str, float] = {k: float(v) for k, v in banners[args.slot].items()}

    a = pipeline.analyse(
        cfg, n_sims=args.sims, detail_matches=args.detail_matches,
        top_rosters=1, verbose=True,
    )
    raw = a.corpus.player_games          # untouched
    adj = a.adjusted_games               # after duration + opponent correction
    hero_names = OpenDota().heroes()

    def resolve(name: str) -> str:
        hit = [t for t in cfg.roster.names if t.lower() == name.lower()]
        if hit:
            return hit[0]
        near = [t for t in cfg.roster.names if name.lower() in t.lower()]
        if len(near) == 1:
            return near[0]
        raise SystemExit(f"team {name!r} not found; known: {cfg.roster.names}")

    teams = [resolve(t) for t in args.teams]
    roles = SLOT_ROLES[args.slot]
    fields = {s: STAT_SOURCE[s] for s in spec}

    console.print()
    console.print(
        f"[bold]{args.slot.upper()} banner[/bold]: "
        + ", ".join(f"{k} x{v:.2f}" for k, v in spec.items())
    )

    t = Table(title="Per-player rates on the banner stats (per game)")
    t.add_column("Team")
    t.add_column("Player")
    t.add_column("Games", justify="right")
    for s in spec:
        t.add_column(s.replace("_", " ").title(), justify="right")
    t.add_column("Banner pts", justify="right")

    for team in teams:
        for role in roles:
            p = cfg.roster.get(team).by_role(role)
            rows_raw = raw.get(p.account_id or -1, [])
            rows_adj = adj.get(p.account_id or -1, [])
            if not rows_adj:
                continue
            cells, pts = [], 0.0
            for s, field in fields.items():
                r = [g.stats[field] for g in rows_raw if field in g.stats]
                d = [g.stats[field] for g in rows_adj if field in g.stats]
                rv = float(np.mean(r)) if r else 0.0
                dv = float(np.mean(d)) if d else 0.0
                cells.append(f"{dv:,.2f}\n[dim]raw {rv:,.2f}[/dim]")
                pts += cfg.scoring.stats[s].points(dv) * spec[s]
            t.add_row(
                escape(team), escape(p.nick), str(len(rows_adj)), *cells,
                f"[bold]{pts:,.0f}[/bold]",
            )
    console.print(t)
    console.print(
        "[dim]Adjusted = normalised to a 40-minute game against an average TI "
        "team. Raw = as played. Banner pts uses the adjusted rate.[/dim]"
    )

    # Spread matters: the objective is a maximum, so ceilings decide it.
    t = Table(title="Distribution of the banner stats (adjusted, per game)")
    t.add_column("Team")
    t.add_column("Player")
    t.add_column("Stat")
    t.add_column("Mean", justify="right")
    t.add_column("SD", justify="right")
    t.add_column("Median", justify="right")
    t.add_column("p90", justify="right")
    t.add_column("Max", justify="right")
    for team in teams:
        for role in roles:
            p = cfg.roster.get(team).by_role(role)
            rows_adj = adj.get(p.account_id or -1, [])
            for s, field in fields.items():
                v = np.array(
                    [g.stats[field] for g in rows_adj if field in g.stats], dtype=float
                )
                if v.size == 0:
                    continue
                t.add_row(
                    escape(team), escape(p.nick), s.replace("_", " "),
                    f"{v.mean():,.2f}", f"{v.std(ddof=1):,.2f}",
                    f"{np.median(v):,.2f}", f"{np.percentile(v, 90):,.2f}",
                    f"{v.max():,.2f}",
                )
    console.print(t)

    for team in teams:
        for role in roles:
            p = cfg.roster.get(team).by_role(role)
            rows_adj = adj.get(p.account_id or -1, [])
            pool = Counter(g.hero_id for g in rows_adj if g.hero_id)
            if not pool:
                continue
            t = Table(
                title=f"{escape(p.nick)} ({escape(team)}, {role}) - hero pool, "
                f"{len(rows_adj)} games, {len(pool)} heroes",
                title_justify="left",
            )
            t.add_column("Hero")
            t.add_column("Games", justify="right")
            t.add_column("Share", justify="right")
            for s in spec:
                t.add_column(s.replace("_", " ").title(), justify="right")
            for hid, n in pool.most_common(args.heroes):
                gs = [g for g in rows_adj if g.hero_id == hid]
                cells = []
                for s, field in fields.items():
                    v = [g.stats[field] for g in gs if field in g.stats]
                    cells.append(f"{np.mean(v):,.2f}" if v else "-")
                t.add_row(
                    escape(hero_names.get(hid, str(hid))),
                    str(n), f"{n / len(rows_adj):.0%}", *cells,
                )
            console.print(t)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
