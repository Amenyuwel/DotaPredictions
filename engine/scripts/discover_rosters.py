"""Derive real rosters from match data instead of trusting a scraped page.

Reads the TI 2026 regional qualifier leagues (and optionally the main event
league once Valve creates it), then for each team reports the five accounts
that actually played its most recent games. That is ground truth: it cannot
drift the way a wiki table or a tournament preview does.

    python -m scripts.discover_rosters                # qualifier leagues
    python -m scripts.discover_rosters --league 20100 # add the main event
    python -m scripts.discover_rosters --team "OG"    # one team, recent games

Use the output to correct config/teams.yaml, then rerun scripts.resolve_ids.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota.config import Config
from dota.sources import OpenDota

console = Console()

# OpenDota lane_role on a parsed match: 1 safelane, 2 mid, 3 offlane, 4 jungle.
LANE_LABEL = {1: "safelane", 2: "mid", 3: "offlane", 4: "jungle"}


def team_name(od: OpenDota, team_id: int, cache: dict[int, str]) -> str:
    """`/leagues/{id}/matches` omits team names, so look them up by id."""
    if team_id in cache:
        return cache[team_id]
    try:
        blob = od._get(f"/teams/{team_id}")
        name = (blob or {}).get("name") or str(team_id)
    except Exception:  # noqa: BLE001
        name = str(team_id)
    cache[team_id] = name
    return name


def player_name(od: OpenDota, account_id: int, cache: dict[int, str]) -> str:
    if account_id in cache:
        return cache[account_id]
    try:
        blob = od._get(f"/players/{account_id}")
        prof = (blob or {}).get("profile") or {}
        name = prof.get("name") or prof.get("personaname") or str(account_id)
    except Exception:  # noqa: BLE001
        name = str(account_id)
    cache[account_id] = name
    return name


def main() -> int:
    ap = argparse.ArgumentParser(description="Derive TI 2026 rosters from match data")
    ap.add_argument(
        "--league",
        type=int,
        action="append",
        default=[],
        help="extra league id to include (e.g. the main event once it exists)",
    )
    ap.add_argument("--team", help="only report teams whose name contains this")
    ap.add_argument(
        "--tournament-id",
        default="",
        help="which config/<id>/ to read qualifier leagues from; default: "
        "$DOTA_TOURNAMENT, or the only configured tournament",
    )
    ap.add_argument(
        "--recent",
        type=int,
        default=6,
        help="how many recent matches per team to sample for the roster",
    )
    args = ap.parse_args()
    load_dotenv()

    od = OpenDota()
    # From this event's tournament.yaml, not from a constant in this file. The
    # ids are a property of the tournament being onboarded, and a module
    # constant would quietly survive into the next one.
    cfg = Config(tournament_id=args.tournament_id) if args.tournament_id else Config()
    leagues = dict(cfg.tournament.qualifier_leagues)
    for lid in args.league:
        leagues.setdefault(lid, f"league {lid}")
    if not leagues:
        console.print(
            f"[red]{cfg.tournament_id}/tournament.yaml lists no qualifier_leagues, "
            "and no --league was given. There is nothing to discover from.[/red]"
        )
        return 1

    # team_id -> {name, region, wins, losses, match_ids (newest first)}
    teams: dict[int, dict] = defaultdict(
        lambda: {"name": None, "regions": set(), "wins": 0, "losses": 0, "matches": []}
    )

    for lid, region in leagues.items():
        try:
            matches = od.league_matches(lid)
        except Exception as exc:  # noqa: BLE001
            console.print(f"[yellow]league {lid} ({region}) unavailable: {exc}[/yellow]")
            continue
        console.print(f"[dim]{region}: {len(matches)} matches[/dim]")
        for m in matches:
            for tid, name, won in (
                (m.radiant_team_id, m.radiant_name, m.radiant_win),
                (m.dire_team_id, m.dire_name, not m.radiant_win),
            ):
                if not tid:
                    continue
                rec = teams[int(tid)]
                rec["name"] = rec["name"] or name
                rec["regions"].add(region)
                rec["wins" if won else "losses"] += 1
                rec["matches"].append((m.start_time, m.match_id))

    if not teams:
        console.print("[red]no league data returned[/red]")
        return 1

    team_cache: dict[int, str] = {}
    console.print(f"[dim]resolving {len(teams)} team names ...[/dim]")
    for tid, rec in teams.items():
        rec["name"] = rec["name"] or team_name(od, tid, team_cache)

    ranked = sorted(
        teams.items(), key=lambda kv: (-kv[1]["wins"], kv[1]["losses"], kv[1]["name"] or "")
    )
    if args.team:
        needle = args.team.lower()
        ranked = [r for r in ranked if needle in (r[1]["name"] or "").lower()]

    summary = Table(title="Qualifier participants by record")
    summary.add_column("Team")
    summary.add_column("team_id", justify="right")
    summary.add_column("Region")
    summary.add_column("W-L", justify="right")
    for tid, rec in ranked:
        summary.add_row(
            escape(rec["name"] or "?"),
            str(tid),
            ", ".join(sorted(rec["regions"])),
            f"{rec['wins']}-{rec['losses']}",
        )
    console.print(summary)

    name_cache: dict[int, str] = {}
    for tid, rec in ranked:
        rec["matches"].sort(reverse=True)
        sample = [mid for _, mid in rec["matches"][: args.recent]]
        appearances: Counter[int] = Counter()
        lanes: dict[int, Counter[int]] = defaultdict(Counter)

        for mid in sample:
            try:
                detail = od.match_detail(mid)
            except Exception:  # noqa: BLE001
                continue
            radiant_is_us = detail.get("radiant_team_id") == tid
            for p in detail.get("players") or []:
                on_radiant = p.get("isRadiant")
                if on_radiant is None:
                    on_radiant = int(p.get("player_slot", 0)) < 128
                if bool(on_radiant) != radiant_is_us:
                    continue
                acc = p.get("account_id")
                if acc is None:
                    continue
                appearances[int(acc)] += 1
                if p.get("lane_role"):
                    lanes[int(acc)][int(p["lane_role"])] += 1

        t = Table(
            title=f"{escape(rec['name'] or '?')} (team_id={tid}) "
            f"- from {len(sample)} recent games",
            title_justify="left",
            show_edge=False,
        )
        t.add_column("account_id", justify="right")
        t.add_column("Name")
        t.add_column("Games", justify="right")
        t.add_column("Usual lane")
        for acc, count in appearances.most_common(7):
            lane = lanes[acc].most_common(1)
            t.add_row(
                str(acc),
                escape(player_name(od, acc, name_cache)),
                str(count),
                LANE_LABEL.get(lane[0][0], "-") if lane else "-",
            )
        console.print(t)
        console.print()

    console.print(
        "[dim]Lane is inferred from replay parsing and does not distinguish soft "
        "from hard support -- set those two by hand in config/teams.yaml.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
