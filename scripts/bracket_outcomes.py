"""Main Event bracket, fitted on this TI alone and enumerated exactly.

    python -m scripts.bracket_outcomes

Two deliberate differences from `scripts.predict_bracket`:

  * **Evidence.** Ratings are fitted on the matches of one league -- TI 2026's
    own group stage and elimination round -- instead of six months of pro Dota.
    Same field, same patch, same stage, no cross-region calibration and no
    results from rosters that have since changed. It is a much smaller sample,
    so the shrinkage prior does more of the work; `--prior-strength` is reported
    as a sensitivity rather than hidden.
  * **Method.** Every one of the 2^14 = 16,384 possible outcomes is enumerated
    with its exact probability instead of sampled. Marginals, placements,
    perfect-bracket odds and the scoring of a submitted bracket are then exact.

Matches are read from the on-disk cache, so this runs offline and reproducibly.
"""
from __future__ import annotations

import argparse

from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import h2h as h2h_mod
from dota import outcomes as outcomes_mod
from dota import pipeline, ratings as ratings_mod
from dota.bracket import NODE_DAY, NODES
from dota.config import Config
from dota.sources import MatchResult, cached_pro_matches

console = Console(width=140)

# The three-to-six letter tags the client prints in the bracket. Reporting only --
# a full outcome is fourteen team names wide and unreadable spelled out.
TAG = {
    "Iron Wing": "IW", "Team Spirit": "TSpirit", "PARIVISION": "VSN",
    "BetBoom Team": "BB", "Team Liquid": "Liquid", "Team Yandex": "TY",
    "Nigma Galaxy": "NGX", "Team Falcons": "FLCN",
}

NODE_LABEL = {
    "A": "UB R1 - A", "B": "UB R1 - B", "C": "UB R1 - C", "D": "UB R1 - D",
    "E": "UB R2 - E", "F": "UB R2 - F", "G": "UB Final - G",
    "LB1a": "LB R1 (losers A/B)", "LB1b": "LB R1 (losers C/D)",
    "LB2a": "LB R2 (loser F)", "LB2b": "LB R2 (loser E)",
    "LB3": "LB R3", "LBF": "LB Final", "GF": "GRAND FINAL",
}


def load_matches(cfg: Config, league_id: int | None) -> list[MatchResult]:
    matches = pipeline.canonicalise(cfg, cached_pro_matches(league_id))
    return sorted(matches, key=lambda m: m.start_time)


