"""Fill in the Main Event bracket prediction.

    python -m scripts.predict_bracket

Prints, for the drawn bracket in `config/tournament.yaml`:

  * who wins each of the fourteen matches, chosen to maximise expected correct
    picks over *legal* fillings rather than match by match,
  * what a per-node greedy pick would claim and why it is usually not a legal
    bracket,
  * each team's odds at every stage,
  * the chance of a perfect bracket, counted from the joint simulation.
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, bracket_picks, pipeline
from dota.bracket import NODE_DAY, NODES
from dota.config import Config

console = Console()

NODE_LABEL = {
    "A": "UB R1 - A", "B": "UB R1 - B", "C": "UB R1 - C", "D": "UB R1 - D",
    "E": "UB R2 - E", "F": "UB R2 - F", "G": "UB Final - G",
    "LB1a": "LB R1 (losers A/B)", "LB1b": "LB R1 (losers C/D)",
    "LB2a": "LB R2 (loser F)", "LB2b": "LB R2 (loser E)",
    "LB3": "LB R3", "LBF": "LB Final", "GF": "GRAND FINAL",
}


def main() -> int:
    ap = argparse.ArgumentParser(description="Main Event bracket prediction")
    ap.add_argument("--sims", type=int, default=60000)
    ap.add_argument("--group-sims", type=int, default=2000)
    ap.add_argument("--detail-matches", type=int, default=900)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--half-life", type=float, default=90.0)
    ap.add_argument("--variants", type=int, default=5)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")

    a = pipeline.analyse(
        cfg,
        n_sims=args.group_sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        half_life_days=args.half_life,
        top_rosters=1,
        verbose=True,
    )
    b = bracket.simulate(
        me.pairings,
        a.ratings.win_prob,
        n_sims=args.sims,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )

    t = Table(title="Team by team")
    t.add_column("Team")
    t.add_column("Rating", justify="right")
    t.add_column("Round 1")
    t.add_column("Wins R1", justify="right")
    t.add_column("Top 4", justify="right")
    t.add_column("Grand Final", justify="right")
    t.add_column("WINS TI", justify="right")
    r1_of = {}
    for (x, y), node in zip(me.pairings, "ABCD"):
        r1_of[x] = (node, y)
        r1_of[y] = (node, x)
    for team in sorted(me.teams, key=lambda x: -b.champion_prob[x]):
        node, opp = r1_of[team]
        t.add_row(
            escape(team),
            f"{a.ratings.get(team):+.2f}",
            escape(f"{node}: vs {opp}"),
            f"{b.node_win_prob[node].get(team, 0.0):.1%}",
            f"{b.top4_prob[team]:.1%}",
            f"{b.grand_final_prob[team]:.1%}",
            f"[bold]{b.champion_prob[team]:.1%}[/bold]",
        )
    console.print(t)

    best = bracket_picks.best_fillings(
        me.pairings, b.node_win_prob, top_n=max(args.variants, 1)
    )
    top = best[0]
    top.perfect_prob, top.correct_hist = bracket_picks.perfect_probability(
        top.picks, b.teams, b.node_winners
    )

    ceiling, greedy = bracket_picks.greedy_ceiling(b.node_win_prob)
    legal = bracket_picks.is_legal(greedy, me.pairings)

    t = Table(
        title=f"THE PICK - expected {top.expected_correct:.2f} of {len(NODES)} correct"
    )
    t.add_column("Match")
    t.add_column("Day")
    t.add_column("Pick")
    t.add_column("P(wins it)", justify="right")
    t.add_column("Greedy would say", justify="right")
    for node in NODES:
        p = b.node_win_prob.get(node, {}).get(top.picks[node], 0.0)
        alt = greedy.get(node, "")
        t.add_row(
            escape(NODE_LABEL[node]),
            NODE_DAY[node],
            escape(top.picks[node])
            + (" [bold]<-- CHAMPION[/bold]" if node == "GF" else ""),
            f"{p:.1%}",
            "" if alt == top.picks[node] else escape(f"{alt} ({b.node_win_prob[node][alt]:.1%})"),
        )
    console.print(t)

    console.print(
        f"[dim]Per-node greedy would claim {ceiling:.2f} correct, but that set of "
        f"picks is {'legal' if legal else '[bold]not a legal bracket[/bold]'}"
        f"{'' if legal else ' -- it predicts teams into rounds it also predicts them out of'}"
        f". Best legal filling: {top.expected_correct:.2f}.[/dim]"
    )
    console.print(
        f"[bold]Perfect bracket: {top.perfect_prob:.3%}[/bold]  "
        + "  ".join(
            f"{k} right {v:.1%}"
            for k, v in sorted(top.correct_hist.items(), reverse=True)[:5]
        )
    )

    if len(best) > 1:
        t = Table(title="Next-best legal brackets, as swaps against the pick")
        t.add_column("#", justify="right")
        t.add_column("Champion")
        t.add_column("E[correct]", justify="right")
        t.add_column("Differs at")
        for i, f in enumerate(best[1:], 2):
            diffs = [
                f"{NODE_LABEL[n]}: {f.picks[n]}"
                for n in NODES
                if f.picks[n] != top.picks[n]
            ]
            t.add_row(
                str(i),
                escape(f.champion),
                f"{f.expected_correct:.2f}",
                escape("; ".join(diffs) or "-"),
            )
        console.print(t)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
