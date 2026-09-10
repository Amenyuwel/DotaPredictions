"""Is this event's data there yet, and which stage can be published?

    python -m scripts.tournament_status
    python -m scripts.tournament_status --tournament-id ti2027
    python -m scripts.tournament_status --search "International 2027"

The gates in `scripts/gates.py` refuse a run that is published too early. They do
not tell you when to go and look, and that is the gap this fills: it asks
OpenDota what actually exists right now and reports it, so the decision to fetch
rosters is made against observation instead of against a calendar.

The distinction this script keeps everywhere is between what is OBSERVED and what
is INFERRED, the same split `factors.FactorReport` keeps between data and
assumption. Two things are genuinely observable -- a league exists, and matches
have been played under it -- and one is not: OpenDota's match rows carry no stage
label, so "the group stage is over" cannot be read off the API. It can only be
guessed at from the field narrowing, and a guess is printed as a guess.

Nothing here publishes and nothing here writes config. It reads.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml  # noqa: E402

from dota.config import Config, active_tournament_id, tournament_dir  # noqa: E402
from dota.sources import OpenDota  # noqa: E402
from dota.sources.base import MatchResult  # noqa: E402

console = Console()

# A league with fewer matches than this has been created but not played. Series
# are 2-3 games, so a single completed Bo3 clears it and an empty shell does not.
PLAYED_THRESHOLD = 3


class Scaffold:
    """What can be read off a tournament.yaml that is still full of TODOs.

    `dota.config` refuses to build a Config from a scaffold, and it should: every
    consumer of a Config computes numbers, and a half-filled config produces
    confident wrong ones. This script is the exception that proves it, because
    it computes nothing -- it asks "does this event exist on OpenDota yet", which
    is the question you have *before* you can fill anything in.

    So the placeholder guard is not bypassed, it is caught, and what comes back
    is a deliberately tiny object: a name to search for and whatever league ids
    have been filled in so far. There is no roster here and no format, because
    nothing in a scaffold can answer for either.
    """

    def __init__(self, tournament_id: str):
        raw = yaml.safe_load(
            (tournament_dir(tournament_id) / "tournament.yaml").read_text(encoding="utf-8")
        ) or {}
        name = str(raw.get("name") or "")
        self.tournament_id = tournament_id
        self.name = "" if name.strip() == "TODO" else name
        self.qualifier_leagues = {
            int(k): str(v) for k, v in (raw.get("qualifier_leagues") or {}).items()
        }
        main = raw.get("main_event") or {}
        self.main_league_id = main.get("league_id") if isinstance(main, dict) else None


def find_leagues(od: OpenDota, needle: str) -> list[tuple[int, str, str]]:
    """Leagues whose name contains `needle`, newest id first.

    Ids increase over time, so the newest matching league is the most likely
    edition -- but every match is printed rather than one being chosen, because
    "The International 2027" and "The International 2027 Regional Qualifiers"
    both match and they are different leagues with different data.
    """
    try:
        rows = od.leagues()
    except Exception as exc:  # noqa: BLE001 - degrade, never fail the run
        console.print(f"[yellow]could not list leagues: {exc}[/yellow]")
        return []
    needle = needle.lower().strip()
    hits = [
        (lid, str(r.get("name") or ""), str(r.get("tier") or "unknown"))
        for lid, r in rows.items()
        if needle in str(r.get("name") or "").lower()
    ]
    return sorted(hits, key=lambda h: -h[0])


def league_activity(od: OpenDota, league_id: int) -> list[MatchResult]:
    try:
        return od.league_matches(league_id)
    except Exception as exc:  # noqa: BLE001 - degrade, never fail the run
        console.print(f"[yellow]league {league_id}: could not read matches: {exc}[/yellow]")
        return []


def team_ids(matches: list[MatchResult]) -> Counter:
    """team_id -> games played, from the league listing.

    By id, not by name, and not by choice: `/leagues/{id}/matches` returns no
    usable team name at all -- 0 of 147 rows carried one on the TI 2026 main
    event -- while every row carries both team ids.

    That turns out to be the better key regardless. Orgs rebrand mid-season and
    play under second banners, which is why `overrides.yaml` pins ids in the
    first place; comparing ids sidesteps the alias problem instead of inheriting
    it.
    """
    seen: Counter = Counter()
    for m in matches:
        for tid in (m.radiant_team_id, m.dire_team_id):
            if tid:
                seen[int(tid)] += 1
    return seen


def describe_league(name: str, league_id: int, matches: list[MatchResult]) -> dict:
    """One league's observable state. Every field here is measured, not guessed."""
    if not matches:
        return {
            "label": name,
            "league_id": league_id,
            "matches": 0,
            "first": None,
            "last": None,
            "teams": Counter(),
        }
    starts = [m.start_time for m in matches]
    return {
        "label": name,
        "league_id": league_id,
        "matches": len(matches),
        "first": min(starts),
        "last": max(starts),
        "teams": team_ids(matches),
    }


