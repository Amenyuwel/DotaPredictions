"""Terminal reports."""
from __future__ import annotations

import math

from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.table import Table

from . import patch as patch_mod
from .optimize import FantasyRoster
from .pipeline import Analysis

console = Console()

# Player nicks are hostile to rich's markup parser -- "No[o]ne" reads as a
# style tag and silently vanishes. Everything sourced from config or an API
# goes through escape().


def print_warnings(analysis: Analysis) -> None:
    warns = analysis.config.warnings()
    weak = [
        f"{s} ({cov:.0%} of sampled games)"
        for s, cov in sorted(analysis.corpus.stat_coverage.items())
        if cov < 0.5
    ]
    if weak:
        warns.append("Low stat coverage, these barely move projections: " + ", ".join(weak))
    warns.extend(patch_mod.describe(analysis.patch))
    warns.extend(analysis.corpus.source_notes)
    if warns:
        console.print(
            Panel(
                "\n".join(f"- {escape(w)}" for w in warns),
                title="[bold yellow]Read this before locking picks",
                border_style="yellow",
            )
        )


def print_ratings(analysis: Analysis) -> None:
    ours = set(analysis.config.roster.names)
    t = Table(title="Team strength (Bradley-Terry, recency weighted)")
    t.add_column("#", justify="right")
    t.add_column("Team")
    t.add_column("Rating", justify="right")
    t.add_column("vs field", justify="right")
    t.add_column("Results used", justify="right")
    rows = [r for r in analysis.ratings.table() if r[0] in ours]
    avg = sum(v for _, v, _ in rows) / len(rows)
    for i, (team, val, games) in enumerate(rows, 1):
        # Win prob for one game against a hypothetical average team in the field.
        p = 1.0 / (1.0 + math.exp(-(val - avg)))
        t.add_row(str(i), escape(team), f"{val:+.2f}", f"{p:.0%}", str(games))
    console.print(t)


def print_swiss(analysis: Analysis) -> None:
    o = analysis.outcome
    t = Table(title=f"Swiss group-stage outcome probabilities ({o.n_sims:,} sims)")
    t.add_column("Team")
    t.add_column("4-0", justify="right")
    t.add_column("4-1", justify="right")
    t.add_column("Elim W", justify="right")
    t.add_column("Elim L", justify="right")
    t.add_column("1-4", justify="right")
    t.add_column("0-4", justify="right")
    t.add_column("Advance", justify="right")
    t.add_column("E[games]", justify="right")
    for team in sorted(o.teams, key=lambda x: -o.advance_prob[x]):
        p = o.bucket_prob[team]
        t.add_row(
            escape(team),
            f"{p['undefeated']:.1%}",
            f"{p['four_one']:.1%}",
            f"{p['elim_winner']:.1%}",
            f"{p['elim_loser']:.1%}",
            f"{p['one_four']:.1%}",
            f"{p['winless']:.1%}",
            f"[bold]{o.advance_prob[team]:.1%}[/bold]",
            f"{o.expected_games[team]:.1f}",
        )
    console.print(t)


def print_predictions(analysis: Analysis) -> None:
    plan = analysis.predictions
    t = Table(
        title=(
            f"Predictions grid - optimal assignment "
            f"(E[correct] = {plan.expected_correct:.2f} / {plan.n_slots})"
        )
    )
    t.add_column("Slot")
    t.add_column("Pick")
    t.add_column("P(correct)", justify="right")
    t.add_column("Runners-up")
    alts = analysis.alternatives
    for pick in plan.picks:
        others = [
            f"{escape(team)} {p:.0%}"
            for team, p in alts[pick.bucket_id]
            if team != pick.team
        ][:2]
        t.add_row(
            escape(pick.bucket_label),
            f"[bold]{escape(pick.team)}[/bold]",
            f"{pick.probability:.1%}",
            ", ".join(others),
        )
    console.print(t)
    console.print(
        "[dim]Assignment is jointly optimal, not per-row greedy: a team can only "
        "fill one slot, so the best single-slot pick sometimes goes elsewhere.[/dim]"
    )
    print_prediction_variants(analysis)


