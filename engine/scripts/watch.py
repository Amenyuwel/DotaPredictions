"""Unattended check: has anything changed that needs a human?

    python -m scripts.watch            # decide and report
    python -m scripts.watch --force    # ignore the calendar window

Run monthly by .github/workflows/tournament-watch.yml. The exit code IS the
notification:

    0   nothing to do -- out of season, event concluded, or no change
    1   something needs you -- a new league appeared, or a stage is ready to fetch

GitHub emails on a failed workflow run, so exit 1 is the alert and exit 0 is
silence. That is the whole notification design: no issue templates, no secrets,
nothing to configure.

Three things stop it from running pointlessly, in the order they are checked:

    calendar    outside config/watch.yaml's months, there is nothing to find
    concluded   this year's event has finished, and there is one per year
    unchanged   the state matches what the config already says

The first is the weakest guard and deliberately the widest. See watch.yaml for
why the window is April-October rather than the months the event itself lands
in: what is being watched for is the LEAGUE appearing, which precedes the
qualifiers, which precede the event by about two months -- and the qualifier
window is the only moment the roster data can be gathered.

This script reads. It never edits config, never publishes, and never forces a
gate; every one of those is a decision that needs a person looking at a bracket.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dota.config import (  # noqa: E402
    CONFIG_DIR,
    Config,
    active_tournament_id,
    available_tournaments,
    tournament_dir,
)
from dota.sources import OpenDota  # noqa: E402
from scripts.tournament_status import Scaffold, find_leagues, league_activity  # noqa: E402

WATCH_FILE = "watch.yaml"

# "The International 2027" -> 2027. Editions are named by year without exception,
# which is what makes "one per calendar year" checkable rather than assumed.
YEAR_IN_NAME = re.compile(r"\b(20\d{2})\b")

# Tiers worth waking someone for. OpenDota labels the open qualifiers `excluded`
# -- five of them per edition, none of which anyone configures -- and without
# this filter each one reads as an unconfigured league and fires the alert every
# month of the window. The regional qualifiers are `professional` and the event
# itself is `premium`, which are precisely the two that need acting on.
ALERTING_TIERS = frozenset({"premium", "professional"})


def load_watch() -> dict:
    path = CONFIG_DIR / WATCH_FILE
    if not path.is_file():
        raise SystemExit(f"{path} is missing; it decides when this watch runs at all")
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def configured_league_ids() -> set[int]:
    """Every league id named by any tournament config, scaffolds included.

    Read straight from YAML rather than through Config, because a scaffold is
    exactly the state where ids are being filled in one at a time and Config
    refuses to load one.
    """
    ids: set[int] = set()
    for tid in available_tournaments():
        raw = yaml.safe_load(
            (tournament_dir(tid) / "tournament.yaml").read_text(encoding="utf-8")
        ) or {}
        ids.update(int(k) for k in (raw.get("qualifier_leagues") or {}))
        main = raw.get("main_event") or {}
        if isinstance(main, dict) and main.get("league_id"):
            ids.add(int(main["league_id"]))
    return ids


def in_season(month: int, months: list[int]) -> bool:
    """Is this a month in which the next edition could appear?

    An empty list means "always", so deleting the `months:` key turns the window
    off rather than closing it -- config that has been emptied should fail open
    here. Getting this backwards would silence the watch permanently and look
    exactly like nothing happening.
    """
    return not months or month in months


def is_concluded(last_match: datetime, now: datetime, cutoff_days: int) -> bool:
    """Has the event stopped, as opposed to paused between stages?

    The largest gap inside an event is the break between the group stage and the
    main event -- 4 days at TI 2026, 3 at TI 2024 -- so the cutoff has to clear
    that comfortably without waiting so long that a finished event still reads
    as live on the next monthly run.
    """
    return (now - last_match).days > cutoff_days


def report(lines: list[str], *, needs_attention: bool) -> int:
    """Print, and mirror into the workflow's job summary when running in CI."""
    text = "\n".join(lines)
    print(text)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    return 1 if needs_attention else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Monthly check for the next International")
    ap.add_argument("--force", action="store_true", help="ignore the calendar window")
    ap.add_argument("--tournament-id", default="")
    args = ap.parse_args()
    load_dotenv()

    watch = load_watch()
    now = datetime.now(timezone.utc)
    lines = [f"## Tournament watch -- {now:%Y-%m-%d}", ""]

    # ----------------------------------------------------------- 1. calendar
    months = [int(m) for m in (watch.get("months") or [])]
    if not in_season(now.month, months) and not args.force:
        window = ", ".join(str(m) for m in months)
        lines.append(
            f"Out of season: month {now.month} is not in the watch window ({window})."
        )
        lines.append(
            "No International has started outside August-October, and the league "
            "for one appears no earlier than April."
        )
        return report(lines, needs_attention=False)

    tournament_id = args.tournament_id or active_tournament_id()
    od = OpenDota()

    # Config or scaffold: this has to work on a half-filled directory, because
    # that is the state it exists to get you out of.
    cfg: Config | None = None
    scaffold: Scaffold | None = None
    try:
        cfg = Config(tournament_id=tournament_id)
    except ValueError as exc:
        if "still a scaffold" not in str(exc):
            raise
        scaffold = Scaffold(tournament_id)

    if cfg is not None:
        main_event = cfg.tournament.main_event
        main_league = main_event.league_id if main_event else None
        name = cfg.tournament.name
    else:
        assert scaffold is not None
        main_event = None
        main_league = scaffold.main_league_id
        name = scaffold.name or "(unnamed scaffold)"

    lines.append(f"Active tournament: **{tournament_id}** -- {name}")
    lines.append("")

    # ---------------------------------------------------------- 2. concluded
    concluded_year: int | None = None
    if main_league:
        matches = league_activity(od, int(main_league))
        if matches:
            last = max(m.start_time for m in matches)
            idle = (now - last).days
            cutoff = int(watch.get("concluded_after_days", 14))
            if is_concluded(last, now, cutoff):
                concluded_year = last.year
                lines.append(
                    f"League {main_league} last played {last:%Y-%m-%d} "
                    f"({idle} days ago) -- this event has concluded."
                )
            else:
                lines.append(
                    f"League {main_league} is live: {len(matches)} matches, "
                    f"most recent {last:%Y-%m-%d}."
                )
                lines.append("")
                lines.append(
                    "Run `python -m scripts.tournament_status` for the stage verdict, "
                    "and re-fetch rosters between stages."
                )
                return report(lines, needs_attention=True)
        else:
            lines.append(f"League {main_league} is configured but has no matches yet.")

    if (
        concluded_year is not None
        and watch.get("one_per_year", True)
        and concluded_year == now.year
        and not args.force
    ):
        lines.append("")
        lines.append(
            f"There is one International per calendar year and {concluded_year}'s is "
            "over, so there is nothing left to find until January. Not searching."
        )
        return report(lines, needs_attention=False)

    # ---------------------------------------------------------- 3. discovery
    needle = str(watch.get("search") or "The International")
    hits = find_leagues(od, needle)
    known = configured_league_ids()
    fresh = [
        (lid, lname, tier)
        for lid, lname, tier in hits
        if lid not in known
        and tier in ALERTING_TIERS
        and (_named_year(lname) or 0) >= now.year
    ]

    if not fresh:
        lines.append("")
        lines.append(
            f'No unconfigured league matches "{needle}" for {now.year} or later. '
            "The next edition has not been created yet."
        )
        return report(lines, needs_attention=False)

    lines.append("")
    lines.append(f"### New leagues matching \"{needle}\"")
    lines.append("")
    lines.append("| id | name | tier |")
    lines.append("|---|---|---|")
    for lid, lname, tier in fresh[:20]:
        lines.append(f"| {lid} | {lname} | {tier} |")
    lines.append("")
    lines.append(
        "This is the moment to act. Scaffold the event if it does not exist "
        "(`python -m scripts.new_tournament ti<year> --from " + tournament_id + "`), "
        "put these ids in its `tournament.yaml`, and run "
        "`python -m scripts.tournament_status`."
    )
    lines.append("")
    lines.append(
        "The qualifier window is the only chance to gather roster data cleanly -- "
        "it closes about two months before the event."
    )
    return report(lines, needs_attention=True)


def _named_year(league_name: str) -> int | None:
    found = YEAR_IN_NAME.search(league_name)
    return int(found.group(1)) if found else None


if __name__ == "__main__":
    raise SystemExit(main())
