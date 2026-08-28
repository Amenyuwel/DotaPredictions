"""Do your fantasy picks hurt each other by sharing a bracket?

    python -m scripts.roster_conflict
    python -m scripts.roster_conflict --core PARIVISION --mid "Team Liquid" --support "Team Spirit"

The worry: two picks are drawn into the same half, they meet, one of them loses, and
that slot is dead. Three separate things have to be true for that to cost anything,
and this prices each of them:

1. **Do they actually meet?** Computed exactly, per simulated bracket, by
   reconstructing who played whom rather than by eyeballing the tree.
2. **Does the loser die?** Usually not. A loss in the *upper* bracket drops a team
   into the lower one, where it plays more series, not fewer. Only the lower bracket
   and the Grand Final eliminate, so a collision in UB R2 is nearly free.
3. **Does elimination even empty the slot?** No. A period keeps the **best series** a
   role played, so a team that is knocked out still scores its best series to that
   point. It loses chances, not points.

The one thing a collision genuinely does is couple your slots: when two of your teams
meet, one result determines both. That leaves the expected total untouched -- expectation
is linear -- and changes the *spread*. The last table shows how much, by sampling the
roster total with the slots joined on one bracket and then again independently.
"""
from __future__ import annotations

import argparse
from itertools import combinations

import numpy as np
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, pipeline
from dota.bracket import ELIMINATION_NODES, NODES, reconstruct_participants
from dota.config import Config
from dota.titles import Titles
from scripts.elimination_risk import slot_samples
from scripts.fixed_banner import load_banners
from scripts.main_event import Fit, event_minutes
from scripts.predict_bracket import NODE_LABEL

console = Console()
SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Bracket collisions between your picks")
    ap.add_argument("--core", default="PARIVISION")
    ap.add_argument("--mid", default="Team Liquid")
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
    picks = {"core": args.core, "mid": args.mid, "support": args.support}
    for slot, name in picks.items():
        if name not in me.teams:
            raise SystemExit(f"{name!r} is not in the Main Event field")

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

    n_kept = len(b.series_samples[me.teams[0]])
    indices = np.arange(n_kept)
    part = reconstruct_participants(me.pairings, b.teams, b.node_winners)
    at = {n: i for i, n in enumerate(NODES)}
    tindex = {t: i for i, t in enumerate(b.teams)}

    samples = {
        slot: slot_samples(
            cfg, slot, name, banners[slot], a, b, fit, minutes_to, titles,
            half_life=args.half_life, indices=indices, seed=20260820,
        )[0]
        for slot, name in picks.items()
    }

    def met(x: str, y: str, node: str) -> np.ndarray:
        p = part[node]
        ix, iy = tindex[x], tindex[y]
        return ((p[:, 0] == ix) & (p[:, 1] == iy)) | ((p[:, 0] == iy) & (p[:, 1] == ix))

    # -- 1. where your picks collide ---------------------------------------
    t = Table(title="Where your picks meet each other")
    t.add_column("Pair")
    t.add_column("Match")
    t.add_column("Day")
    t.add_column("P(meet here)", justify="right")
    t.add_column("Loser is", justify="right")
    any_pair: dict[tuple[str, str], np.ndarray] = {}
    for (s1, t1), (s2, t2) in combinations(picks.items(), 2):
        if t1 == t2:
            continue
        total = np.zeros(b.node_winners.shape[0], dtype=bool)
        rows = []
        for node in NODES:
            m = met(t1, t2, node)
            if not m.any():
                continue
            total |= m
            rows.append((node, float(m.mean())))
        any_pair[(t1, t2)] = total
        for node, p in sorted(rows, key=lambda r: -r[1]):
            t.add_row(
                escape(f"{SLOT_LABEL[s1]} {t1} vs {SLOT_LABEL[s2]} {t2}"),
                escape(NODE_LABEL[node]),
                bracket.NODE_DAY[node],
                f"{p:.1%}",
                "[red]OUT[/red]" if node in ELIMINATION_NODES else "[green]drops to LB[/green]",
            )
        t.add_row(
            escape(f"{t1} vs {t2}"),
            "[bold]any round[/bold]",
            "",
            f"[bold]{total.mean():.1%}[/bold]",
            "",
        )
    console.print(t)

    # -- 2. what a collision costs the slot --------------------------------
    t = Table(title="What a collision actually costs (projected period score)")
    t.add_column("Slot")
    t.add_column("Team")
    t.add_column("Mean", justify="right")
    t.add_column("If it meets your other pick", justify="right")
    t.add_column("If it LOSES that match", justify="right")
    t.add_column("If knocked out by it", justify="right")
    for slot, name in picks.items():
        others = [n for s, n in picks.items() if n != name]
        meet = np.zeros(b.node_winners.shape[0], dtype=bool)
        lost_to = np.zeros_like(meet)
        killed_by = np.zeros_like(meet)
        for other in others:
            for node in NODES:
                m = met(name, other, node)
                if not m.any():
                    continue
                meet |= m
                lost = m & (b.node_winners[:, at[node]] != tindex[name])
                lost_to |= lost
                if node in ELIMINATION_NODES:
                    killed_by |= lost
        s = samples[slot]
        meet, lost_to, killed_by = meet[:n_kept], lost_to[:n_kept], killed_by[:n_kept]

        def cell(mask: np.ndarray) -> str:
            if not mask.any():
                return "-"
            return f"{s[mask].mean():,.0f}  ({s[mask].mean() / s.mean() - 1:+.1%})"

        t.add_row(
            SLOT_LABEL[slot],
            escape(name),
            f"[bold]{s.mean():,.0f}[/bold]",
            cell(meet),
            cell(lost_to),
            cell(killed_by),
        )
    console.print(t)

    # -- 3. does the coupling change the roster total? ---------------------
    total_joined = sum(samples[slot] for slot in picks)
    rng = np.random.default_rng(20260820)
    total_independent = sum(
        samples[slot][rng.permutation(n_kept)] for slot in picks
    )
    t = Table(title="Roster total: slots joined on one bracket vs sampled independently")
    t.add_column("Sampling")
    t.add_column("Mean", justify="right")
    t.add_column("SD", justify="right")
    t.add_column("p10", justify="right")
    t.add_column("p90", justify="right")
    for label, arr in (
        ("joined (correct)", total_joined),
        ("independent (ignores collisions)", total_independent),
    ):
        t.add_row(
            escape(label),
            f"{arr.mean():,.0f}",
            f"{arr.std(ddof=1):,.0f}",
            f"{np.percentile(arr, 10):,.0f}",
            f"{np.percentile(arr, 90):,.0f}",
        )
    console.print(t)
    console.print(
        f"[dim]Collisions move the mean by "
        f"{total_joined.mean() / total_independent.mean() - 1:+.2%} and the spread by "
        f"{total_joined.std(ddof=1) / total_independent.std(ddof=1) - 1:+.1%}. The mean "
        f"is unaffected by construction -- expectation is linear, so who your picks "
        f"play cannot change what they score on average, only how correlated the "
        f"outcomes are.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
