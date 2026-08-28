"""Checks on banner scoring and roster search. Run: python -m tests.test_fantasy

These pin the two statistical traps described in the README, both of which
produce confident nonsense rather than an error:

  * ranking by best OBSERVED game, which rewards having played more games
  * estimating the ceiling from a full-sample variance, which lets blowout
    losses inflate a projected maximum
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from dota.banner import banner_score_for_game, best_banner
from dota.config import Config, Player, Scoring, Stat
from dota.fantasy import (
    expected_best_series,
    profile_player,
    project_slot,
    weighted_stat_means,
)
from dota.optimize import enumerate_fantasy_rosters

NOW = datetime(2026, 8, 1, tzinfo=timezone.utc)


def _scoring(**over) -> Scoring:
    """A miniature scoring config: one stat per colour, so a banner is forced."""
    stats = {
        "kills": Stat(key="kills", per_unit=107.0, color="red"),
        "deaths": Stat(key="deaths", per_unit=-195.0, color="red", base=1950.0),
        "gold_per_min": Stat(key="gold_per_min", per_unit=2.0, color="red"),
        "observer_wards_planted": Stat(
            key="observer_wards_planted", per_unit=117.0, color="blue"
        ),
        "camps_stacked": Stat(key="camps_stacked", per_unit=234.0, color="blue"),
        "teamfight_participation": Stat(
            key="teamfight_participation", per_unit=2124.0, color="green"
        ),
        "roshan_kills": Stat(key="roshan_kills", per_unit=1172.0, color="green"),
    }
    return Scoring(
        stats=over.get("stats", stats),
        quality={},
        traits={},
        colors=["red", "blue", "green"],
        coach_titles={},
        verified=False,
        version="test",
    )


SCORING = _scoring()


def game(days_ago: int, **stats: float):
    from dota.sources.base import PlayerGame

    return PlayerGame(
        account_id=1,
        match_id=days_ago,
        start_time=NOW - timedelta(days=days_ago),
        won=True,
        duration_seconds=2000,
        stats=dict(stats),
    )


# One tournament shape: five series of two or three games.
SERIES_14 = [(2, 3, 2, 3, 2)]


def test_only_banner_stats_score():
    """The rule the whole model rests on. Everything off the banner is worth 0."""
    means = {"kills": 10.0, "gold_per_min": 600.0, "camps_stacked": 3.0,
             "roshan_kills": 1.0}
    plan = best_banner("p", SCORING, means)
    assert plan.choices["red"].stat.key == "gold_per_min", "red should take GPM (1,200)"

    # A game where the banner stats are unchanged but a non-banner stat spikes.
    base = banner_score_for_game(plan, means, SCORING)
    spiked = banner_score_for_game(plan, {**means, "kills": 40.0}, SCORING)
    assert base == spiked, f"a non-banner stat leaked into the score: {base} vs {spiked}"
    print("ok  only the three banner stats score; everything else is worth zero")


def test_deaths_pay_a_base_less_a_penalty():
    """Deaths are the one inverted stat: a flat base minus a per-death charge."""
    stat = SCORING.stats["deaths"]
    assert stat.points(0.0) == 1950.0
    assert stat.points(5.0) == 1950.0 - 195.0 * 5
    assert stat.points(10.0) == 0.0, "ten deaths should exactly zero the emblem"
    print("ok  deaths pay 1,950 base less 195 each, reaching zero at ten")


def test_unmeasurable_stats_are_excluded_not_zeroed():
    """A stat the source cannot see must never be *chosen*, because scoring it
    as zero would silently deflate whichever colour it sits on."""
    stats = dict(SCORING.stats)
    stats["roshan_kills"] = Stat(
        key="roshan_kills", per_unit=1172.0, color="green", measurable=False
    )
    scoring = _scoring(stats=stats)
    means = {"roshan_kills": 5.0, "teamfight_participation": 0.5}
    plan = best_banner("p", scoring, means)
    assert plan.choices["green"].stat.key == "teamfight_participation", (
        "an unmeasurable stat was put on the banner"
    )
    print("ok  unmeasurable stats are excluded from emblem choice, not scored as 0")


def test_missing_measurement_is_not_a_measured_zero():
    means = {"kills": 10.0}
    plan = best_banner("p", SCORING, means)
    # Only red is fillable; blue and green have nothing measured at all.
    assert "red" in plan.choices
    assert "blue" not in plan.choices and "green" not in plan.choices
    print("ok  a colour with no observed stat is left empty rather than filled with 0")


def test_recency_weighting():
    recent_good = [game(1, kills=20.0), game(200, kills=1.0)]
    recent_bad = [game(1, kills=1.0), game(200, kills=20.0)]
    a, _ = weighted_stat_means(recent_good, as_of=NOW, half_life_days=30)
    b, _ = weighted_stat_means(recent_bad, as_of=NOW, half_life_days=30)
    assert a["kills"] > b["kills"], f"{a['kills']} should beat {b['kills']}"
    print(
        f"ok  recency weighting: fresh-good {a['kills']:.1f} > "
        f"stale-good {b['kills']:.1f} kills/game"
    )


def test_no_sample_size_bias():
    """The core fix. Two players drawn from an IDENTICAL distribution must
    project the same, even when one has ten times the sampled games. Ranking
    by best OBSERVED game fails this badly -- the max of 60 draws beats the max
    of 6 from the same distribution, so sample count masquerades as skill."""
    import random

    rng = random.Random(42)
    dist = [rng.lognormvariate(8.0, 0.35) for _ in range(600)]
    few, many = dist[:6], dist[:60]

    a = expected_best_series(few, SERIES_14, rng=np.random.default_rng(1))
    b = expected_best_series(many, SERIES_14, rng=np.random.default_rng(1))

    assert max(many) > max(few), "premise: more draws, bigger observed max"
    gap = abs(a - b) / b
    assert gap < 0.15, f"sample-size bias leaked through: {gap:.1%}"
    print(
        f"ok  no sample-size bias: 6 games -> {a:,.0f}, 60 games -> {b:,.0f} "
        f"({gap:.1%} apart), while raw observed maxima differ by "
        f"{(max(many) - max(few)) / max(few):.0%}"
    )


def test_variance_is_an_asset():
    """Under a max objective, spread pays: only the ceiling is ever recorded."""
    steady = [2000.0, 2000.0, 2100.0, 1900.0, 2000.0, 2000.0]
    swingy = [800.0, 3400.0, 1100.0, 3100.0, 900.0, 2700.0]
    assert abs(np.mean(steady) - np.mean(swingy)) < 50.0, "means should be close"

    a = expected_best_series(steady, SERIES_14, rng=np.random.default_rng(3))
    b = expected_best_series(swingy, SERIES_14, rng=np.random.default_rng(3))
    assert b > a, f"swingy {b:,.0f} should beat steady {a:,.0f}"
    print(
        f"ok  variance is an asset: same mean, SD {np.std(steady):,.0f} -> "
        f"{a:,.0f} vs SD {np.std(swingy):,.0f} -> {b:,.0f}"
    )


def test_more_games_helps_but_weakly():
    """Extra series still raise the expected maximum, but with heavy diminishing
    returns -- unlike a sum, where they would scale linearly."""
    pool = [1200.0, 1800.0, 2200.0, 1500.0, 2500.0, 1900.0, 1700.0, 2100.0]
    short = expected_best_series(pool, [(2, 2, 2)], rng=np.random.default_rng(5))
    long = expected_best_series(
        pool, [(2, 2, 2, 2, 2, 2)], rng=np.random.default_rng(5)
    )
    assert long > short, "more series should not hurt"
    ratio = long / short
    assert ratio < 1.30, f"doubling series should not near-double the max: {ratio:.2f}"
    print(
        f"ok  doubling series 3->6 raises E[best] only {ratio - 1:.1%} "
        f"({short:,.0f} -> {long:,.0f}), not 100%"
    )


def test_duo_shares_one_banner_fitted_to_the_pair():
    """A banner belongs to the role slot, not the player. Both members of a duo
    are scored through the same three emblems, so the banner is fitted to their
    combined line -- which is a real cost when their strengths do not overlap."""
    warder = Player(nick="W", role="soft_support", team="T", account_id=1)
    stacker = Player(nick="S", role="hard_support", team="T", account_id=2)
    games = {
        1: [game(i, observer_wards_planted=14.0, camps_stacked=0.0,
                 teamfight_participation=0.6, kills=3.0) for i in range(1, 7)],
        2: [game(i, observer_wards_planted=0.0, camps_stacked=6.0,
                 teamfight_participation=0.6, kills=3.0) for i in range(1, 7)],
    }
    profiles = {
        warder.key: profile_player(warder, games[1], SCORING, as_of=NOW),
        stacker.key: profile_player(stacker, games[2], SCORING, as_of=NOW),
    }
    # Alone, each would take a different blue emblem.
    assert profiles[warder.key].banner.choices["blue"].stat.key == "observer_wards_planted"
    assert profiles[stacker.key].banner.choices["blue"].stat.key == "camps_stacked"

    slot = project_slot(
        "support", "T", [warder, stacker], profiles, games, SCORING, SERIES_14,
        rng=np.random.default_rng(11),
    )
    assert slot.banner is not None
    assert len({id(b) for b in slot.banners.values()}) == 1, "duo must share a banner"
    # Combined: 7 wards vs 3 stacks -> 819 vs 702, so wards win for the pair.
    assert slot.banner.choices["blue"].stat.key == "observer_wards_planted"
    print(
        "ok  duo shares one banner fitted to the pair, not the better of the two "
        f"({slot.banner.choices['blue'].label} on blue)"
    )


def test_roster_search_respects_duo_rule():
    cfg = Config()
    rng = np.random.default_rng(13)
    games = {
        p.account_id: [
            game(i, kills=5.0, gold_per_min=500.0, observer_wards_planted=4.0,
                 teamfight_participation=0.6)
            for i in range(1, 5)
        ]
        for p in cfg.roster.all_players()
        if p.account_id
    }
    profiles = {
        p.key: profile_player(p, games.get(p.account_id or -1, []), SCORING, as_of=NOW)
        for p in cfg.roster.all_players()
    }
    slots = {}
    for team in cfg.roster.teams:
        for slot, roles in (
            ("core", ("carry", "offlane")),
            ("support", ("soft_support", "hard_support")),
            ("mid", ("mid",)),
        ):
            players = [team.by_role(r) for r in roles]
            slots[f"{slot}/{team.name}"] = project_slot(
                slot, team.name, players, profiles, games, SCORING, SERIES_14, rng=rng
            )

    rosters = enumerate_fantasy_rosters(cfg.roster, slots, top_n=5)
    assert rosters, "no rosters produced"
    for r in rosters:
        assert r.support_team in cfg.roster.names
        assert r.core_team in cfg.roster.names
        mid = cfg.roster.get(r.mid_team).by_role("mid")
        assert mid.nick == r.mid_player, "mid must be that team's mid laner"
    top = rosters[0]
    assert abs(top.projected_total - sum(top.breakdown.values())) < 1e-6
    print(f"ok  roster search: {len(rosters)} legal rosters, duo rule holds")


if __name__ == "__main__":
    test_only_banner_stats_score()
    test_deaths_pay_a_base_less_a_penalty()
    test_unmeasurable_stats_are_excluded_not_zeroed()
    test_missing_measurement_is_not_a_measured_zero()
    test_recency_weighting()
    test_no_sample_size_bias()
    test_variance_is_an_asset()
    test_more_games_helps_but_weakly()
    test_duo_shares_one_banner_fitted_to_the_pair()
    test_roster_search_respects_duo_rule()
    print("\nall fantasy tests passed")