def print_prediction_variants(analysis: Analysis) -> None:
    """Grids 2..k as swaps against grid 1.

    Printed as differences rather than as k full tables: the alternatives are
    near-ties that move one or two teams, and sixteen repeated rows would bury
    the only part that differs.
    """
    grids = analysis.prediction_variants
    if len(grids) < 2:
        return
    best = grids[0]

    t = Table(
        title=f"Alternative grids - next {len(grids) - 1} best legal assignments"
    )
    t.add_column("#", justify="right")
    t.add_column("E[correct]", justify="right")
    t.add_column("vs best", justify="right")
    t.add_column("Changes from grid 1")
    for i, plan in enumerate(grids, 1):
        swaps = (
            "[dim]-[/dim]"
            if i == 1
            else "\n".join(
                f"{escape(label)}: {escape(was)} -> [bold]{escape(now)}[/bold]"
                for label, was, now in plan.diff_vs(best)
            )
        )
        t.add_row(
            str(i),
            f"{plan.expected_correct:.3f}",
            "[dim]-[/dim]"
            if i == 1
            else f"{plan.expected_correct - best.expected_correct:+.3f}",
            swaps,
        )
    console.print(t)
    console.print(
        "[dim]These are the next-best whole grids, not per-row runners-up. Each "
        "is internally consistent; picking rows from different grids is not.[/dim]"
    )


def print_roster_banners(analysis: Analysis, roster: FantasyRoster) -> None:
    """The three banners one roster should chase, with the runner-up emblems.

    Three, not five: a banner belongs to a role SLOT and is shared by both
    players in a duo, because the duo's score is their average through the same
    three emblems.
    """
    cfg = analysis.config
    keys = (
        f"support/{roster.support_team}",
        f"core/{roster.core_team}",
        f"mid/{roster.mid_team}",
    )
    for key in keys:
        s = analysis.slots.get(key)
        if not s or not s.banner:
            continue
        b = Table(
            title=f"{s.slot.upper()} banner - {escape(s.team)} ({escape(s.label)}), "
            f"{s.matches_sampled} matches sampled",
            title_justify="left",
            show_edge=False,
        )
        b.add_column("Colour")
        b.add_column("Take")
        b.add_column("Per game", justify="right")
        b.add_column("Points", justify="right")
        b.add_column("Next best")
        for color in cfg.scoring.colors:
            c = s.banner.choices.get(color)
            if not c:
                continue
            alts = ", ".join(
                f"{escape(r.label)} {r.base_points:,.0f}"
                for r in s.banner.runners_up.get(color, [])[:2]
            )
            b.add_row(
                color.upper(),
                f"[bold]{escape(c.label)}[/bold]",
                f"{c.per_game_value:,.2f}",
                f"{c.base_points:,.0f}",
                alts,
            )
        console.print(b)
        console.print()


def print_fantasy(analysis: Analysis, top_players: int = 12, variants: int = 5) -> None:
    t = Table(title="Top fantasy rosters (sum of each player's E[best game])")
    t.add_column("#", justify="right")
    t.add_column("Supports (duo)")
    t.add_column("Cores (duo)")
    t.add_column("Mid")
    t.add_column("Projected", justify="right")
    for i, r in enumerate(analysis.rosters, 1):
        t.add_row(
            str(i),
            escape(r.support_team),
            escape(r.core_team),
            escape(f"{r.mid_player} ({r.mid_team})"),
            f"{r.projected_total:,.0f}",
        )
    console.print(t)

    console.print(
        "[dim]Players score ONLY their three War Banner stats. Role scores are "
        "averaged across the duo, a series counts its top two games, and the "
        "best series counts for the period.[/dim]"
    )

    for slot, title in (
        ("support", "Support duos"),
        ("core", "Core duos"),
        ("mid", "Mids"),
    ):
        rows = sorted(
            (s for s in analysis.slots.values() if s.slot == slot),
            key=lambda s: -s.projected,
        )
        t = Table(title=f"{title} - projected best series")
        t.add_column("Team")
        t.add_column("Players")
        t.add_column("Per game", justify="right")
        t.add_column("SD", justify="right")
        t.add_column("Best series", justify="right")
        t.add_column("Sample", justify="right")
        for s in rows[:8]:
            t.add_row(
                escape(s.team),
                escape(s.label),
                f"{s.mean_game:,.0f}",
                f"{s.sd_game:,.0f}",
                f"[bold]{s.projected:,.0f}[/bold]",
                f"{s.matches_sampled}m",
            )
        console.print(t)

    for i, r in enumerate(analysis.rosters[:variants], 1):
        console.rule(
            f"[bold]Roster #{i}[/bold] - supports {escape(r.support_team)} | "
            f"cores {escape(r.core_team)} | mid {escape(r.mid_player)} "
            f"({escape(r.mid_team)}) - {r.projected_total:,.0f}"
        )
        print_roster_banners(analysis, r)


