"""War Banner optimisation.

The rule that makes this the whole game: *players score only the stats present
on their War Banner*. Everything else they do is worth nothing. So a player is
not "good" or "bad" in the abstract -- they are worth exactly what their best
red, blue and green stat pay, and two players with identical overall quality
can differ hugely once you price only three stats.

A banner carries one emblem of each colour, so the three choices are
independent: take the highest-paying measurable stat in each colour.

Base values are extremely unequal (Creep Score pays 3 per unit, Roshan 1,172),
so raw rates are meaningless until multiplied through. A carry's 580 last hits
is worth 1,740 points; their 0.8 Roshan kills is worth 940. Rate alone would
have ranked those the other way round.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import Scoring, Stat

# How OpenDota's per-game stat keys map onto the client's scoring stats.
STAT_SOURCE = {
    "kills": "kills",
    "deaths": "deaths",
    "creep_score": "last_hits_denies",
    "gold_per_min": "gold_per_min",
    "tower_kills": "tower_kills",
    "observer_wards_planted": "observer_wards_planted",
    "camps_stacked": "camps_stacked",
    "rune_pickups": "rune_pickups",
    "smokes_used": "smokes_used",
    "roshan_kills": "roshan_kills",
    "tormentor_kills": "tormentor_kills",
    "madstone_collected": "madstone_collected",
    "teamfight_participation": "teamfight_participation",
    "seconds_stunned": "seconds_stunned",
    "first_blood": "first_blood",
    "courier_kills": "courier_kills",
}


@dataclass
class EmblemChoice:
    color: str
    stat: Stat
    per_game_value: float
    base_points: float          # points before any emblem multiplier
    multiplier: float = 1.0     # 1.0 = a bare emblem, no quality or trait

    @property
    def points(self) -> float:
        return self.base_points * self.multiplier

    @property
    def label(self) -> str:
        return self.stat.key.replace("_", " ").title()


@dataclass
class BannerPlan:
    player_key: str
    choices: dict[str, EmblemChoice] = field(default_factory=dict)
    runners_up: dict[str, list[EmblemChoice]] = field(default_factory=dict)

    @property
    def points(self) -> float:
        return sum(c.points for c in self.choices.values())

    def ordered(self, colors: list[str]) -> list[EmblemChoice]:
        return [self.choices[c] for c in colors if c in self.choices]


def stat_points(stat: Stat, stat_means: dict[str, float]) -> float | None:
    """Expected points per game from one stat, or None if unmeasured."""
    if not stat.measurable:
        return None
    source = STAT_SOURCE.get(stat.key)
    if source is None:
        return None
    value = stat_means.get(source)
    if value is None:
        # `deaths` still pays its 1,950 base even with no deaths recorded, but
        # a missing measurement is not the same as a measured zero.
        return None
    return stat.points(value)


def rank_stats(
    scoring: Scoring, stat_means: dict[str, float], color: str
) -> list[EmblemChoice]:
    out: list[EmblemChoice] = []
    for stat in scoring.by_color(color):
        pts = stat_points(stat, stat_means)
        if pts is None:
            continue
        source = STAT_SOURCE[stat.key]
        out.append(
            EmblemChoice(
                color=color,
                stat=stat,
                per_game_value=stat_means.get(source, 0.0),
                base_points=pts,
            )
        )
    out.sort(key=lambda c: -c.base_points)
    return out


def best_banner(
    player_key: str,
    scoring: Scoring,
    stat_means: dict[str, float],
    multipliers: dict[str, float] | None = None,
) -> BannerPlan:
    """Highest-paying measurable stat in each colour.

    `multipliers` optionally applies a per-colour emblem multiplier. It cannot
    change which stat wins a colour -- the multiplier scales whatever sits in
    that slot -- but it does change how the three colours compare, which is
    what tells you where to spend roll tokens.
    """
    multipliers = multipliers or {}
    plan = BannerPlan(player_key=player_key)
    for color in scoring.colors:
        ranked = rank_stats(scoring, stat_means, color)
        if not ranked:
            continue
        top = ranked[0]
        top.multiplier = multipliers.get(color, 1.0)
        plan.choices[color] = top
        plan.runners_up[color] = ranked[1:4]
    return plan


def banner_score_for_game(
    plan: BannerPlan, game_stats: dict[str, float], scoring: Scoring
) -> float:
    """Score one actual game under a fixed banner.

    Only the banner's stats count -- that is the point of the mechanic and the
    reason a player's overall quality is close to irrelevant. The banner may carry
    three emblems (Group Stage) or five (Main Event); this reads the plan it is
    given rather than assuming a count.
    """
    total = 0.0
    for choice in plan.choices.values():
        source = STAT_SOURCE.get(choice.stat.key)
        if source is None:
            continue
        value = game_stats.get(source)
        if value is None:
            # The stat's flat base (deaths) still applies; its per-unit part
            # cannot be scored without a measurement.
            total += choice.stat.base * choice.multiplier
            continue
        total += choice.stat.points(value) * choice.multiplier
    return total