def records(matches: list[MatchResult], teams: list[str]) -> dict[str, tuple[int, int]]:
    rec: dict[str, list[int]] = {t: [0, 0] for t in teams}
    for m in matches:
        if m.winner_name in rec:
            rec[m.winner_name][0] += 1
        if m.loser_name in rec:
            rec[m.loser_name][1] += 1
    return {t: (w, l) for t, (w, l) in rec.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description="Exact Main Event outcome enumeration")
    ap.add_argument(
        "--league",
        type=int,
        default=None,
        help="OpenDota league id to fit on (default: main_event.league_id)",
    )
    ap.add_argument(
        "--all-history",
        action="store_true",
        help="fit on every cached pro match instead of one league",
    )
    ap.add_argument("--prior-strength", type=float, default=3.0)
    ap.add_argument("--half-life", type=float, default=90.0)
    ap.add_argument("--top-outcomes", type=int, default=15)
    ap.add_argument(
        "--h2h-k",
        type=float,
        default=None,
        help=(
            "blend each pair's own record into its rating, in pseudo-games "
            "(small = trust the record, large = trust the rating). Records come "
            "from the whole cache, not one league, because half the pairs in "
            "this bracket never met at the event. Off by default: it scores "
            "worse out of sample -- see scripts.validate_h2h"
        ),
    )
    args = ap.parse_args()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")
    league = None if args.all_history else (args.league or me.league_id)

    matches = load_matches(cfg, league)
    if not matches:
        raise SystemExit(
            "no cached matches for that league -- run scripts.main_event once to "
            "populate data/cache/opendota"
        )
    field_matches = [
        m
        for m in matches
        if m.winner_name in set(me.teams) or m.loser_name in set(me.teams)
    ]
    console.print(
        f"[bold]{len(matches)} games[/bold] from "
        f"{matches[0].league_name or league or 'all cached leagues'} "
        f"({matches[0].start_time:%b %d} - {matches[-1].start_time:%b %d %Y}), "
        f"{len(field_matches)} involving a Main Event team"
    )

    r = ratings_mod.fit(
        matches,
        cfg.roster.names,
        half_life_days=args.half_life,
        prior_strength=args.prior_strength,
        alias=cfg.roster.aliases,
    )
    # A pair's own record, if it is being used at all, is drawn from every
    # cached league rather than from `matches`: 16 of the 28 pairs in this
    # bracket never met at the event, so a league-scoped record would be blank
    # exactly where the question gets interesting.
    pair_record = (
        h2h_mod.H2HModel.build(
            pipeline.canonicalise(cfg, cached_pro_matches(None)),
            half_life_days=args.half_life,
            teams=set(me.teams),
        )
        if args.h2h_k is not None
        else None
    )

    def series_prob(a: str, b: str, bo: int) -> float:
        p = r.win_prob(a, b)
        if pair_record is not None:
            p = pair_record.adjust(p, a, b, prior_k=args.h2h_k)
        return ratings_mod.series_prob(p, bo)

    space = outcomes_mod.enumerate_outcomes(
        me.pairings,
        series_prob,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )
    if pair_record is not None:
        console.print(
            f"[yellow]Head-to-head blended in at {args.h2h_k:g} pseudo-games.[/yellow] "
            "Records are recency-weighted and taken from every cached league."
        )

    rec = records(matches, me.teams)
    r1_of = {}
    for (x, y), node in zip(me.pairings, "ABCD"):
        r1_of[x] = (node, y)
        r1_of[y] = (node, x)

    t = Table(title="Team by team, on this event's games only")
    t.add_column("Team")
    t.add_column("Games", justify="right")
    t.add_column("Rating", justify="right")
    t.add_column("Round 1")
    t.add_column("Wins R1", justify="right")
    t.add_column("Top 4", justify="right")
    t.add_column("Grand Final", justify="right")
    t.add_column("WINS TI", justify="right")
    for team in sorted(me.teams, key=lambda x: -space.champion_prob[x]):
        node, opp = r1_of[team]
        w, l = rec[team]
        t.add_row(
            escape(team),
            f"{w}-{l}",
            f"{r.get(team):+.2f}",
            escape(f"{node}: vs {opp}"),
            f"{space.node_win_prob[node][team]:.1%}",
            f"{space.top4_prob[team]:.1%}",
            f"{space.grand_final_prob[team]:.1%}",
            f"[bold]{space.champion_prob[team]:.1%}[/bold]",
        )
    console.print(t)

    t = Table(title="Where each team finishes (exact, sums to 100% per row)")
    t.add_column("Team")
    for label, _ in outcomes_mod.PLACES:
        t.add_column(label, justify="right")
    for team in sorted(me.teams, key=lambda x: -space.champion_prob[x]):
        t.add_row(
            escape(team),
            *(f"{space.place_prob[team][lbl]:.1%}" for lbl, _ in outcomes_mod.PLACES),
        )
    console.print(t)

    t = Table(title="Every match: who can reach it, and who wins it")
    t.add_column("Match")
    t.add_column("Day")
    t.add_column("Field (reach % / win %)")
    for node in NODES:
        reach = space.node_reach_prob[node]
        rows = sorted(reach, key=lambda x: -space.node_win_prob[node].get(x, 0.0))
        t.add_row(
            escape(NODE_LABEL[node]),
            NODE_DAY[node],
            escape(
                "  ".join(
                    f"{TAG[x]} {reach[x]:.0%}/{space.node_win_prob[node].get(x, 0.0):.0%}"
                    for x in rows
                )
            ),
        )
    console.print(t)

    best = outcomes_mod.best_bracket(space)
    mine = me.my_picks
    legal = bool(mine) and space.hits(mine).max() == len(NODES)
    scored = space.score(mine) if legal else None

    t = Table(
        title=f"MODEL BRACKET - expected {best.expected_correct:.2f} of {len(NODES)} correct"
    )
    t.add_column("Match")
    t.add_column("Day")
    t.add_column("Model pick")
    t.add_column("P", justify="right")
    if scored is not None:
        t.add_column("Your pick")
        t.add_column("P", justify="right")
    for node in NODES:
        row = [
            escape(NODE_LABEL[node]),
            NODE_DAY[node],
            escape(best.picks[node]) + (" [bold]<-- CHAMPION[/bold]" if node == "GF" else ""),
            f"{best.per_node[node]:.1%}",
        ]
        if scored is not None:
            same = scored.picks[node] == best.picks[node]
            row += [
                ("[dim]=[/dim] " if same else "[yellow]x[/yellow] ")
                + escape(scored.picks[node]),
                f"{scored.per_node[node]:.1%}",
            ]
        t.add_row(*row)
    console.print(t)

    def summarise(label: str, s: outcomes_mod.PickScore) -> None:
        console.print(
            f"[bold]{label}[/bold]: E[correct] {s.expected_correct:.2f}/14  "
            f"perfect {s.perfect_prob:.4%} (1 in {1 / s.perfect_prob:,.0f})  "
            f"champion {s.champion} {s.per_node['GF']:.1%}  "
            + "  ".join(f">={k} {s.at_least(k):.0%}" for k in (5, 7, 9))
        )

    summarise("Model bracket", best)
    if scored is not None:
        summarise("Your bracket", scored)
        diffs = [n for n in NODES if scored.picks[n] != best.picks[n]]
        console.print(
            f"[dim]Your bracket differs at {len(diffs)} of 14 nodes: "
            f"{', '.join(NODE_LABEL[n] for n in diffs) or 'none'}. "
            f"Cost {best.expected_correct - scored.expected_correct:+.2f} expected "
            f"picks.[/dim]"
        )
    elif mine:
        console.print("[red]The bracket in config is not a legal filling.[/red]")

    ranked = space.ranked(args.top_outcomes)
    t = Table(title=f"Most likely complete outcomes (of {space.n_outcomes:,})")
    t.add_column("#", justify="right")
    t.add_column("P", justify="right")
    t.add_column("Champion")
    t.add_column("2nd")
    t.add_column("3rd")
    t.add_column("4th")
    t.add_column("UB A/B/C/D/E/F/G")
    t.add_column("LB 1a/1b/2a/2b/3/F")
    for i, (p, picks) in enumerate(ranked, 1):
        runner = picks["G"] if picks["GF"] != picks["G"] else picks["LBF"]
        third = picks["G"] if picks["LBF"] != picks["G"] else picks["LB3"]
        fourth = picks["LB2a"] if picks["LB3"] != picks["LB2a"] else picks["LB2b"]
        t.add_row(
            str(i),
            f"{p:.2%}",
            escape(TAG[picks["GF"]]),
            escape(TAG[runner]),
            escape(TAG[third]),
            escape(TAG[fourth]),
            escape("/".join(TAG[picks[n]] for n in ("A", "B", "C", "D", "E", "F", "G"))),
            escape("/".join(TAG[picks[n]] for n in ("LB1a", "LB1b", "LB2a", "LB2b", "LB3", "LBF"))),
        )
    console.print(t)
    console.print(
        f"[dim]Top {len(ranked)} outcomes together carry "
        f"{sum(p for p, _ in ranked):.1%} of the probability; the median outcome is "
        f"worth {sorted(space.probs)[space.n_outcomes // 2]:.4%}.[/dim]"
    )

    if scored is not None:
        rank = int((space.probs > space.probs[space.hits(mine) == len(NODES)][0]).sum()) + 1
        console.print(
            f"[dim]Your exact bracket is outcome #{rank:,} of {space.n_outcomes:,} by "
            f"probability.[/dim]"
        )

    t = Table(title="Champion odds vs how hard the small sample is shrunk")
    t.add_column("Team")
    priors = sorted({1.0, 2.0, args.prior_strength, 5.0, 8.0})
    for k in priors:
        t.add_column(f"prior {k:g}", justify="right")
    alt: dict[float, dict[str, float]] = {}
    for k in priors:
        rk = ratings_mod.fit(
            matches,
            cfg.roster.names,
            half_life_days=args.half_life,
            prior_strength=k,
            alias=cfg.roster.aliases,
        )
        alt[k] = outcomes_mod.enumerate_outcomes(
            me.pairings,
            lambda a, b, bo, _r=rk: _r.series_win_prob(a, b, bo),
            best_of=me.best_of,
            final_best_of=me.final_best_of,
        ).champion_prob
    for team in sorted(me.teams, key=lambda x: -space.champion_prob[x]):
        t.add_row(escape(team), *(f"{alt[k][team]:.1%}" for k in priors))
    console.print(t)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
