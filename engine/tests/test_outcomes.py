"""Exact enumeration: does it agree with the simulation, and with itself."""
from __future__ import annotations

import numpy as np
import pytest

from dota import bracket, bracket_picks, outcomes, ratings

PAIRINGS = [("A1", "A2"), ("B1", "B2"), ("C1", "C2"), ("D1", "D2")]

STRENGTH = {
    "A1": 0.8, "A2": 0.1, "B1": 0.5, "B2": -0.3,
    "C1": 0.2, "C2": 0.0, "D1": -0.2, "D2": -0.6,
}


def game_prob(a: str, b: str) -> float:
    return 1.0 / (1.0 + np.exp(-(STRENGTH[a] - STRENGTH[b])))


def series(a: str, b: str, bo: int) -> float:
    return ratings.series_prob(game_prob(a, b), bo)


@pytest.fixture(scope="module")
def space() -> outcomes.OutcomeSpace:
    return outcomes.enumerate_outcomes(PAIRINGS, series)


def test_every_outcome_enumerated_once(space):
    assert space.n_outcomes == 2 ** len(bracket.NODES) == 16384
    seen = {tuple(row) for row in space.winners}
    assert len(seen) == space.n_outcomes


def test_probabilities_are_a_distribution(space):
    assert space.probs.min() > 0.0
    assert space.probs.sum() == pytest.approx(1.0)
    for team in space.teams:
        assert sum(space.place_prob[team].values()) == pytest.approx(1.0)
    for node in bracket.NODES:
        assert sum(space.node_win_prob[node].values()) == pytest.approx(1.0)
        # Two teams play each match, so reach probabilities sum to two.
        assert sum(space.node_reach_prob[node].values()) == pytest.approx(2.0)


def test_outcomes_are_exactly_the_legal_fillings(space):
    enumerated = {
        tuple(picks[n] for n in bracket.NODES)
        for picks in bracket_picks.enumerate_fillings(PAIRINGS)
    }
    ours = {
        tuple(space.picks_of(i)[n] for n in bracket.NODES)
        for i in range(space.n_outcomes)
    }
    assert ours == enumerated


def test_agrees_with_the_monte_carlo_simulation(space):
    sim = bracket.simulate(PAIRINGS, game_prob, n_sims=40000, seed=7)
    for team in space.teams:
        assert space.champion_prob[team] == pytest.approx(
            sim.champion_prob[team], abs=0.01
        )
        assert space.top4_prob[team] == pytest.approx(sim.top4_prob[team], abs=0.015)
    for node in bracket.NODES:
        for team, p in space.node_win_prob[node].items():
            assert p == pytest.approx(sim.node_win_prob[node].get(team, 0.0), abs=0.015)


def test_symmetric_field_is_a_perfectly_flat_bracket():
    flat = outcomes.enumerate_outcomes(PAIRINGS, lambda a, b, bo: 0.5)
    for team in flat.teams:
        assert flat.champion_prob[team] == pytest.approx(0.125)
        assert flat.place_prob[team]["5-6th"] == pytest.approx(0.25)
    # 14 coin flips, so every outcome is equally likely -- but a pick is still
    # only worth 50% at the four round-one matches, where both participants are
    # known. Later, a pick has to name the right team *and* get it there: 25% in
    # round two, 12.5% anywhere eight teams can reach. That sums to
    # 4(.5) + 2(.25) + .125 + 2(.25) + 2(.125) + 3(.125) = 3.75, which is what a
    # bracket is worth when nothing is known at all.
    assert flat.probs.max() == pytest.approx(flat.probs.min())
    best = outcomes.best_bracket(flat)
    assert best.expected_correct == pytest.approx(3.75)
    assert best.perfect_prob == pytest.approx(2.0**-14)


def test_scoring_a_bracket_matches_its_marginals(space):
    best = outcomes.best_bracket(space)
    assert best.expected_correct == pytest.approx(
        sum(best.per_node[n] for n in bracket.NODES)
    )
    assert sum(best.distribution.values()) == pytest.approx(1.0)
    assert best.at_least(0) == pytest.approx(1.0)
    assert best.at_least(len(bracket.NODES)) == pytest.approx(best.perfect_prob)
    # No legal bracket can beat the optimum, by construction.
    for i in range(0, space.n_outcomes, 97):
        picks = space.picks_of(i)
        e = sum(space.node_win_prob[n][picks[n]] for n in bracket.NODES)
        assert e <= best.expected_correct + 1e-12


def test_a_pick_that_cannot_happen_scores_zero(space):
    # D2 loses to D1 in every filling that also predicts D1 through F, so a
    # bracket claiming both is illegal and scores no chance of being perfect.
    impossible = dict(space.picks_of(0))
    impossible["GF"] = "D2" if impossible["GF"] != "D2" else "A1"
    score = space.score(impossible)
    assert score.perfect_prob == 0.0
    assert space.hits(impossible).max() < len(bracket.NODES)
