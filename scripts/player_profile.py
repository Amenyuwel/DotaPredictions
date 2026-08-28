"""What does a player actually produce, per game?

Built for War Banner tuning: the banner multiplies specific stats, so it is
only worth what the player already generates. A 240% STUNS banner on someone
who plays no stun heroes multiplies almost nothing.

    python -m scripts.player_profile "No[o]ne"
    python -m scripts.player_profile "No[o]ne" --compare-role mid
    python -m scripts.player_profile Whitemon --heroes 15

Percentiles are against the other TI 2026 players in the same role, which is
the comparison that matters when choosing between banner stats.
"""
from __future__ import annotations

import argparse
from collections import Counter

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota.config import Config
from dota.pipeline import build_corpus
from dota.sources import OpenDota

console = Console()

# Stats a War Banner can plausibly key on, in the order the client groups them.
BANNER_STATS = [
    ("gold_per_min", "GPM"),
    ("xp_per_min", "XPM"),
    ("kills", "Kills"),
    ("deaths", "Deaths"),
    ("last_hits_denies", "LH+DN"),
    ("seconds_stunned", "Stun seconds"),
    ("smokes_used", "Smokes used"),
    ("teamfight_participation", "Teamfight %"),
    ("observer_wards_planted", "Obs wards"),
    ("sentry_wards_planted", "Sentry wards"),
    ("camps_stacked", "Camps stacked"),
    ("rune_pickups", "Runes"),
    ("tower_kills", "Tower kills"),
    ("roshan_kills", "Roshan kills"),
    ("observer_kills", "Wards killed"),
    ("neutral_kills", "Neutral kills"),
]


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Per-game stat profile for a player")
    ap.add_argument("nick", help="config nickname, e.g. \"No[o]ne\"")
    ap.add_argument("--heroes", type=int, default=12, help="how many heroes to list")
    ap.add_argument(
        "--compare-role",
        default=None,
        help="role to rank against (defaults to the player's own role)",
    )
    ap.add_argument("--history-days", type=int, default=180)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    target = next(
        (p for p in cfg.roster.all_players() if p.nick.lower() == args.nick.lower()),
        None,
    )
    if target is None:
        console.print(f"[red]{escape(args.nick)} not in config/teams.yaml[/red]")
        console.print("known: " + ", ".join(escape(p.nick) for p in cfg.roster.all_players()))
        return 1
    if not target.account_id:
        console.print(f"[red]{escape(target.nick)} has no account_id[/red] - run scripts.resolve_ids")
        return 1

    corpus = build_corpus(cfg, history_days=args.history_days, verbose=True)
    games = corpus.player_games.get(target.account_id, [])
    if not games:
        console.print(f"[red]no games found for {escape(target.nick)}[/red]")
        return 1

    role = args.compare_role or target.role
    peers = [
        p
        for p in cfg.roster.all_players()
        if p.role == role and p.account_id and p.account_id != target.account_id
    ]

    console.print(
        f"\n[bold]{escape(target.nick)}[/bold] - {escape(target.team)}, {target.role} "
        f"- {len(games)} games in the last {args.history_days} days\n"
    )

    t = Table(title=f"Per-game averages, and rank among the {len(peers) + 1} {role}s at TI")
    t.add_column("Stat")
    t.add_column("Per game", justify="right")
    t.add_column("Role avg", justify="right")
    t.add_column("Rank", justify="right")
    t.add_column("")

    for key, label in BANNER_STATS:
        mine = mean([g.stats[key] for g in games if key in g.stats])
        if mine is None:
            t.add_row(label, "[dim]not tracked[/dim]", "", "", "")
            continue

        peer_means = []
        for p in peers:
            pg = corpus.player_games.get(p.account_id or -1, [])
            m = mean([g.stats[key] for g in pg if key in g.stats])
            if m is not None:
                peer_means.append(m)

        if not peer_means:
            t.add_row(label, f"{mine:,.2f}", "-", "-", "")
            continue

        # Deaths are the one stat where lower is better.
        better = (lambda a, b: a < b) if key == "deaths" else (lambda a, b: a > b)
        rank = 1 + sum(1 for m in peer_means if better(m, mine))
        total = len(peer_means) + 1
        pct = 1.0 - (rank - 1) / total

        if pct >= 0.75:
            bar, colour = "strong", "green"
        elif pct >= 0.4:
            bar, colour = "average", "yellow"
        else:
            bar, colour = "weak", "red"

        t.add_row(
            label,
            f"{mine:,.2f}",
            f"{mean(peer_means):,.2f}",
            f"{rank}/{total}",
            f"[{colour}]{bar}[/{colour}]",
        )
    console.print(t)

    # Hero pool: banner stats like stuns are a function of what he actually picks.
    od = OpenDota()
    try:
        heroes = {int(h["id"]): h["localized_name"] for h in od._get("/heroes")}
    except Exception:  # noqa: BLE001
        heroes = {}

    picks: Counter[int] = Counter(g.hero_id for g in games if g.hero_id)

    if picks:
        h = Table(title=f"{escape(target.nick)} hero pool ({sum(picks.values())} games)")
        h.add_column("Hero")
        h.add_column("Games", justify="right")
        h.add_column("Share", justify="right")
        total_picks = sum(picks.values())
        for hid, n in picks.most_common(args.heroes):
            h.add_row(
                escape(heroes.get(hid, f"hero {hid}")),
                str(n),
                f"{n / total_picks:.0%}",
            )
        console.print(h)
    else:
        console.print("[yellow]hero pool unavailable from cached data[/yellow]")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
