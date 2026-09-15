"""Scaffold the config directory for a new event.

    python -m scripts.new_tournament ti2027
    python -m scripts.new_tournament ti2027 --from ti2026   # copy shapes across

What this does NOT do is invent data. Every file it writes is either a shape
with `TODO` where a number belongs, or a copy of the previous event's file with
the event-specific parts stripped. The distinction matters because this project's
one property is that a wrong number does not raise: a scaffolded `teams.yaml`
full of last year's rosters would produce a confident, completely wrong
projection, while an empty one fails at the first gate.

So the scaffold is deliberately unusable until filled in. `scripts/gates.py`
already refuses to publish a run whose accounts do not resolve, whose teams have
too little evidence, or whose scoring table is not marked verified against the
client -- and a fresh directory fails all three.

What carries over safely, and why:

    scoring.yaml    the stat table's SHAPE, with verified_against_client reset
                    to false. Valve changes point values between events and a
                    table copied forward and never re-checked is the exact thing
                    that gate exists to catch.
    tournament.yaml the format, with the bracket, lock times and league ids
                    blanked. A format usually survives a year; a draw never does.
    patch.yaml      empty, with the comment explaining why claiming a team got
                    stronger from a patch with no post-patch results moves the
                    grid more than anything measured.
    teams.yaml      the slots, with no players. Fill it by hand, or run
                    scripts/discover_rosters.py once the qualifiers finish.
    banners.yaml    empty. Nobody has rolled anything yet.
    overrides.yaml  empty. scripts/resolve_ids.py writes this.

hero_adjectives.yaml is NOT copied: it is global, because it comes from the game
client rather than from an event.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dota.config import CONFIG_DIR, GLOBAL_CONFIG, available_tournaments  # noqa: E402

SCAFFOLD_FILES = (
    "tournament.yaml",
    "teams.yaml",
    "scoring.yaml",
    "banners.yaml",
    "patch.yaml",
    "overrides.yaml",
)

BANNERS_STUB = """# The War Banners you actually rolled, transcribed from the client.
#
# Empty until you have rolled. `displayed` is the percentage the client shows as
# a multiplier (300% -> 3.00); it is redundant with what dota/emblems.py derives
# from tier + trait + neighbours, and that redundancy is the check --
# tests/test_emblems.py fails if the two disagree.
#
# Order is meaningful: Vampiric charges each neighbour -10%, Benevolent pays each
# neighbour +20%. List emblems TOP TO BOTTOM as the client draws them.

# core:
#   emblems:
#     - {stat: gold_per_min, tier: tier_v, trait: vampiric, displayed: 3.00}
"""

PATCH_STUB = """# Gameplay-patch prior, hand-entered, one comment per line explaining the source.
#
# `team_rating_delta` is intentionally left empty until there are post-patch
# results to fit it on. Claiming a team got stronger from a patch with no
# evidence moves the prediction grid more than anything actually measured.

version: ""            # e.g. "7.41e"
released_utc: ""
source: ""             # the patch notes URL you read
strength: 1.0

source_field_multipliers: {}
team_rating_delta: {}
"""

OVERRIDES_STUB = """# Pinned ids, written by scripts/resolve_ids.py. Hand-edit only to correct a
# resolution it got wrong -- and if you do, say why on the line above it.

