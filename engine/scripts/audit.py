"""Measure what every factor is actually worth, by removing it.

    python -m scripts.audit

A factor that is "included" but changes nothing is not evidence of rigour; it
is decoration, and it should be visible as such. This runs the full pipeline
once with everything on, then once per factor with that factor removed, and
reports how far the answer moved.

Two numbers per factor:

  * **top roster change** - does the recommended roster change identity, and by
    how much does its projection move
  * **rank churn** - how many of the top 15 rosters are different rosters

Both matter. A factor can leave the winner alone while reordering everything
behind it, which tells you the winner is robust rather than that the factor is
useless.

The corpus is fetched once and reused, so only the model stage repeats.
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import pipeline
from dota.config import Config

console = Console()


def _identity(roster) -> tuple[str, str, str]:
    return (roster.support_team, roster.core_team, roster.mid_player)


def main() -> int:
    ap = argparse.ArgumentParser(description="Leave-one-out factor audit")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--detail-matches", type=int, default=833)
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    console.print("[dim]building corpus once, reused for every variant ...[/dim]")
    corpus = pipeline.build_corpus(
        cfg, history_days=args.history_days, max_detail_matches=args.detail_matches
    )

    def run(enabled: set[str], patch: bool = True):
        return pipeline.analyse(
            cfg,
            corpus=corpus,
            n_sims=args.sims,
            top_rosters=args.top,
            enabled_factors=enabled,
            use_patch=patch,
            verbose=False,
        )

    everything = set(pipeline.ALL_FACTORS)
    base = run(everything)
    base_top = base.rosters[0]
    base_ids = [_identity(r) for r in base.rosters]

    console.print()
    console.print(
        f"[bold]Baseline[/bold] (all factors on): "
        f"{escape(base_top.describe())} = {base_top.projected_total:,.0f}"
    )

    t = Table(title="Leave-one-out: what each factor is worth")
    t.add_column("Removed")
    t.add_column("Top roster without it")
    t.add_column("Projection", justify="right")
    t.add_column("vs base", justify="right")
    t.add_column("Winner", justify="center")
    t.add_column("Top-15 churn", justify="right")

    variants = [(f, everything - {f}, True) for f in pipeline.ALL_FACTORS]
    variants.append(("patch (whole layer)", everything, False))

    for label, enabled, use_patch in variants:
        a = run(enabled, patch=use_patch)
        top = a.rosters[0]
        ids = [_identity(r) for r in a.rosters]
        same = _identity(top) == _identity(base_top)
        churn = len(set(ids) ^ set(base_ids)) // 2
        t.add_row(
            escape(label),
            escape(f"{top.support_team} / {top.core_team} / {top.mid_player}"),
            f"{top.projected_total:,.0f}",
            f"{top.projected_total - base_top.projected_total:+,.0f}",
            "[green]same[/green]" if same else "[red]CHANGED[/red]",
            f"{churn}/{len(base_ids)}",
        )
    console.print(t)
    console.print(
        "[dim]A factor whose row reads 'same' and 0 churn is doing nothing and "
        "should not be cited as rigour. A factor that changes the winner is "
        "load-bearing -- check its evidence line in the factor audit before "
        "trusting the result.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
