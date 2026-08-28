"""The banner as an ordered object, so a spent banner can still be improved.

Once the roll tokens are gone the stats are frozen -- but **two traits are
positional**, and rearranging emblems costs nothing:

    Vampiric     +50% to itself, -10% to each ADJACENT emblem
    Benevolent     0% to itself, +20% to each ADJACENT emblem

The other three are order-independent conditions on the whole banner:

    Fractal      +60% if every emblem quality on the banner differs
    Friendly     +50% if at least three Friendly emblems are present
    Unique       +30% if this is the only Unique emblem

So a banner's total depends on which emblems sit next to which, and the choice is
free. The rule is: a Vampiric emblem should have the *cheapest* neighbours you can
give it, and a Benevolent emblem the most expensive -- which usually means pushing
Vampirics to the two ends, where they have one neighbour instead of two.

This module derives the displayed percentages from tier + trait + neighbours. That
derivation is checked against all fifteen percentages transcribed from the client
in `tests/test_emblems.py`; it is what lets the optimiser trust its own arithmetic
rather than a screenshot.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import permutations

import yaml

from .config import CONFIG_DIR, Scoring

# Positional trait effects on each neighbour.
ADJACENT = {"vampiric": -0.10, "benevolent": 0.20}


@dataclass(frozen=True)
class Emblem:
    """One emblem: a stat, a quality tier and a trait. All three are fixed once
    rolled; only its position on the banner can still change."""

    stat: str
    tier: str
    trait: str
    displayed: float | None = None   # what the client shows, for cross-checking


def self_bonus(emblem: Emblem, banner: list[Emblem], scoring: Scoring) -> float:
    """The emblem's own trait bonus, after its condition is evaluated."""
    trait = emblem.trait
    spec = (scoring.traits or {}).get(trait) or {}
    bonus = float(spec.get("bonus") or 0.0)
    if trait == "fractal":
        tiers = [e.tier for e in banner]
        return bonus if len(set(tiers)) == len(tiers) else 0.0
    if trait == "friendly":
        return bonus if sum(1 for e in banner if e.trait == "friendly") >= 3 else 0.0
    if trait == "unique":
        return bonus if sum(1 for e in banner if e.trait == "unique") == 1 else 0.0
    if trait == "benevolent":
        return 0.0            # gives to neighbours, nothing to itself
    return bonus              # vampiric, and anything unconditional


def multipliers(banner: list[Emblem], scoring: Scoring) -> list[float]:
    """Displayed multiplier per emblem, in banner order.

        multiplier = 1 + quality + own trait (if its condition holds)
                       + the positional effect of each neighbour
    """
    quality = scoring.quality or {}
    out = []
    for i, e in enumerate(banner):
        m = 1.0 + float(quality.get(e.tier, 0.0)) + self_bonus(e, banner, scoring)
        for j in (i - 1, i + 1):
            if 0 <= j < len(banner):
                m += ADJACENT.get(banner[j].trait, 0.0)
        out.append(round(m, 10))
    return out


def banner_points(
    banner: list[Emblem], scoring: Scoring, base_points: dict[str, float]
) -> float:
    """Per-game points from this banner, given each stat's bare per-game value."""
    return sum(
        base_points.get(e.stat, 0.0) * m for e, m in zip(banner, multipliers(banner, scoring))
    )


def best_order(
    banner: list[Emblem], scoring: Scoring, base_points: dict[str, float]
) -> tuple[list[Emblem], float, float]:
    """Exhaustive search over orderings. Returns (order, points, points_now).

    Five emblems is 120 permutations, so there is no reason to be clever -- and
    being exhaustive means the answer is the optimum rather than a heuristic's
    guess. Ties are broken toward the ordering already in the client, so the
    optimiser never asks for a rearrangement that gains nothing.
    """
    now = banner_points(banner, scoring, base_points)
    best, best_pts = list(banner), now
    for perm in permutations(banner):
        pts = banner_points(list(perm), scoring, base_points)
        if pts > best_pts + 1e-9:
            best, best_pts = list(perm), pts
    return best, best_pts, now


def load(path=None) -> dict[str, list[Emblem]]:
    """Read config/banners.yaml. Accepts the structured form only.

    The flat `{stat: multiplier}` form is still readable through
    `scripts.fixed_banner.load_banners`, which is what the older scripts use; this
    loader needs tiers and traits, which the flat form does not carry.
    """
    path = path or CONFIG_DIR / "banners.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, list[Emblem]] = {}
    for slot in ("core", "mid", "support"):
        block = raw.get(slot) or {}
        rows = block.get("emblems") if isinstance(block, dict) else None
        if not rows:
            continue
        out[slot] = [
            Emblem(
                stat=str(r["stat"]),
                tier=str(r["tier"]),
                trait=str(r["trait"]),
                displayed=None if r.get("displayed") is None else float(r["displayed"]),
            )
            for r in rows
        ]
    return out


def check_against_client(
    banner: list[Emblem], scoring: Scoring, tolerance: float = 1e-6
) -> list[str]:
    """Where the derived multiplier disagrees with the transcribed one.

    A mismatch means either the transcription is wrong or this module's model of
    the trait rules is -- and both are worth failing loudly over, because every
    projection downstream is scaled by these numbers.
    """
    problems = []
    for e, m in zip(banner, multipliers(banner, scoring)):
        if e.displayed is None:
            continue
        if abs(m - e.displayed) > tolerance:
            problems.append(
                f"{e.stat}: client shows {e.displayed:.2f}, model derives {m:.2f} "
                f"({e.tier}, {e.trait})"
            )
    return problems


__all__ = [
    "ADJACENT",
    "Emblem",
    "banner_points",
    "best_order",
    "check_against_client",
    "load",
    "multipliers",
    "self_bonus",
]
