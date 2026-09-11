"""Re-check whether a stat nobody publishes has started being published.

`config/<id>/scoring.yaml` lists stats marked `unmeasurable`. That list is a
statement about the world on the day someone checked it, and the world moves:
OpenDota adds parser fields, STRATZ adds schema types, and Valve populates
protobuf fields it had left empty. Nothing about a stale entry is visible --
the emblem just goes on being excluded from every banner, silently, forever.

So the list is re-tested rather than trusted. Each publish scans the match
payloads it already fetched for field names that would carry the stat, and says
so if one appears. That turns "remember to check at the next International" into
something that happens whether anyone remembers or not.

This list got `watchers_taken` wrong for a tournament, and the way it did is the
reason the candidate names below are chosen the way they are. The 2026-09-10
check searched these payloads for the string "watcher", found nothing, and
concluded nobody published it. OpenDota publishes it as
`ability_uses.ability_lamp_use` -- a Watcher is a "lamp" in Valve's naming -- so
the search was looking for a word that does not appear in the data and never
could have found it. A candidate list is only as good as its worst guess.
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from .config import CACHE_DIR

# What the field would be called if it appeared.
#
# `ability_pluck_lotus` is the one that matters and it is not a guess: the
# ability EXISTS in odota/dotaconstants, with a `lotus_rate` attribute, and
# OpenDota simply never populates it -- 0 of 8 parsed pro matches sampled on
# 2026-09-11 carried the key, against `ability_lamp_use` appearing in 8 of 8.
# So the day Valve starts emitting it, this is the name it will arrive under.
#
# The rest are fallbacks: Valve's own spelling from CMsgDOTAFantasyPlayerStats
# (`lotuses` = 25), and the shapes the existing parser uses elsewhere.
#
# `item_uses.famango` is deliberately NOT here. It is lotus CONSUMPTION, it is
# already populated, and listing it would fire this notice on every publish
# forever while naming a field that cannot answer the question -- a lotus can
# be plucked and handed to a teammate.
#
# `watchers_taken` is no longer on this list: it is measured, via
# `ability_uses.ability_lamp_use`. See `sources/opendota.py`.
CANDIDATE_FIELDS: dict[str, tuple[str, ...]] = {
    "lotuses_grabbed": (
        "ability_pluck_lotus",
        "lotuses",
        "lotuses_grabbed",
        "lotus_pickups",
        "lotus_grabbed",
    ),
}


def scan_payload(payload: dict[str, Any], candidates: Iterable[str]) -> list[str]:
    """Candidate field names that appear on a player in this match.

    One level of nesting is searched as well as the top level, because the
    parser already tucks several stats inside per-player dicts -- `item_uses`
    carries madstone, `killed` carries tormentors -- so a new stat arriving
    inside one of those would otherwise go unnoticed.
    """
    wanted = {c.lower() for c in candidates}
    found: set[str] = set()
    for player in payload.get("players") or []:
        if not isinstance(player, dict):
            continue
        for key, value in player.items():
            if key.lower() in wanted:
                found.add(key)
            if isinstance(value, dict):
                found.update(k for k in value if k.lower() in wanted)
    return sorted(found)


def cached_match_payloads(limit: int = 200) -> list[dict[str, Any]]:
    """Parsed match details already on disk. Reads only; fetches nothing."""
    root = CACHE_DIR / "opendota"
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in root.iterdir():
        if len(out) >= limit:
            break
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - degrade, never fail the run
            continue
        if not isinstance(entry, dict) or not str(entry.get("key", "")).startswith("/matches/"):
            continue
        payload = entry.get("payload")
        if isinstance(payload, dict) and payload.get("players"):
            out.append(payload)
    return out


def rediscover(
    unmeasurable: Iterable[str],
    payloads: list[dict[str, Any]] | None = None,
) -> dict[str, list[str]]:
    """stat -> field names now carrying it. Empty dict means nothing changed.

    Absence of evidence is the expected answer here and is reported as such: an
    empty result is "still nothing", not "check failed".
    """
    payloads = cached_match_payloads() if payloads is None else payloads
    if not payloads:
        return {}

    found: dict[str, list[str]] = {}
    for stat in unmeasurable:
        candidates = CANDIDATE_FIELDS.get(stat)
        if not candidates:
            continue
        hits: set[str] = set()
        for payload in payloads:
            hits.update(scan_payload(payload, candidates))
        if hits:
            found[stat] = sorted(hits)
    return found


def report(found: dict[str, list[str]]) -> list[str]:
    """What to print when the world has moved. One line per stat."""
    lines = []
    for stat, fields in sorted(found.items()):
        lines.append(
            f"{stat} now appears in the match data as {', '.join(fields)}. "
            f"It is still listed under `unmeasurable` in scoring.yaml, so every "
            f"emblem carrying it is being excluded from choice and scored as "
            f"absent. Add a `source:` for it and drop it from that list."
        )
    return lines


__all__ = ["CANDIDATE_FIELDS", "rediscover", "report", "scan_payload", "cached_match_payloads"]