def render_leagues(rows: list[dict]) -> None:
    table = Table(title="Observed on OpenDota", title_justify="left")
    table.add_column("league")
    table.add_column("id", justify="right")
    table.add_column("matches", justify="right")
    table.add_column("window")
    table.add_column("teams", justify="right")
    for row in rows:
        window = (
            f"{row['first']:%Y-%m-%d} .. {row['last']:%Y-%m-%d}"
            if row["first"]
            else "[dim]nothing played[/dim]"
        )
        table.add_row(
            row["label"],
            str(row["league_id"]),
            str(row["matches"]),
            window,
            str(len(row["teams"])) if row["teams"] else "-",
        )
    console.print(table)


def compare_roster(cfg: Config, seen: Counter) -> tuple[list[str], list[int]]:
    """Configured teams absent from the data, and team ids the config does not know.

    The second list is the interesting one when onboarding: those are the
    qualifier winners nobody has added to teams.yaml yet. During a running event
    it means something different and worse -- an org playing under an id the
    config has never seen, which is the exact shape of the costliest bug on
    record, caught here before a rating is ever fitted to it.
    """
    known_ids: dict[int, str] = {}
    for team in cfg.roster.teams:
        if team.team_id:
            known_ids[int(team.team_id)] = team.name
    for tid, name in cfg.roster.extra_team_ids.items():
        known_ids[int(tid)] = name

    played = {known_ids[tid] for tid in seen if tid in known_ids}
    missing = sorted(set(cfg.roster.names) - played)
    # Only ids with real presence: one appearance is a stand-in roster or a
    # mis-parse, not a participant nobody configured.
    unknown = sorted(
        tid for tid, count in seen.items()
        if tid not in known_ids and count >= PLAYED_THRESHOLD
    )
    return missing, unknown


