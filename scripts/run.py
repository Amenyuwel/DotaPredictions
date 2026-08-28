"""Full run: fetch -> rate -> simulate -> project -> pick.

    python -m scripts.run                    # everything
    python -m scripts.run --only predictions
    python -m scripts.run --sims 50000 --history-days 240
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv

from dota import pipeline, report


def main() -> int:
    ap = argparse.ArgumentParser(description="TI 2026 predictions + fantasy optimiser")
    ap.add_argument("--sims", type=int, default=20000, help="Monte Carlo iterations")
    ap.add_argument(
        "--history-days",
        type=int,
        default=180,
        help="how far back to pull pro results",
    )
    ap.add_argument(
        "--detail-matches",
        type=int,
        default=400,
        help="how many TI-team matches to pull stat lines for. Raising this is "
        "the main lever on thin-sample teams; the cost is fetch time",
    )
    ap.add_argument(
        "--half-life",
        type=float,
        default=90.0,
        help="recency half-life in days for team ratings",
    )
    ap.add_argument(
        "--prior-strength",
        type=float,
        default=3.0,
        help="shrinkage toward field average; raise it if qualifier-only teams "
        "look implausibly strong",
    )
    ap.add_argument(
        "--elim-pairing",
        choices=("seeded", "random"),
        default="seeded",
        help="how the elimination round pairs 3-2 teams against 2-3 teams",
    )
    ap.add_argument(
        "--only",
        choices=(
            "all", "ratings", "swiss", "predictions", "fantasy", "banners", "factors"
        ),
        default="all",
    )
    ap.add_argument(
        "--without",
        action="append",
        default=[],
        choices=list(pipeline.ALL_FACTORS),
        metavar="FACTOR",
        help="disable a stat-line factor (repeatable). Use with scripts.audit to "
        "measure what each one is worth",
    )
    ap.add_argument("--top", type=int, default=15, help="fantasy rosters to list")
    ap.add_argument(
        "--variants",
        type=int,
        default=5,
        help="prediction grids to show, and rosters to print banners for",
    )
    ap.add_argument(
        "--no-patch",
        action="store_true",
        help="ignore config/patch.yaml entirely",
    )
    ap.add_argument(
        "--patch-strength",
        type=float,
        default=None,
        help="override config/patch.yaml strength; 0 disables the adjustments "
        "while still reporting what they would have been",
    )
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    load_dotenv()

    analysis = pipeline.analyse(
        n_sims=args.sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        half_life_days=args.half_life,
        prior_strength=args.prior_strength,
        elimination_pairing=args.elim_pairing,
        top_rosters=args.top,
        variants=args.variants,
        use_patch=not args.no_patch,
        patch_strength=args.patch_strength,
        enabled_factors=set(pipeline.ALL_FACTORS) - set(args.without),
        verbose=not args.quiet,
    )

    report.print_warnings(analysis)
    if args.only in ("all", "factors"):
        report.print_factor_audit(analysis)
    if args.only in ("all", "ratings"):
        report.print_ratings(analysis)
    if args.only in ("all", "swiss"):
        report.print_swiss(analysis)
    if args.only in ("all", "predictions"):
        report.print_predictions(analysis)
    if args.only in ("all", "fantasy"):
        report.print_fantasy(analysis, variants=args.variants)
    if args.only in ("all", "banners"):
        report.print_banners(analysis)

    path = pipeline.save(analysis)
    report.console.print(f"[dim]full output written to {path}[/dim]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
