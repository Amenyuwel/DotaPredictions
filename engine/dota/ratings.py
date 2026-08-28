"""Team strength from historical results.

Bradley-Terry maximum likelihood with recency weighting and an L2 prior.

Why not plain Elo: several TI teams have thin recent histories (fresh rosters,
regional qualifiers against weak fields). Elo drifts on those. A regularised
MLE shrinks a team with little evidence toward the field average instead of
letting three qualifier stomps mint a fake favourite. `prior_strength` is that
shrinkage knob.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import numpy as np
from scipy.optimize import minimize

from .sources.base import MatchResult


@dataclass
class Ratings:
    """Latent strength per team, in logit units (1.0 ~ 73% per-game win rate)."""

    values: dict[str, float]
    games: dict[str, int]
    half_life_days: float
    prior_strength: float

    def get(self, team: str) -> float:
        return self.values.get(team, 0.0)

    def win_prob(self, a: str, b: str) -> float:
        """P(a beats b) in a single game."""
        return 1.0 / (1.0 + math.exp(-(self.get(a) - self.get(b))))

    def series_win_prob(self, a: str, b: str, best_of: int = 3) -> float:
        return series_prob(self.win_prob(a, b), best_of)

    def evidence(self, team: str) -> int:
        return self.games.get(team, 0)

    def table(self) -> list[tuple[str, float, int]]:
        return sorted(
            ((t, v, self.games.get(t, 0)) for t, v in self.values.items()),
            key=lambda r: -r[1],
        )


def series_prob(p: float, best_of: int = 3) -> float:
    """P(win a Bo-n series | per-game win prob p), games independent."""
    need = best_of // 2 + 1
    total = 0.0
    for losses in range(need):  # we win `need`, they win `losses`
        total += math.comb(need + losses - 1, losses) * p**need * (1 - p) ** losses
    return total


def fit(
    matches: list[MatchResult],
    teams: list[str],
    *,
    as_of: datetime | None = None,
    half_life_days: float = 90.0,
    prior_strength: float = 3.0,
    alias: dict[str, str] | None = None,
) -> Ratings:
    """Fit strengths for `teams`. Opponents outside `teams` get pooled ratings too,
    so beating a strong non-participant still counts as evidence."""
    as_of = as_of or max((m.start_time for m in matches), default=None)
    if as_of is None:
        return Ratings({t: 0.0 for t in teams}, {t: 0 for t in teams}, half_life_days, prior_strength)

    alias = alias or {}

    def canon(name: str | None) -> str | None:
        if not name:
            return None
        return alias.get(name, name)

    rows: list[tuple[str, str, float]] = []  # (winner, loser, weight)
    for m in matches:
        w, l = canon(m.winner_name), canon(m.loser_name)
        if not w or not l or w == l:
            continue
        age_days = (as_of - m.start_time).total_seconds() / 86400.0
        if age_days < 0:
            age_days = 0.0
        rows.append((w, l, 0.5 ** (age_days / half_life_days)))

    if not rows:
        return Ratings({t: 0.0 for t in teams}, {t: 0 for t in teams}, half_life_days, prior_strength)

    names = sorted({n for w, l, _ in rows for n in (w, l)} | set(teams))
    index = {n: i for i, n in enumerate(names)}
    wi = np.array([index[w] for w, _, _ in rows])
    li = np.array([index[l] for _, l, _ in rows])
    wt = np.array([x for _, _, x in rows])

    n = len(names)
    counts = np.bincount(np.concatenate([wi, li]), minlength=n)

    def objective(r: np.ndarray) -> tuple[float, np.ndarray]:
        d = r[wi] - r[li]
        # -log P(observed winners), recency weighted
        nll = float(np.sum(wt * np.logaddexp(0.0, -d)))
        s = 1.0 / (1.0 + np.exp(d))  # dNLL/dd
        grad = np.zeros(n)
        np.add.at(grad, wi, -wt * s)
        np.add.at(grad, li, wt * s)
        # L2 prior pulls everyone toward 0; strength scales with how little
        # evidence a team has, which is exactly the shrinkage we want.
        nll += 0.5 * prior_strength * float(np.dot(r, r))
        grad += prior_strength * r
        return nll, grad

    res = minimize(
        objective,
        np.zeros(n),
        jac=True,
        method="L-BFGS-B",
        options={"maxiter": 2000},
    )
    r = res.x - res.x.mean()  # centre; only differences are identifiable

    return Ratings(
        values={name: float(r[index[name]]) for name in names},
        games={name: int(counts[index[name]]) for name in names},
        half_life_days=half_life_days,
        prior_strength=prior_strength,
    )
