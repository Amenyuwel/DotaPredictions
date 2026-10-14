"""Checks on the factor stack that corrects raw stat lines.

Every number this module produces is a multiplier applied to a stat before
anything is projected from it, and none of them raise on the way through. A
wrong elasticity, an index that silently misses, a weight that leaks when the
factor is off -- each one comes out as a plausible stat line rather than as an
error, which is the whole reason these are pinned here.

The traps, one per group below:

  * a fitted coefficient recovered from data with a KNOWN answer, so "the
    regression runs" cannot pass for "the regression is right"
  * the too-small-sample guard, because returning an empty dict is what makes
    the caller leave the stat uncorrected rather than correct it from noise
  * the opponent index resolving to the OTHER side, which is the one thing it
    cannot get backwards without inverting the correction
  * round-tripping normalise -> restate, since `restate` claims to evaluate the
    same coefficients at different conditions and is the only reason
    `main_event` does not refit them
  * an absent measurement staying absent, never becoming a zero

    python -m pytest tests/test_factors.py
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from dota import factors
from dota.config import Player
from dota.sources.base import MatchResult, PlayerGame

WHEN = datetime(2026, 7, 1, tzinfo=timezone.utc)


def _game(
    match_id: int,
    *,
    account_id: int = 1,
    minutes: float = 40.0,
    hero_id: int | None = None,
    **stats: float,
) -> PlayerGame:
    return PlayerGame(
        account_id=account_id,
        match_id=match_id,
        start_time=WHEN,
        won=True,
        duration_seconds=int(minutes * 60),
        stats=dict(stats),
        hero_id=hero_id,
    )


def _match(
    match_id: int,
    radiant: str | None,
    dire: str | None,
    *,
    league_id: int | None = None,
) -> MatchResult:
    return MatchResult(
        match_id=match_id,
        start_time=WHEN,
        radiant_team_id=None,
        dire_team_id=None,
        radiant_name=radiant,
        dire_name=dire,
        radiant_win=True,
        league_id=league_id,
    )


# ---------------------------------------------------------------------------
# 1. Duration
# ---------------------------------------------------------------------------


def test_elasticity_recovers_a_known_exponent() -> None:
    """Build stats that scale exactly as duration^0.8 and get 0.8 back.

    Asserting only that a number comes out would pass for a regression fitted
    on the wrong axis, or one off by a sign.
    """
    games = [
        _game(i, minutes=m, last_hits_denies=10.0 * m**0.8)
        for i, m in enumerate(range(20, 80), start=1)
    ]
    elasticity, diag = factors.fit_duration_elasticity(games, ["last_hits_denies"])

    assert elasticity["last_hits_denies"] == pytest.approx(0.8, abs=1e-6)
    assert diag["last_hits_denies"]["r2"] == pytest.approx(1.0, abs=1e-6)
    assert diag["last_hits_denies"]["n"] == len(games)


def test_a_stat_that_does_not_scale_gets_a_flat_elasticity() -> None:
    """Teamfight participation is a fraction. The right answer is zero, and a
    near-zero fit is what stops `normalise_duration` from moving it."""
    games = [
        _game(i, minutes=m, teamfight_participation=0.65)
        for i, m in enumerate(range(20, 80), start=1)
    ]
    elasticity, _ = factors.fit_duration_elasticity(games, ["teamfight_participation"])

    assert elasticity["teamfight_participation"] == pytest.approx(0.0, abs=1e-6)


def test_too_few_games_fits_nothing_rather_than_fitting_noise() -> None:
    """Under the sample floor the dict is EMPTY, not full of shaky numbers.

    `normalise_duration` short-circuits on an empty dict, so this is what makes
    a thin corpus leave the stat alone instead of scaling it by an exponent
    fitted from a handful of games.
    """
    games = [_game(i, minutes=30.0 + i, last_hits_denies=300.0 + i) for i in range(10)]
    elasticity, diag = factors.fit_duration_elasticity(games, ["last_hits_denies"])

    assert elasticity == {}
    assert diag == {}
    assert factors.normalise_duration(games, elasticity) is games


def test_a_wild_elasticity_is_clamped() -> None:
    """A sparse stat can fit an exponent that would blow a short game up by
    orders of magnitude. The clamp is what keeps that a distortion instead of
    a catastrophe."""
    games = [
        _game(i, minutes=m, roshan_kills=(m**6) / 1e6)
        for i, m in enumerate(range(20, 80), start=1)
    ]
    elasticity, _ = factors.fit_duration_elasticity(games, ["roshan_kills"])

    assert elasticity["roshan_kills"] == 2.0


def test_normalising_moves_every_game_to_the_reference_length() -> None:
    """Two games of different lengths, same underlying rate, must come out
    equal -- that is the entire point of the yardstick."""
    elasticity = {"last_hits_denies": 1.0}
    short = _game(1, minutes=20.0, last_hits_denies=200.0)
    long = _game(2, minutes=60.0, last_hits_denies=600.0)

    out = factors.normalise_duration([short, long], elasticity)

    assert out[0].stats["last_hits_denies"] == pytest.approx(400.0)
    assert out[1].stats["last_hits_denies"] == pytest.approx(400.0)
    assert factors.REFERENCE_MINUTES == 40.0


def test_normalising_leaves_unfitted_stats_and_unknown_durations_alone() -> None:
    """A stat with no fitted elasticity is untouched, not treated as b=0 or
    dropped; a game with no duration is passed through whole."""
    elasticity = {"last_hits_denies": 1.0}
    games = [
        _game(1, minutes=20.0, last_hits_denies=200.0, kills=8.0),
        _game(2, minutes=0.0, last_hits_denies=200.0),
    ]

    out = factors.normalise_duration(games, elasticity)

    assert out[0].stats["kills"] == 8.0
    assert out[1].stats["last_hits_denies"] == 200.0


def test_normalising_does_not_mutate_the_games_it_was_given() -> None:
    """The corpus is reused by later factors and by the fixed-banner path. A
    layer that edited in place would apply twice and nothing would say so."""
    games = [_game(1, minutes=20.0, last_hits_denies=200.0)]

    factors.normalise_duration(games, {"last_hits_denies": 1.0})

    assert games[0].stats["last_hits_denies"] == 200.0


# ---------------------------------------------------------------------------
# 2. Opponent strength
# ---------------------------------------------------------------------------


def test_the_opponent_index_resolves_to_the_other_side() -> None:
    """Backwards here inverts the correction: farm against a strong side would
    be discounted as if it came against a weak one."""
    players = [Player(nick="ame", role="carry", team="Falcons", account_id=11)]
    matches = [
        _match(1, "Falcons", "Spirit"),
        _match(2, "Liquid", "Falcons"),
        _match(3, "Liquid", "Spirit"),
    ]

    index = factors.build_opponent_index(matches, players)

    assert index[(11, 1)] == "Spirit"
    assert index[(11, 2)] == "Liquid"
    assert (11, 3) not in index


def test_the_opponent_index_skips_players_and_sides_it_cannot_name() -> None:
    """A player with no resolved account and a match with one side unnamed are
    both absent rather than guessed. `normalise_opponent` leaves a game it
    cannot find alone, so absent is the safe answer."""
    players = [
        Player(nick="ame", role="carry", team="Falcons", account_id=11),
        Player(nick="stand-in", role="mid", team="Falcons"),
    ]
    matches = [_match(1, "Falcons", None), _match(2, None, "Falcons")]

    index = factors.build_opponent_index(matches, players)

    assert index == {}


def test_the_opponent_slope_recovers_a_known_sign_and_size() -> None:
    games = [_game(i, last_hits_denies=400.0 * math.exp(-0.5 * (i / 100.0))) for i in range(60)]
    rating = {(1, i): i / 100.0 for i in range(60)}

    slope, diag = factors.fit_opponent_slope(games, rating, ["last_hits_denies"])

    assert slope["last_hits_denies"] == pytest.approx(-0.5, abs=1e-6)
    assert diag["last_hits_denies"]["n"] == 60


def test_normalising_opponent_restates_onto_the_reference_rating() -> None:
    """A game against a weaker-than-reference side is marked down, and one
    against a stronger side is marked up."""
    slope = {"last_hits_denies": -0.5}
    games = [_game(1, last_hits_denies=400.0), _game(2, last_hits_denies=400.0)]
    rating = {(1, 1): -1.0, (1, 2): 1.0}

    out = factors.normalise_opponent(games, slope, rating, reference=0.0)

    assert out[0].stats["last_hits_denies"] == pytest.approx(400.0 * math.exp(-0.5))
    assert out[1].stats["last_hits_denies"] == pytest.approx(400.0 * math.exp(0.5))


def test_a_game_with_no_known_opponent_passes_through_unchanged() -> None:
    slope = {"last_hits_denies": -0.5}
    games = [_game(7, last_hits_denies=400.0)]

    out = factors.normalise_opponent(games, slope, {}, reference=0.0)

    assert out[0].stats["last_hits_denies"] == 400.0


# ---------------------------------------------------------------------------
# 2b. Restating
# ---------------------------------------------------------------------------


def test_restate_is_the_inverse_of_normalising() -> None:
    """Normalise to 40 minutes, restate back to the game's own length, and the
    original number must return.

    This is what lets `main_event` evaluate the pipeline's own coefficients at
    45 minutes instead of refitting them -- a second fit would be a second set
    of numbers that could disagree with the ones the projection used.
    """
    elasticity = {"last_hits_denies": 0.8}
    game = _game(1, minutes=52.0, last_hits_denies=500.0)

    normalised = factors.normalise_duration([game], elasticity)
    back = factors.restate(
        normalised,
        elasticity=elasticity,
        minutes_from=factors.REFERENCE_MINUTES,
        minutes_to=52.0,
    )

    assert back[0].stats["last_hits_denies"] == pytest.approx(500.0)


def test_restate_composes_duration_and_opponent_in_one_pass() -> None:
    elasticity = {"last_hits_denies": 1.0}
    slope = {"last_hits_denies": -0.5}

    out = factors.restate(
        [_game(1, last_hits_denies=400.0)],
        elasticity=elasticity,
        minutes_from=40.0,
        minutes_to=45.0,
        slope=slope,
        rating_from=0.0,
        rating_to=1.0,
    )

    expected = 400.0 * (45.0 / 40.0) ** 1.0 * math.exp(-0.5 * 1.0)
    assert out[0].stats["last_hits_denies"] == pytest.approx(expected)


def test_restate_with_nothing_to_apply_returns_the_games_untouched() -> None:
    """Asked for no correction it must not quietly apply half of one."""
    games = [_game(1, last_hits_denies=400.0)]

    assert factors.restate(games) is games
    assert factors.restate(games, elasticity={"last_hits_denies": 1.0}) is games


# ---------------------------------------------------------------------------
# 3. League strength
# ---------------------------------------------------------------------------


def test_league_strength_averages_the_teams_that_actually_played() -> None:
    rating = {"Falcons": 2.0, "Spirit": 1.0, "Nobody": 0.0}
    matches = [
        _match(1, "Falcons", "Spirit", league_id=100),
        _match(2, "Falcons", "Unrated", league_id=100),
        _match(3, "Spirit", "Nobody", league_id=200),
        _match(4, "Falcons", "Spirit"),
    ]

    strength = factors.league_strength(matches, rating)

    assert strength[100] == pytest.approx((2.0 + 1.0 + 2.0) / 3)
    assert strength[200] == pytest.approx(0.5)
    # A match with no league id belongs to no league, rather than to a null one.
    assert set(strength) == {100, 200}


def test_a_weak_league_is_discounted_and_a_strong_one_is_not_inflated() -> None:
    """Weights are capped at 1: a strong league is full evidence, never MORE
    than full, or one stacked qualifier could outvote the rest of the corpus."""
    strength = {100: 2.0, 200: 0.0}
    games = [_game(1), _game(2), _game(3)]
    match_league = {1: 100, 2: 200}

    weights = factors.league_weights(games, match_league, strength, spread=0.5)

    assert weights[1] == 1.0
    assert weights[2] == pytest.approx(math.exp(-0.5 * 1.0))
    # A game whose league is unknown is full weight, not zero weight.
    assert weights[3] == 1.0


def test_league_weights_with_no_strengths_is_empty_rather_than_all_ones() -> None:
    """Empty is what tells the caller the factor could not run. All-ones would
    be indistinguishable from a factor that ran and found nothing to change."""
    assert factors.league_weights([_game(1)], {1: 100}, {}) == {}


# ---------------------------------------------------------------------------
# 4. Hero pool
# ---------------------------------------------------------------------------


def test_hero_weights_price_the_hero_and_default_to_neutral() -> None:
    games = [_game(1, hero_id=41), _game(2, hero_id=99), _game(3)]

    weights = factors.hero_weights(games, {41: 1.2})

    assert weights[1] == 1.2
    assert weights[2] == 1.0  # not in the viability table
    assert weights[3] == 1.0  # no hero recorded


def test_hero_weights_with_no_viability_is_empty() -> None:
    assert factors.hero_weights([_game(1, hero_id=41)], {}) == {}


def test_hero_profile_counts_only_games_with_a_hero() -> None:
    games = [_game(1, hero_id=41), _game(2, hero_id=41), _game(3)]

    assert factors.hero_profile(games) == {41: 2}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def test_a_report_says_which_kind_of_thing_it_is() -> None:
    """The audit distinguishes a measurement from a judgement from a hole. A
    factor that reported them alike would let an assumption read as data."""
    measured = factors.FactorReport("duration", "data", True, "n=600")
    assumed = factors.FactorReport("hero", "assumption", True, "patch notes")
    absent = factors.FactorReport("emblem_inventory", "absent", True, "no source")
    off = factors.FactorReport("h2h", "data", False, "disabled")

    assert measured.status == "measured"
    assert assumed.status == "assumed"
    assert absent.status == "missing"
    assert off.status == "off"


def test_an_unmeasured_stat_is_absent_rather_than_zero() -> None:
    """The rule the whole stack rests on: no key means no signal. A factor that
    filled in a 0.0 would deflate the projection and look like evidence."""
    elasticity = {"observer_wards_planted": 1.0}
    game = _game(1, minutes=20.0, last_hits_denies=200.0)

    out = factors.normalise_duration([game], elasticity)

    assert "observer_wards_planted" not in out[0].stats
    assert out[0].per_game("observer_wards_planted") is None
