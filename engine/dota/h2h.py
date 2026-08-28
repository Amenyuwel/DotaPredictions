"""Head-to-head records, and whether they add anything to a strength rating.

The intuition is strong: if Liquid have gone 7-8 with Falcons over fifteen games, that
feels like better evidence about *this* match than two ratings fitted on everyone. The
Bradley-Terry model in `ratings.py` deliberately throws it away — it pools every result
into one number per team, so a matchup is predicted transitively, through common
opponents. That is a real assumption, and it is what lets the model price a pair that has
never met at all (4 of the 28 pairs in this bracket).

This module supplies the alternative so the assumption can be tested rather than
defended. A pairwise record is folded into the rating's prediction by shrinkage:

    p_adjusted = (weighted wins by A + k * p_rating) / (weighted meetings + k)

`k` is a prior strength in pseudo-games. Large `k` recovers the pure rating; `k = 0`
trusts the head-to-head record alone. Meetings are recency-weighted like everything else,
because a result from February is weaker evidence than one from last week.

`scripts/validate_h2h.py` fits this on past data and scores it on later matches the fit
never saw, across a range of `k`. That is the only honest way to answer the question,
because a head-to-head term will always improve the *fit* — it adds a free parameter per
pair — while usually degrading the *prediction*.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from .sources.base import MatchResult


@dataclass
class H2HModel:
    """Recency-weighted pairwise records among a set of teams."""

    half_life_days: float = 90.0
    # (winner, loser) -> weighted count of games won
    wins: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(float))
    games: int = 0

    @classmethod
    def build(
        cls,
        matches: list[MatchResult],
        *,
        half_life_days: float = 90.0,
        as_of: datetime | None = None,
        teams: set[str] | None = None,
    ) -> "H2HModel":
        m = cls(half_life_days=half_life_days)
        stamps = [x.start_time for x in matches if x.start_time]
        if not stamps:
            return m
        latest = as_of or max(stamps)
        for match in matches:
            a, b = match.radiant_name, match.dire_name
            if not a or not b or a == b:
                continue
            if teams is not None and (a not in teams or b not in teams):
                continue
            age = max((latest - match.start_time).total_seconds() / 86400.0, 0.0)
            w = 0.5 ** (age / half_life_days)
            winner, loser = (a, b) if match.radiant_win else (b, a)
            m.wins[(winner, loser)] += w
            m.games += 1
        return m

    def record(self, a: str, b: str) -> tuple[float, float]:
        """(weighted wins by a, weighted wins by b)."""
        return self.wins.get((a, b), 0.0), self.wins.get((b, a), 0.0)

    def meetings(self, a: str, b: str) -> float:
        wa, wb = self.record(a, b)
        return wa + wb

    def adjust(self, p_rating: float, a: str, b: str, *, prior_k: float) -> float:
        """Blend the rating's prediction with the pair's own record.

        `prior_k` in pseudo-games. Returns `p_rating` unchanged when the two have never
        met, which is the behaviour that matters: a head-to-head term must never make a
        never-met pair *less* predictable than the rating alone.
        """
        if prior_k == float("inf"):
            return p_rating
        wa, wb = self.record(a, b)
        n = wa + wb
        if n <= 0.0:
            return p_rating
        p = (wa + prior_k * p_rating) / (n + prior_k)
        # Keep away from the boundaries; a 2-0 record is not a certainty.
        return min(max(p, 1e-4), 1.0 - 1e-4)

    def summary(self, a: str, b: str, p_rating: float, *, prior_k: float) -> str:
        wa, wb = self.record(a, b)
        return (
            f"{a} {wa:.1f}-{wb:.1f} {b} (weighted) | rating {p_rating:.1%} -> "
            f"{self.adjust(p_rating, a, b, prior_k=prior_k):.1%}"
        )


def log_loss(p: float, won: bool) -> float:
    p = min(max(p, 1e-9), 1.0 - 1e-9)
    return -math.log(p if won else 1.0 - p)


def brier(p: float, won: bool) -> float:
    return (p - (1.0 if won else 0.0)) ** 2


__all__ = ["H2HModel", "brier", "log_loss"]
