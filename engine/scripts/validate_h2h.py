"""Does head-to-head predict better than a strength rating? Tested out of sample.

    python -m scripts.validate_h2h

The question is whether "these two have played fifteen times and it is 7-8" beats "these
two have ratings of +1.08 and +0.86". It cannot be answered by fitting, because a
head-to-head term adds a free parameter per pair and will always fit the past better. It
has to be answered on matches the model never saw.

Method: walk forward through the corpus in time slices. For each slice, fit the ratings
and the pairwise records on everything *before* it, predict the games *inside* it, and
score the predictions with log-loss and Brier — proper scoring rules, so a model cannot
win by being confidently wrong. Repeat across a range of prior strengths, from "ignore
head-to-head entirely" to "trust it almost completely".

Also prints the pairwise records for the eight teams still alive, including the pairs that
never met, since that is the case a rating handles and a head-to-head record cannot.
"""
from __future__ import annotations

import argparse
from datetime import timedelta

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import h2h as h2h_mod
from dota import pipeline
from dota import ratings as ratings_mod
from dota.config import Config
from dota.sources import cached_pro_matches

console = Console()

# "inf" means the head-to-head term is switched off entirely: the baseline.
PRIORS = (float("inf"), 40.0, 20.0, 10.0, 5.0, 2.0, 1.0, 0.0)


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate a head-to-head adjustment")
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--test-days", type=int, default=90, help="length of the test window")
    ap.add_argument("--slices", type=int, default=6)
    ap.add_argument("--half-life", type=float, default=90.0)
    ap.add_argument("--prior-strength", type=float, default=3.0)
    ap.add_argument(
        "--offline",
        action="store_true",
        help="score the cached corpus instead of refetching it",
    )
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    if args.offline:
        matches = pipeline.canonicalise(cfg, cached_pro_matches(None))
    else:
        corpus = pipeline.build_corpus(
            cfg, history_days=args.history_days, max_detail_matches=1, verbose=True
        )
        matches = pipeline.canonicalise(cfg, corpus.matches)
    rated = set(cfg.roster.names)
    ours = [
        m
        for m in matches
        if m.radiant_name in rated and m.dire_name in rated and m.start_time
    ]
    ours.sort(key=lambda m: m.start_time)
    if len(ours) < 100:
        raise SystemExit(f"only {len(ours)} matches between rated teams; too few to test")

    end = max(m.start_time for m in ours)
    start = end - timedelta(days=args.test_days)
    edges = [start + (end - start) * i / args.slices for i in range(args.slices + 1)]

    console.print(
        f"[bold]{len(ours)} matches between the 16 TI teams[/bold]; testing on the last "
        f"{args.test_days} days in {args.slices} slices"
    )

    totals = {k: {"ll": 0.0, "brier": 0.0, "n": 0, "hits": 0} for k in PRIORS}
    n_with_history = 0
    for i in range(args.slices):
        lo, hi = edges[i], edges[i + 1]
        train = [m for m in ours if m.start_time < lo]
        test = [m for m in ours if lo <= m.start_time < hi]
        if len(train) < 60 or not test:
            continue
        r = ratings_mod.fit(
            train,
            cfg.roster.names,
            half_life_days=args.half_life,
            prior_strength=args.prior_strength,
            alias=cfg.roster.aliases,
        )
        model = h2h_mod.H2HModel.build(
            train, half_life_days=args.half_life, as_of=lo, teams=rated
        )
        for m in test:
            a, b = m.radiant_name, m.dire_name
            p_rating = r.win_prob(a, b)
            won = bool(m.radiant_win)
            if model.meetings(a, b) > 0:
                n_with_history += 1
            for k in PRIORS:
                p = model.adjust(p_rating, a, b, prior_k=k)
                acc = totals[k]
                acc["ll"] += h2h_mod.log_loss(p, won)
                acc["brier"] += h2h_mod.brier(p, won)
                acc["n"] += 1
                acc["hits"] += int((p >= 0.5) == won)

    base = totals[float("inf")]
    if not base["n"]:
        raise SystemExit("no test matches had enough training history")

    t = Table(
        title=f"Out-of-sample accuracy on {base['n']} unseen games "
        f"({n_with_history} between pairs with a prior record)"
    )
    t.add_column("Head-to-head weight")
    t.add_column("Log-loss", justify="right")
    t.add_column("vs baseline", justify="right")
    t.add_column("Brier", justify="right")
    t.add_column("Correct", justify="right")
    for k in PRIORS:
        acc = totals[k]
        ll = acc["ll"] / acc["n"]
        delta = ll - base["ll"] / base["n"]
        label = (
            "off (rating only)"
            if k == float("inf")
            else "head-to-head only" if k == 0.0 else f"prior of {k:.0f} pseudo-games"
        )
        verdict = "" if k == float("inf") else ("[green]" if delta < 0 else "[red]")
        t.add_row(
            escape(label),
            f"{ll:.4f}",
            "-" if k == float("inf") else f"{verdict}{delta:+.4f}",
            f"{acc['brier'] / acc['n']:.4f}",
            f"{acc['hits'] / acc['n']:.1%}",
        )
    console.print(t)
    console.print(
        "[dim]Lower log-loss is better. A negative 'vs baseline' means head-to-head "
        "helped at that weight; positive means it hurt. Both are proper scoring rules, "
        "so neither rewards confident wrong answers.[/dim]"
    )

    # -- the bracket's own pairs -------------------------------------------
    me = cfg.tournament.main_event
    if me is None:
        return 0
    r_full = ratings_mod.fit(
        ours,
        cfg.roster.names,
        half_life_days=args.half_life,
        prior_strength=args.prior_strength,
        alias=cfg.roster.aliases,
    )
    model_full = h2h_mod.H2HModel.build(
        ours, half_life_days=args.half_life, teams=set(me.teams)
    )
    best_k = min(
        (k for k in PRIORS if k != float("inf")),
        key=lambda k: totals[k]["ll"] / max(totals[k]["n"], 1),
    )
    rows = []
    for i, x in enumerate(sorted(me.teams)):
        for y in sorted(me.teams)[i + 1 :]:
            wa, wb = model_full.record(x, y)
            p = r_full.win_prob(x, y)
            rows.append((x, y, wa, wb, p, model_full.adjust(p, x, y, prior_k=best_k)))
    rows.sort(key=lambda r: -abs(r[5] - r[4]))

    t = Table(
        title=f"Where head-to-head would move the bracket most "
        f"(at the best tested weight, {best_k:.0f} pseudo-games)"
    )
    t.add_column("Matchup")
    t.add_column("Weighted record", justify="right")
    t.add_column("Rating says", justify="right")
    t.add_column("With head-to-head", justify="right")
    t.add_column("Shift", justify="right")
    for x, y, wa, wb, p, p_adj in rows[:10]:
        t.add_row(
            escape(f"{x} vs {y}"),
            f"{wa:.1f} - {wb:.1f}",
            f"{p:.1%}",
            f"{p_adj:.1%}",
            f"{(p_adj - p) * 100:+.1f} pt",
        )
    console.print(t)
    never = [f"{x} vs {y}" for x, y, wa, wb, _p, _q in rows if wa + wb == 0.0]
    if never:
        console.print(
            f"[yellow]Never met in this window, so head-to-head says nothing and the "
            f"rating carries them alone: {', '.join(never)}[/yellow]"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
