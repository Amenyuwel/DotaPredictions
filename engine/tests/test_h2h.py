"""Head-to-head blending. Run: python -m tests.test_h2h"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from dota.h2h import H2HModel, brier, log_loss
from dota.sources.base import MatchResult

NOW = datetime(2026, 8, 18, tzinfo=timezone.utc)


def _m(match_id: int, winner: str, loser: str, days_ago: int) -> MatchResult:
    return MatchResult(
        match_id=match_id,
        start_time=NOW - timedelta(days=days_ago),
        radiant_team_id=None,
        dire_team_id=None,
        radiant_name=winner,
        dire_name=loser,
        radiant_win=True,
        league_id=1,
        league_name="L",
        duration_seconds=2400,
    )


def test_never_met_falls_back_to_the_rating():
    """The case that decides whether this is usable at all: four pairs in the real
    bracket have never met, and a head-to-head term must leave those predictions
    exactly as the rating had them rather than inventing a number."""
    m = H2HModel.build([_m(1, "A", "B", 10)], as_of=NOW)
    assert m.meetings("C", "D") == 0.0
    for k in (0.0, 1.0, 20.0):
        assert m.adjust(0.62, "C", "D", prior_k=k) == 0.62
    print("ok  a pair that never met keeps the rating's prediction untouched")


def test_shrinkage_moves_toward_the_record_with_evidence():
    one = H2HModel.build([_m(i, "A", "B", 5) for i in range(1)], as_of=NOW)
    many = H2HModel.build([_m(i, "A", "B", 5) for i in range(12)], as_of=NOW)
    p = 0.50
    p_one = one.adjust(p, "A", "B", prior_k=10.0)
    p_many = many.adjust(p, "A", "B", prior_k=10.0)
    assert p < p_one < p_many, (p_one, p_many)
    # An infinite prior is the switch that turns the whole term off.
    assert many.adjust(p, "A", "B", prior_k=float("inf")) == p
    print(f"ok  1 win -> {p_one:.1%}, 12 wins -> {p_many:.1%}, prior=inf -> {p:.1%}")


def test_recency_discounts_old_results():
    fresh = H2HModel.build([_m(1, "A", "B", 2)], half_life_days=30.0, as_of=NOW)
    stale = H2HModel.build([_m(1, "A", "B", 180)], half_life_days=30.0, as_of=NOW)
    assert fresh.meetings("A", "B") > stale.meetings("A", "B")
    assert fresh.adjust(0.5, "A", "B", prior_k=5.0) > stale.adjust(0.5, "A", "B", prior_k=5.0)
    print("ok  a six-month-old result counts for less than a recent one")


def test_perfect_record_is_not_a_certainty():
    """A 3-0 record is not proof. Probabilities must stay off the boundary or a single
    upset produces an infinite log-loss."""
    m = H2HModel.build([_m(i, "A", "B", 3) for i in range(3)], as_of=NOW)
    p = m.adjust(0.55, "A", "B", prior_k=0.0)
    assert p < 1.0, p
    assert log_loss(p, won=False) < 20.0, "a lost match must not score as impossible"
    print(f"ok  a spotless 3-0 reads as {p:.2%}, not 100%")


def test_scoring_rules_behave():
    assert log_loss(0.9, True) < log_loss(0.6, True) < log_loss(0.1, True)
    assert brier(0.9, True) < brier(0.6, True) < brier(0.1, True)
    assert abs(log_loss(0.5, True) - log_loss(0.5, False)) < 1e-12
    print("ok  log-loss and Brier both punish confident wrong answers")


def test_symmetry_of_the_record():
    m = H2HModel.build([_m(1, "A", "B", 5), _m(2, "B", "A", 5)], as_of=NOW)
    wa, wb = m.record("A", "B")
    wb2, wa2 = m.record("B", "A")
    assert (wa, wb) == (wa2, wb2)
    assert abs(m.adjust(0.5, "A", "B", prior_k=1.0) - 0.5) < 1e-9, "1-1 should not move 50%"
    print("ok  records are symmetric and an even record moves nothing")


if __name__ == "__main__":
    test_never_met_falls_back_to_the_rating()
    test_shrinkage_moves_toward_the_record_with_evidence()
    test_recency_discounts_old_results()
    test_perfect_record_is_not_a_certainty()
    test_scoring_rules_behave()
    test_symmetry_of_the_record()
    print("\nall head-to-head tests passed")