teams: {}
players: {}
"""

TEAM_SLOT = """  - name: "TODO team {n}"
    players:
      - {{nick: "TODO", role: carry}}
      - {{nick: "TODO", role: mid}}
      - {{nick: "TODO", role: offlane}}
      - {{nick: "TODO", role: soft_support}}
      - {{nick: "TODO", role: hard_support}}"""


def blank_teams(n_teams: int) -> str:
    slots = "\n".join(TEAM_SLOT.format(n=i + 1) for i in range(n_teams))
    return (
        f"# The {n_teams} teams and their five players each.\n"
        "#\n"
        "# `verified` stays false until you have checked every roster against the\n"
        "# client or a broadcast -- scripts/gates.py refuses to publish while it is\n"
        "# false, and a stale roster is this project's most expensive failure: it\n"
        "# produces a confident wrong number and no error at all.\n"
        "#\n"
        "# Fill these by hand, or run `python -m scripts.discover_rosters` once the\n"
        "# qualifiers have finished and their league ids are in tournament.yaml.\n"
        "#\n"
        "# `verified_utc` is the day you ACTUALLY checked, and it is not optional:\n"
        "# gates.roster_freshness refuses a roster with no date, one older than\n"
        "# --max-roster-age, and -- for a Main Event run -- one last checked before\n"
        "# the group stage locked. Backdating it to make a publish go through is\n"
        "# the one edit here that silently breaks the model.\n"
        "\n"
        "verified: false\n"
        'verified_utc: ""\n'
        'source: ""\n'
        "\n"
        "teams:\n"
        f"{slots}\n"
    )


def strip_tournament(raw: dict) -> dict:
    """Keep the format, drop everything that describes one specific running of it."""
    out = dict(raw)
    out["name"] = "TODO"
    out["lock_utc"] = "TODO"
    # The qualifiers are a different set of leagues every year, and a copied id
    # would silently pull the wrong event's matches.
    out["qualifier_leagues"] = {}
    # A drawn bracket is the least transferable thing in the file.
    main = out.get("main_event")
    if isinstance(main, dict):
        main = dict(main)
        for key in ("upper_bracket_round_1", "eliminated", "my_picks"):
            main.pop(key, None)
        main["lock_utc"] = "TODO"
        main["league_id"] = None
        out["main_event"] = main
    return out


def strip_scoring(raw: dict) -> dict:
    """Keep the stat table's shape; force it to be re-checked against the client."""
    out = dict(raw)
    out["version"] = "TODO"
    # The gate that catches a table copied forward and never re-verified.
    out["verified_against_client"] = False
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Scaffold a new tournament's config")
    ap.add_argument("tournament_id", help="e.g. ti2027")
    ap.add_argument(
        "--from",
        dest="source",
        default="",
        help="copy the format and stat-table shape from this tournament",
    )
    ap.add_argument("--teams", type=int, default=16)
    args = ap.parse_args()

    target = CONFIG_DIR / args.tournament_id
    if target.exists():
        print(f"[new] {target} already exists. Refusing to overwrite a configured event.")
        return 1

    source_dir: Path | None = None
    if args.source:
        source_dir = CONFIG_DIR / args.source
        if not (source_dir / "tournament.yaml").is_file():
            print(f"[new] --from {args.source}: no config at {source_dir}")
            return 1

    target.mkdir(parents=True)

    if source_dir is not None:
        raw = yaml.safe_load((source_dir / "tournament.yaml").read_text(encoding="utf-8"))
        (target / "tournament.yaml").write_text(
            f"# Format copied from {args.source}; every value that describes one\n"
            "# running of it has been blanked. Fill every TODO before publishing.\n\n"
            + yaml.safe_dump(strip_tournament(raw), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        scoring = yaml.safe_load((source_dir / "scoring.yaml").read_text(encoding="utf-8"))
        (target / "scoring.yaml").write_text(
            f"# Stat table copied from {args.source}. verified_against_client is\n"
            "# FALSE: Valve changes point values between events, and a table carried\n"
            "# forward without re-checking is what scripts/gates.py exists to refuse.\n\n"
            + yaml.safe_dump(strip_scoring(scoring), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        n_teams = (raw.get("group_stage") or {}).get("teams", args.teams)
    else:
        (target / "tournament.yaml").write_text(
            "# Format for this event. See config/ti2026/tournament.yaml for a filled\n"
            "# example, or scaffold with --from <id> to copy its shape.\n"
            "name: TODO\nlock_utc: TODO\nqualifier_leagues: {}\n",
            encoding="utf-8",
        )
        (target / "scoring.yaml").write_text(
            "# Fantasy point values, transcribed from the client's HOW TO PLAY.\n"
            "#\n"
            "# Every entry under `emblem_traits` needs a `condition_rule` naming which\n"
            "# of the scorer's implemented rules gates its own bonus -- `always`,\n"
            "# `never`, `neighboursOnly`, `allQualitiesDiffer`, `countAtLeast3` or\n"
            "# `onlyOne`. publish.py refuses a trait without one, because a trait with\n"
            "# no rule pays on every banner and nothing downstream would notice.\n"
            "version: TODO\nverified_against_client: false\nstats: {}\n",
            encoding="utf-8",
        )
        n_teams = args.teams

    (target / "teams.yaml").write_text(blank_teams(n_teams), encoding="utf-8")
    (target / "banners.yaml").write_text(BANNERS_STUB, encoding="utf-8")
    (target / "patch.yaml").write_text(PATCH_STUB, encoding="utf-8")
    (target / "overrides.yaml").write_text(OVERRIDES_STUB, encoding="utf-8")

    print(f"[new] scaffolded {target}")
    for name in SCAFFOLD_FILES:
        print(f"       {name}")
    print(
        f"\n[new] {len(available_tournaments())} tournaments are now configured, so every\n"
        f"      command needs one named: set DOTA_TOURNAMENT={args.tournament_id}, or\n"
        "      pass --tournament-id.\n"
        f"[new] global config stays shared: {', '.join(sorted(GLOBAL_CONFIG))}\n"
        "[new] nothing here is publishable yet, and that is the point -- the freshness\n"
        "      gates fail on an unverified roster and an unverified scoring table,\n"
        "      which is exactly what a fresh directory is.\n"
        "\n"
        "[new] fetch in this order, not earlier:\n"
        "        qualifiers finish  -> discover_rosters, resolve_ids, set\n"
        "                              verified_utc, publish --stage group\n"
        "        group stage ends   -> transcribe the bracket, re-run both against\n"
        "                              the survivors, update verified_utc, then\n"
        "                              publish --stage main\n"
        "      A roster gathered before the field exists is wrong by the time it\n"
        "      matters, and gates.roster_freshness will say so."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
