"""Structural checks on the simulator. Run: python -m tests.test_swiss"""
from __future__ import annotations

import numpy as np

from dota import swiss
from dota.config import Bucket
from dota.optimize import optimal_predictions
from dota.ratings import series_prob

TEAMS = [f"T{i:02d}" for i in range(16)]


def test_bucket_counts_exact():
    """Every simulation must fill exactly 1/2/5/5/2/1. If this fails the format
    model is wrong and every downstream number is meaningless."""
    strength = {t: (i - 8) * 0.25 for i, t in enumerate(TEAMS)}

    def wp(a, b):
        return 1.0 / (1.0 + np.exp(-(strength[a] - strength[b])))

    n = 3000
    o = swiss.simulate(TEAMS, wp, n_sims=n, seed=7)
    expected = {
        "undefeated": 1,
        "four_one": 2,
        "elim_winner": 5,
        "elim_loser": 5,
        "one_four": 2,
        "winless": 1,
    }
    for bucket, count in expected.items():
        got = sum(o.bucket_prob[t][bucket] for t in TEAMS)
        assert abs(got - count) < 1e-9, f"{bucket}: expected {count} teams, got {got}"

    # Each team lands in exactly one bucket every sim.
    for t in TEAMS:
        assert abs(sum(o.bucket_prob[t].values()) - 1.0) < 1e-9, t
    print("ok  bucket counts exact (1/2/5/5/2/1) across", n, "sims")


def test_stronger_teams_do_better():
    strength = {t: (i - 8) * 0.4 for i, t in enumerate(TEAMS)}

    def wp(a, b):
        return 1.0 / (1.0 + np.exp(-(strength[a] - strength[b])))

    o = swiss.simulate(TEAMS, wp, n_sims=3000, seed=11)
    best, worst = TEAMS[-1], TEAMS[0]
    assert o.advance_prob[best] > o.advance_prob[worst]
    assert o.bucket_prob[best]["undefeated"] > o.bucket_prob[worst]["undefeated"]
    assert o.bucket_prob[worst]["winless"] > o.bucket_prob[best]["winless"]
    print(
        f"ok  ordering: {best} advance {o.advance_prob[best]:.1%} "
        f"vs {worst} {o.advance_prob[worst]:.1%}"
    )


def test_games_played_range():
    def wp(a, b):
        return 0.5

    o = swiss.simulate(TEAMS, wp, n_sims=2000, seed=3)
    for t in TEAMS:
        played = o.games_hist[t]
        # Minimum: 4 series lost 0-2 = 8 games. Maximum: 5 series + elimination
        # round, all going three games = 18.
        assert min(played) >= 8, (t, min(played))
        assert max(played) <= 18, (t, max(played))
    lo = min(o.expected_games.values())
    hi = max(o.expected_games.values())
    print(f"ok  games played in [8, 18]; E[games] spread {lo:.1f}-{hi:.1f}")


def test_assignment_beats_greedy():
    """The joint assignment must never score worse than per-bucket greedy."""
    strength = {t: (i - 8) * 0.3 for i, t in enumerate(TEAMS)}

    def wp(a, b):
        return 1.0 / (1.0 + np.exp(-(strength[a] - strength[b])))

    o = swiss.simulate(TEAMS, wp, n_sims=3000, seed=5)
    buckets = [
        Bucket("undefeated", "4-0", 1, 1.0),
        Bucket("four_one", "4-1", 2, 1.0),
        Bucket("elim_winner", "Elim W", 5, 1.0),
        Bucket("elim_loser", "Elim L", 5, 1.0),
        Bucket("one_four", "1-4", 2, 1.0),
        Bucket("winless", "0-4", 1, 1.0),
    ]
    plan = optimal_predictions(o, buckets, TEAMS)
    assert len({p.team for p in plan.picks}) == 16, "a team was assigned twice"

    # Greedy baseline: walk the buckets in grid order, take the best team not
    # already spent. This is what filling the grid by eye amounts to.
    used: set[str] = set()
    greedy = 0.0
    for b in buckets:
        ranked = sorted(TEAMS, key=lambda t: -o.prob(t, b.id))
        taken = 0
        for t in ranked:
            if taken == b.count:
                break
            if t in used:
                continue
            used.add(t)
            greedy += o.prob(t, b.id)
            taken += 1

    assert plan.expected_correct >= greedy - 1e-9, (plan.expected_correct, greedy)
    print(
        f"ok  optimal E[correct] = {plan.expected_correct:.3f} "
        f"(greedy = {greedy:.3f})"
    )


def test_series_prob():
    assert abs(series_prob(0.5, 3) - 0.5) < 1e-12
    assert abs(series_prob(0.6, 3) - (0.6**2 * (3 - 2 * 0.6))) < 1e-12
    assert series_prob(0.6, 3) > 0.6, "Bo3 should amplify an edge"
    assert series_prob(0.4, 3) < 0.4
    print("ok  Bo3 series probability amplifies the favourite")


if __name__ == "__main__":
    test_series_prob()
    test_bucket_counts_exact()
    test_stronger_teams_do_better()
    test_games_played_range()
    test_assignment_beats_greedy()
    print("\nall structural tests passed")
