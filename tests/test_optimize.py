"""Structural checks on the k-best prediction grids.

The property that actually matters here is *distinctness*. The grid has five
interchangeable Elimination Round Winner rows and five interchangeable
Elimination Round Loser rows, so a naive k-best would happily return five
reorderings of the same answer and look correct while being useless. These
tests pin that down.

    python -m tests.test_optimize
"""
from __future__ import annotations

import random

from dota.config import Bucket
from dota.optimize import k_best_predictions, optimal_predictions

BUCKETS = [
    Bucket(id="undefeated", label="4-0", count=1, points=1.0),
    Bucket(id="four_one", label="4-1", count=2, points=1.0),
    Bucket(id="elim_winner", label="Elim W", count=5, points=1.0),
    Bucket(id="elim_loser", label="Elim L", count=5, points=1.0),
    Bucket(id="one_four", label="1-4", count=2, points=1.0),
    Bucket(id="winless", label="0-4", count=1, points=1.0),
]
TEAMS = [f"T{i:02d}" for i in range(16)]


class FakeOutcome:
    """Stand-in for SwissOutcome exposing only what the optimiser reads."""

    def __init__(self, table: dict[str, dict[str, float]]):
        self.table = table

    def prob(self, team: str, bucket_id: str) -> float:
        return self.table[team][bucket_id]


def _outcome(seed: int = 7) -> FakeOutcome:
    """A plausible, non-degenerate probability table.

    Strong teams lean toward the top buckets and weak ones toward the bottom,
    which is what makes the assignment non-trivial: several teams are the best
    answer for the same row and can only be spent once.
    """
    rng = random.Random(seed)
    table: dict[str, dict[str, float]] = {}
    for i, team in enumerate(TEAMS):
        strength = 1.0 - i / (len(TEAMS) - 1)  # 1.0 = best, 0.0 = worst
        raw = {
            "undefeated": 0.02 + 0.25 * strength**3,
            "four_one": 0.05 + 0.35 * strength**2,
            "elim_winner": 0.15 + 0.45 * strength,
            "elim_loser": 0.15 + 0.45 * (1 - strength),
            "one_four": 0.05 + 0.35 * (1 - strength) ** 2,
            "winless": 0.02 + 0.25 * (1 - strength) ** 3,
        }
        jittered = {k: v * rng.uniform(0.9, 1.1) for k, v in raw.items()}
        total = sum(jittered.values())
        table[team] = {k: v / total for k, v in jittered.items()}
    return FakeOutcome(table)


def test_first_grid_matches_the_hungarian_optimum() -> None:
    outcome = _outcome()
    grids = k_best_predictions(outcome, BUCKETS, TEAMS, k=5)
    best = optimal_predictions(outcome, BUCKETS, TEAMS)

    assert grids, "k_best_predictions returned nothing"
    assert grids[0].key == best.key, (
        "grid 1 is not the optimal assignment:\n"
        f"  k-best:    {sorted(grids[0].key)}\n"
        f"  hungarian: {sorted(best.key)}"
    )
    assert abs(grids[0].expected_correct - best.expected_correct) < 1e-9
    print(f"ok: grid 1 == Hungarian optimum (E = {best.expected_correct:.4f})")


def test_grids_are_distinct_not_row_permutations() -> None:
    """The whole point. 1!x2!x5!x5!x2!x1! = 57,600 fakes are available."""
    outcome = _outcome()
    grids = k_best_predictions(outcome, BUCKETS, TEAMS, k=5)

    assert len(grids) == 5, f"wanted 5 grids, got {len(grids)}"
    keys = [g.key for g in grids]
    assert len(set(keys)) == 5, "k-best returned duplicate grids"

    # Each alternative must actually move at least one team between buckets.
    for i, g in enumerate(grids[1:], 2):
        swaps = g.diff_vs(grids[0])
        assert swaps, f"grid {i} has no differences from grid 1"
    print(f"ok: 5 distinct grids, first alternative differs by "
          f"{len(grids[1].diff_vs(grids[0]))} swap(s)")


def test_expected_correct_is_non_increasing() -> None:
    outcome = _outcome()
    grids = k_best_predictions(outcome, BUCKETS, TEAMS, k=8)
    scores = [g.expected_correct for g in grids]
    for a, b in zip(scores, scores[1:]):
        assert a >= b - 1e-9, f"k-best out of order: {a:.6f} then {b:.6f}"
    print("ok: E[correct] non-increasing: " + ", ".join(f"{s:.4f}" for s in scores))


def test_every_grid_fills_every_bucket_exactly() -> None:
    outcome = _outcome()
    for i, g in enumerate(k_best_predictions(outcome, BUCKETS, TEAMS, k=5), 1):
        assert len(g.picks) == 16, f"grid {i} has {len(g.picks)} picks"
        assert len({p.team for p in g.picks}) == 16, f"grid {i} reuses a team"
        counts: dict[str, int] = {}
        for p in g.picks:
            counts[p.bucket_id] = counts.get(p.bucket_id, 0) + 1
        for b in BUCKETS:
            assert counts.get(b.id) == b.count, (
                f"grid {i}: bucket {b.id} has {counts.get(b.id)}, want {b.count}"
            )
    print("ok: every grid is a legal 16-team assignment")


def test_k_larger_than_available_does_not_hang() -> None:
    """A tiny board has few legal grids; asking for more must terminate."""
    buckets = [
        Bucket(id="win", label="win", count=1, points=1.0),
        Bucket(id="lose", label="lose", count=1, points=1.0),
    ]
    teams = ["A", "B"]
    outcome = FakeOutcome(
        {"A": {"win": 0.7, "lose": 0.3}, "B": {"win": 0.4, "lose": 0.6}}
    )
    grids = k_best_predictions(outcome, buckets, teams, k=50)
    assert len(grids) == 2, f"only 2 legal grids exist, got {len(grids)}"
    assert grids[0].expected_correct >= grids[1].expected_correct
    print("ok: terminates when k exceeds the number of legal grids")


if __name__ == "__main__":
    test_first_grid_matches_the_hungarian_optimum()
    test_grids_are_distinct_not_row_permutations()
    test_expected_correct_is_non_increasing()
    test_every_grid_fills_every_bucket_exactly()
    test_k_larger_than_available_does_not_hang()
    print("\nall optimize checks passed")