def print_banners(analysis: Analysis, slot_keys: list[str] | None = None) -> None:
    """The three emblems each ROLE SLOT should chase. One banner per slot."""
    scoring = analysis.config.scoring
    slots = analysis.slots
    keys = slot_keys or sorted(slots, key=lambda k: -slots[k].projected)[:12]

    t = Table(title="Optimal War Banner emblems (bare-emblem points per game)")
    t.add_column("Slot")
    t.add_column("Team")
    t.add_column("RED")
    t.add_column("BLUE")
    t.add_column("GREEN")
    for k in keys:
        s = slots.get(k)
        if not s or not s.banner:
            continue
        cells = []
        for color in scoring.colors:
            c = s.banner.choices.get(color)
            cells.append(
                f"{escape(c.label)}\n[dim]{c.base_points:,.0f}[/dim]" if c else "-"
            )
        t.add_row(s.slot, escape(s.team), *cells)
    console.print(t)
    console.print(
        "[dim]One banner per role slot, shared by both players in a duo, so "
        "these are fitted to the pair's combined stats rather than to either "
        "player alone.[/dim]"
    )


_KIND_STYLE = {
    "data": ("[green]measured[/green]", "fitted from the corpus"),
    "assumption": ("[yellow]assumed[/yellow]", "hand-entered magnitude"),
    "absent": ("[red]missing[/red]", "not modelled at all"),
}


def print_factor_audit(analysis: Analysis) -> None:
    """Every input to a projection, and whether it is measured or asserted.

    The point is to make the assumption budget visible. A number that comes from
    5,842 fitted observations and a number somebody typed into a YAML file look
    identical once they reach the projection, and they should not.
    """
    t = Table(title="Factor audit - what the projections are actually built on")
    t.add_column("Factor")
    t.add_column("Status")
    t.add_column("Evidence")
    for r in analysis.factor_reports:
        if not r.enabled:
            status = "[dim]off[/dim]" if r.kind != "absent" else _KIND_STYLE["absent"][0]
        else:
            status = _KIND_STYLE[r.kind][0]
        t.add_row(escape(r.name), status, escape(r.evidence))
    console.print(t)

    for r in analysis.factor_reports:
        if not (r.enabled and r.detail):
            continue
        bits = r.detail.get("largest") or r.detail.get("strongest")
        if bits:
            console.print(f"[dim]  {r.name}: {escape(', '.join(map(str, bits)))}[/dim]")
        if r.name == "hero":
            console.print(
                f"[dim]  hero: {r.detail['games_reweighted']:,} of "
                f"{r.detail['games_reweighted'] / max(r.detail['share_of_corpus'], 1e-9):,.0f} "
                f"games reweighted ({r.detail['share_of_corpus']:.1%} of corpus)[/dim]"
            )
    console.print(
        "[dim]measured = fitted from data in this corpus. assumed = a magnitude "
        "typed by a human, traceable to config/. missing = not modelled; treat "
        "any claim that depends on it as unsupported.[/dim]"
    )


def print_all(analysis: Analysis) -> None:
    print_warnings(analysis)
    print_factor_audit(analysis)
    print_ratings(analysis)
    print_swiss(analysis)
    print_predictions(analysis)
    print_fantasy(analysis)
    print_banners(analysis)
