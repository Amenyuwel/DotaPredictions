"""Checks on the Main Event projection layer. Run: python -m tests.test_projection"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from dota.config import Player
from dota.fantasy import (
    best_series_interval,
    expected_best_series,
    recency_weights,
)
from dota.sources.base import PlayerGame
from dota.titles import Titles

SHAPES = [(2, 3), (3, 2, 3), (2, 2, 2, 5), (3,), (2, 3, 3, 3, 2, 5)]


def _slow_expected_best_series(pool, shapes, *, seed=1, n_sims=20000, p=None):
    """The original per-simulation loop, kept as the reference implementation."""
    rng = np.random.default_rng(seed)
    pool = np.asarray(pool, dtype=float)
    total = 0.0
    picks = rng.integers(0, len(shapes), size=n_sims)
    for i in picks:
        best = 0.0
        for n in shapes[i]:
            draws = (
                pool[rng.integers(0, pool.size, size=n)]
                if p is None
                else pool[rng.choice(pool.size, size=n, p=p)]
            )
            part = float(np.sort(draws)[-2:].sum()) if n >= 2 else float(draws.sum())
            best = max(best, part)
        total += best
    return total / n_sims


def test_vectorised_matches_the_loop():
    """The rewrite is a speedup, not a change of answer. Both are Monte Carlo, so
    they are compared against their own noise, not for equality."""
    pool = list(np.random.default_rng(0).lognormal(8.5, 0.3, size=90))
    slow = _slow_expected_best_series(pool, SHAPES, n_sims=40000)
    fast = expected_best_series(
        pool, SHAPES, n_sims=40000, rng=np.random.default_rng(5)
    )
    assert abs(fast / slow - 1) < 0.01, (fast, slow)

    w = list(np.linspace(0.2, 1.0, len(pool)))
    p = np.asarray(w) / np.sum(w)
    slow_w = _slow_expected_best_series(pool, SHAPES, n_sims=40000, p=p)
    fast_w = expected_best_series(
        pool, SHAPES, n_sims=40000, weights=w, rng=np.random.default_rng(6)
    )
    assert abs(fast_w / slow_w - 1) < 0.01, (fast_w, slow_w)
    print("ok  vectorised projection reproduces the reference loop, weighted or not")


def test_decider_bonus_is_placed_not_averaged():
    """`the Clutch` amplifies one game per series that goes the distance, and a
    series keeps its top TWO games.

    Two bounds follow, and they are what the positional model has to satisfy:
    it must beat `bonus x P(a game is the decider)` -- the flat rate the config
    used to assume -- because the period keeps its BEST series and the bonus
    lands preferentially on the series it lifts; and it must stay well under
    `bonus`, which is what boosting every counted game would pay.
    """
    pool = list(np.random.default_rng(1).lognormal(8.5, 0.3, size=120))
    shapes = [(3, 2, 3), (2, 3), (3, 3, 3)]
    deciders = [tuple(n == 3 for n in s) for s in shapes]
    # The rate that matters is per GAME, not per series: the bonus multiplies one
    # game's score, so comparing against a per-series share would compare against
    # a quantity twice too large.
    p_game = sum(sum(d) for d in deciders) / sum(sum(s) for s in shapes)
    bonus = 0.16

    plain = expected_best_series(pool, shapes, n_sims=60000, rng=np.random.default_rng(2))
    placed = expected_best_series(
        pool,
        shapes,
        n_sims=60000,
        rng=np.random.default_rng(2),
        decider_samples=deciders,
        decider_bonus=bonus,
    )
    assert placed > plain * (1 + bonus * p_game), (placed, plain, p_game)
    assert placed < plain * (1 + bonus), (placed, plain)
    print(
        f"ok  decider bonus placed = {placed / plain - 1:+.2%}, above its flat rate "
        f"{bonus * p_game:+.2%} and below the {bonus:+.0%} ceiling"
    )


def test_recency_weights_track_form():
    """A team whose recent games are its best must project higher than one whose
    good games are six months old, from the identical set of scores."""
    now = datetime(2026, 8, 17, tzinfo=timezone.utc)
    good, bad = 12000.0, 6000.0
    fresh = [(good, now - timedelta(days=i), i) for i in range(20)]
    fresh += [(bad, now - timedelta(days=150 + i), 100 + i) for i in range(20)]
    stale = [(bad, now - timedelta(days=i), 200 + i) for i in range(20)]
    stale += [(good, now - timedelta(days=150 + i), 300 + i) for i in range(20)]

    out = []
    for rows in (fresh, stale):
        w = recency_weights(rows, half_life_days=60.0, as_of=now)
        out.append(
            expected_best_series(
                [s for s, _, _ in rows],
                SHAPES,
                weights=w,
                n_sims=20000,
                rng=np.random.default_rng(3),
            )
        )
    assert out[0] > out[1] * 1.10, out
    # Unweighted, the two are the same pool and must be indistinguishable.
    flat = [
        expected_best_series(
            [s for s, _, _ in rows], SHAPES, n_sims=20000, rng=np.random.default_rng(4)
        )
        for rows in (fresh, stale)
    ]
    assert abs(flat[0] / flat[1] - 1) < 0.01, flat
    print("ok  recency weighting separates recent form; flat weighting cannot")


def test_interval_narrows_with_sample_size():
    rng = np.random.default_rng(7)
    small = list(rng.lognormal(8.5, 0.35, size=25))
    large = list(rng.lognormal(8.5, 0.35, size=400))
    _sd_s, lo_s, hi_s = best_series_interval(small, SHAPES, n_boot=120, n_sims=600)
    _sd_l, lo_l, hi_l = best_series_interval(large, SHAPES, n_boot=120, n_sims=600)
    assert hi_s - lo_s > 2 * (hi_l - lo_l), (hi_s - lo_s, hi_l - lo_l)
    assert lo_s < hi_s and lo_l < hi_l
    print(
        f"ok  bootstrap band narrows with evidence: n=25 -> {hi_s - lo_s:,.0f}, "
        f"n=400 -> {hi_l - lo_l:,.0f}"
    )


def test_prefix_fires_only_on_tagged_heroes():
    t = Titles(
        prefix="Cerulean",
        prefix_bonus=0.11,
        prefix_tags=frozenset({"Blue"}),
        hero_tags={1: {"Blue", "Red"}, 2: {"Red"}, 3: set()},
    )
    p = Player(nick="x", role="mid", team="T", account_id=1)

    def game(hero_id):
        return PlayerGame(
            account_id=1,
            match_id=hero_id or 0,
            start_time=datetime(2026, 8, 1, tzinfo=timezone.utc),
            won=True,
            duration_seconds=2400,
            stats={},
            hero_id=hero_id,
        )

    assert abs(t.game_multiplier(p, game(1)) - 1.11) < 1e-12
    assert t.game_multiplier(p, game(2)) == 1.0
    assert t.game_multiplier(p, game(3)) == 1.0, "untagged hero must not pay"
    assert t.game_multiplier(p, game(None)) == 1.0, "unknown hero must not pay"
    assert abs(t.prefix_rate([game(1), game(2), game(1), game(3)]) - 0.5) < 1e-12
    print("ok  coach prefix fires per game, only on heroes carrying the tag")


if __name__ == "__main__":
    test_vectorised_matches_the_loop()
    test_decider_bonus_is_placed_not_averaged()
    test_recency_weights_track_form()
    test_interval_narrows_with_sample_size()
    test_prefix_fires_only_on_tagged_heroes()
    print("\nall projection tests passed")