def main() -> int:
    ap = argparse.ArgumentParser(description="What of this event exists on OpenDota yet")
    ap.add_argument("--tournament-id", default="")
    ap.add_argument(
        "--search",
        default="",
        help="find league ids by name; default: the tournament's configured name",
    )
    ap.add_argument(
        "--recent-days",
        type=int,
        default=7,
        help="window used to guess which stage is currently being played",
    )
    args = ap.parse_args()
    load_dotenv()

    tournament_id = args.tournament_id or active_tournament_id()
    od = OpenDota()
    now = datetime.now(timezone.utc)

    cfg: Config | None = None
    try:
        cfg = Config(tournament_id=tournament_id)
    except ValueError as exc:
        # A scaffold. Not an error here -- see Scaffold's docstring.
        if "still a scaffold" not in str(exc):
            raise
        scaffold = Scaffold(tournament_id)
        console.print(
            f"\n[bold]{tournament_id}[/bold]  "
            f"{scaffold.name or '[dim](unnamed scaffold)[/dim]'}\n"
        )
        console.print(
            "[yellow]This tournament is still a scaffold[/yellow], so only league "
            "discovery is available -- there is no roster to check against yet.\n"
        )

    if cfg is not None:
        console.print(f"\n[bold]{cfg.tournament_id}[/bold]  {cfg.tournament.name}\n")
        qualifiers = cfg.tournament.qualifier_leagues
        main_event = cfg.tournament.main_event
        main_league = main_event.league_id if main_event else None
        search_name = cfg.tournament.name
    else:
        qualifiers = scaffold.qualifier_leagues
        main_event = None
        main_league = scaffold.main_league_id
        search_name = scaffold.name

    # ---------------------------------------------------------------- leagues
    configured: list[tuple[int, str]] = [(lid, region) for lid, region in qualifiers.items()]
    if main_league:
        configured.append((int(main_league), "main event"))

    if not configured:
        console.print(
            "[yellow]No league ids configured.[/yellow] Until they are, nothing about "
            "this event can be observed.\n"
        )
        needle = args.search or search_name
        if needle:
            hits = find_leagues(od, needle)
            if hits:
                table = Table(title=f'Leagues matching "{needle}"', title_justify="left")
                table.add_column("id", justify="right")
                table.add_column("name")
                table.add_column("tier")
                for lid, name, tier in hits[:15]:
                    table.add_row(str(lid), name, tier)
                console.print(table)
                console.print(
                    "\nPut the qualifier ids under [bold]qualifier_leagues[/bold] and the "
                    "event's own id under [bold]main_event.league_id[/bold] in "
                    f"{tournament_id}/tournament.yaml, then run this again."
                )
            else:
                console.print(
                    f'Nothing on OpenDota matches "{needle}" yet. The league is usually '
                    "created shortly before the first qualifier game."
                )
        else:
            console.print(
                "No name to search for. Set `name:` in tournament.yaml, or pass "
                "--search \"The International 2027\"."
            )
        return 0

    if cfg is None:
        console.print(
            "League ids are configured, but the rest of this scaffold is not filled "
            "in. Complete tournament.yaml to see the roster check and the verdict."
        )
        return 0

    rows = []
    by_league: dict[int, list[MatchResult]] = {}
    for league_id, label in configured:
        matches = league_activity(od, league_id)
        by_league[league_id] = matches
        rows.append(describe_league(label, league_id, matches))
    render_leagues(rows)

    all_matches = sum(r["matches"] for r in rows)

    # ---------------------------------------------------------------- roster
    #
    # Scoped to the EVENT's own league, never to the qualifiers. A regional
    # qualifier contains every team that tried and failed, so "played here but
    # is not in teams.yaml" describes almost all of them and means nothing. In
    # the event league it means the opposite: sixteen teams play and all sixteen
    # should be configured, so an unknown id there is a real finding.
    event_league = int(main_event.league_id) if main_event and main_event.league_id else None
    if event_league is None:
        console.print(
            "\n[bold]Roster check[/bold]  [dim]unavailable: tournament.yaml has no "
            "main_event.league_id, and a qualifier league cannot answer this -- it "
            "is full of teams that did not qualify.[/dim]"
        )
    else:
        seen = team_ids(by_league.get(event_league, []))
        missing, unknown = compare_roster(cfg, seen)
        if not seen:
            console.print(
                "\n[bold]Roster check[/bold]  [dim]no matches played under league "
                f"{event_league} yet[/dim]"
            )
        else:
            console.print(
                f"\n[bold]Roster check[/bold]  against league {event_league}: "
                f"{len(cfg.roster.names) - len(missing)}/{len(cfg.roster.names)} "
                f"configured teams have played"
            )
            if missing:
                console.print(f"  not seen: {', '.join(missing)}")
            if unknown:
                console.print(
                    f"  [red]team ids playing but not configured:[/red] "
                    f"{', '.join(str(t) for t in unknown)}\n"
                    "  [dim]add them to teams.yaml, or pin a second banner in "
                    "overrides.yaml. An unconfigured id that plays is how a team "
                    "gets rated on no evidence at all.[/dim]"
                )

    # ---------------------------------------------------------------- verdict
    console.print("\n[bold]Verdict[/bold]")

    roster_ready = cfg.roster.verified and len(cfg.roster.teams) == cfg.tournament.n_teams
    if all_matches < PLAYED_THRESHOLD:
        console.print(
            "  group stage   [yellow]NOT READY[/yellow]  "
            f"only {all_matches} match(es) played under the configured leagues"
        )
    elif not roster_ready:
        console.print(
            "  group stage   [yellow]FETCH NOW[/yellow]   "
            "matches exist and the roster is not confirmed -- run "
            "scripts.discover_rosters, then scripts.resolve_ids, then set "
            "verified_utc"
        )
    else:
        console.print(
            "  group stage   [green]READY[/green]      "
            "matches exist and the roster is confirmed"
        )

    if main_event is None or not main_event.pairings:
        console.print(
            "  main event    [yellow]NOT READY[/yellow]  "
            "no bracket in tournament.yaml. It is drawn only after the group stage "
            "resolves, and it has to be transcribed by hand -- the draw is not in "
            "any API"
        )
    elif cfg.roster.verified_utc and cfg.roster.verified_utc < cfg.tournament.lock_utc:
        console.print(
            "  main event    [yellow]FETCH AGAIN[/yellow]  "
            f"bracket is drawn, but the roster was last checked "
            f"{cfg.roster.verified_utc:%Y-%m-%d}, before the group stage locked"
        )
    else:
        console.print("  main event    [green]READY[/green]      bracket drawn, roster current")

    # ------------------------------------------------------- inference, labelled
    #
    # OpenDota's match rows carry no stage label, so this is the one number here
    # that is a guess. Printed as a guess: a narrowing field is consistent with a
    # group stage ending, and equally consistent with a quiet week.
    recent = [
        m
        for matches in by_league.values()
        for m in matches
        if m.start_time > now - timedelta(days=args.recent_days)
    ]
    if recent:
        active = len(team_ids(recent))
        console.print(
            f"\n[dim]Inference (not data): {len(recent)} match(es) in the last "
            f"{args.recent_days} days between {active} distinct teams. A drop toward "
            f"{main_event.n_teams if main_event else 8} is consistent with the group "
            "stage having finished -- OpenDota does not label stages, so confirm "
            "against the bracket before transcribing it.[/dim]"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
