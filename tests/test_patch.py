"""Checks on the gameplay-patch adjustment layer.

The layer is a hand-entered prior, so the risk is not that the arithmetic is
wrong -- it is that the layer leaks when it is supposed to be off, or that it
silently fails to reach the numbers it claims to change. Both are tested here.

    python -m tests.test_patch
"""
from __future__ import annotations

from datetime import datetime, timezone

from dota import patch as patch_mod
from dota.banner import best_banner
from dota.config import Scoring
from dota.patch import PatchAdjustment
from dota.ratings import Ratings
from dota.sources.base import PlayerGame


def _game(match_id: int, **stats: float) -> PlayerGame:
    return PlayerGame(
        account_id=1,
        match_id=match_id,
        start_time=datetime(2026, 7, 1, tzinfo=timezone.utc),
        won=True,
        duration_seconds=2100,
        stats=dict(stats),
    )


def _games() -> list[PlayerGame]:
    return [
        _game(
            i,
            kills=8.0,
            deaths=4.0,
            tower_kills=2.0,
            last_hits_denies=400.0,
            observer_wards_planted=9.0,
            teamfight_participation=0.65,
        )
        for i in range(1, 4)
    ]


def test_zero_strength_is_a_no_op():
    """--patch-strength 0 must reproduce the un-patched numbers exactly."""
    adj = PatchAdjustment(
        version="test",
        strength=0.0,
        stat_multipliers={"tower_kills": {"carry": 0.5}, "kills": {"carry": 2.0}},
    )
    assert not adj.active, "strength 0 must report inactive"

    before = _games()
    after = patch_mod.scale_games(before, "carry", adj)
    for a, b in zip(before, after):
        assert a.stats == b.stats, f"leaked at strength 0: {a.stats} -> {b.stats}"
    print("ok  strength 0 leaves every stat untouched")


def test_multiplier_reaches_the_stat():
    adj = PatchAdjustment(
        version="test",
        strength=1.0,
        stat_multipliers={"tower_kills": {"carry": 0.5}},
    )
    after = patch_mod.scale_games(_games(), "carry", adj)
    assert all(g.stats["tower_kills"] == 1.0 for g in after), (
        f"tower_kills not halved: {[g.stats['tower_kills'] for g in after]}"
    )
    assert all(g.stats["kills"] == 8.0 for g in after), "unlisted stat was touched"
    print("ok  a multiplier reaches its stat and only its stat")


def test_role_scoping():
    """A carry-only multiplier must not touch a support's line."""
    adj = PatchAdjustment(
        version="test",
        strength=1.0,
        stat_multipliers={"tower_kills": {"carry": 0.5}},
    )
    untouched = patch_mod.scale_games(_games(), "hard_support", adj)
    assert all(g.stats["tower_kills"] == 2.0 for g in untouched)
    print("ok  multipliers are scoped to the role that names them")


def test_strength_interpolates():
    adj = PatchAdjustment(
        version="test",
        strength=0.5,
        stat_multipliers={"tower_kills": {"carry": 0.8}},
    )
    # 1 + (0.8 - 1) * 0.5 = 0.9
    after = patch_mod.scale_games(_games(), "carry", adj)
    assert all(abs(g.stats["tower_kills"] - 1.8) < 1e-12 for g in after), (
        f"want 1.8, got {[g.stats['tower_kills'] for g in after]}"
    )
    print("ok  strength interpolates a multiplier toward 1.0")


def test_scale_does_not_mutate_the_input():
    """The corpus is shared; a second call must not compound the scaling."""
    adj = PatchAdjustment(
        version="test",
        strength=1.0,
        stat_multipliers={"tower_kills": {"carry": 0.5}},
    )
    original = _games()
    patch_mod.scale_games(original, "carry", adj)
    assert all(g.stats["tower_kills"] == 2.0 for g in original), (
        "scale_games mutated its input; applying it twice would compound"
    )
    print("ok  scale_games copies rather than mutating the corpus")


def test_multiplier_can_flip_a_banner_choice():
    """A large enough change must be able to move an emblem, or the layer is
    decorative. Uses a deliberately extreme multiplier -- the real config does
    not, and should not, move anything this far."""
    scoring = Scoring.load()
    means = {
        "tower_kills": 2.0,          # red, 352/unit -> 704
        "last_hits_denies": 300.0,   # red, 3/unit   -> 900
        "gold_per_min": 300.0,       # red, 2/unit   -> 600
        "deaths": 5.0,               # red, base 1950 - 195*5 -> 975
        "observer_wards_planted": 9.0,
        "teamfight_participation": 0.65,
    }
    base = best_banner("t", scoring, means)
    assert base.choices["red"].stat.key == "deaths", (
        f"fixture wrong: red went to {base.choices['red'].stat.key}"
    )

    adj = PatchAdjustment(
        version="test",
        strength=1.0,
        stat_multipliers={"tower_kills": {"carry": 4.0}},
    )
    factors = adj.source_field_multipliers("carry")
    bumped = {k: v * factors.get(k, 1.0) for k, v in means.items()}
    after = best_banner("t", scoring, bumped)
    assert after.choices["red"].stat.key == "tower_kills", (
        f"red should have flipped to tower_kills, got "
        f"{after.choices['red'].stat.key}"
    )
    print("ok  a large multiplier can move which emblem wins a colour")


def test_rating_delta():
    r = Ratings(
        values={"A": 0.5, "B": -0.5},
        games={"A": 10, "B": 10},
        half_life_days=90.0,
        prior_strength=3.0,
    )
    adj = PatchAdjustment(
        version="test", strength=0.5, team_rating_delta={"A": 0.2}
    )
    out = patch_mod.adjust_ratings(r, adj)
    assert abs(out.get("A") - 0.6) < 1e-12, f"want 0.6, got {out.get('A')}"
    assert abs(out.get("B") - (-0.5)) < 1e-12, "unlisted team was moved"
    assert abs(r.get("A") - 0.5) < 1e-12, "adjust_ratings mutated its input"
    print("ok  rating deltas are additive, scaled, and non-mutating")


def test_shipped_config_loads_and_is_conservative():
    """Guards against a fat-fingered multiplier in config/patch.yaml."""
    adj = patch_mod.load()
    if adj is None:
        print("skip config/patch.yaml is absent")
        return
    for stat, by_role in adj.stat_multipliers.items():
        for role, m in by_role.items():
            assert 0.5 <= m <= 2.0, f"{stat}/{role} multiplier {m} is implausible"
    for team, d in adj.team_rating_delta.items():
        assert abs(d) <= 0.25, f"{team} rating delta {d} is implausibly large"
    print(
        f"ok  config/patch.yaml {adj.version} loads; "
        f"{sum(len(v) for v in adj.stat_multipliers.values())} multipliers, "
        f"{len(adj.team_rating_delta)} rating deltas"
    )


if __name__ == "__main__":
    test_zero_strength_is_a_no_op()
    test_multiplier_reaches_the_stat()
    test_role_scoping()
    test_strength_interpolates()
    test_scale_does_not_mutate_the_input()
    test_multiplier_can_flip_a_banner_choice()
    test_rating_delta()
    test_shipped_config_loads_and_is_conservative()
    print("\nall patch checks passed")
