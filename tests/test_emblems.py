"""Banner arithmetic and ordering. Run: python -m tests.test_emblems"""
from __future__ import annotations

from dota import emblems
from dota.config import Config


def test_derived_percentages_match_the_client():
    """The load-bearing test in this file.

    Every projection is scaled by these multipliers, and they arrive by a human
    reading a screenshot. Deriving them independently from tier + trait +
    neighbours and demanding agreement on all fifteen catches a mis-transcription
    and a wrong model of the trait rules with one assertion.

    It also pins down two things that look like contradictions in the client and
    are not: a Fractal emblem showing -10% is Fractal *not firing* plus a Vampiric
    neighbour charging it, and a Fractal showing +20% is a Benevolent neighbour
    paying it.
    """
    cfg = Config()
    banners = emblems.load()
    assert set(banners) == {"core", "mid", "support"}, sorted(banners)
    checked = 0
    for slot, banner in banners.items():
        problems = emblems.check_against_client(banner, cfg.scoring)
        assert not problems, f"{slot}: " + "; ".join(problems)
        checked += sum(1 for e in banner if e.displayed is not None)
    assert checked == 15, checked
    print(f"ok  all {checked} displayed percentages reproduce from tier+trait+neighbours")


def test_positional_traits_actually_move_things():
    cfg = Config()
    support = emblems.load()["support"]
    m = emblems.multipliers(support, cfg.scoring)
    by_stat = {e.stat: v for e, v in zip(support, m)}
    # Runes sits between both Vampirics: Tier IV (+100) and -10 twice.
    assert abs(by_stat["rune_pickups"] - 1.80) < 1e-9, by_stat
    # Stuns is Vampiric itself: +50 on top of Tier IV, and its own neighbours'
    # traits (Friendly, Fractal) take nothing from it.
    assert abs(by_stat["seconds_stunned"] - 2.50) < 1e-9, by_stat
    print("ok  Vampiric penalties land on neighbours, not on the Vampiric emblem")


def test_dead_conditions_are_dead():
    """Fractal needs every quality to differ; Friendly needs three of them. Both
    fail on these banners, and a model that quietly paid them would inflate every
    projection by tens of percent."""
    cfg = Config()
    for slot, banner in emblems.load().items():
        for e in banner:
            bonus = emblems.self_bonus(e, banner, cfg.scoring)
            if e.trait == "fractal":
                assert bonus == 0.0, f"{slot}/{e.stat}: Fractal should not fire"
            if e.trait == "friendly":
                assert bonus == 0.0, f"{slot}/{e.stat}: Friendly needs 3 Friendly"
            if e.trait == "unique":
                assert bonus > 0.0, f"{slot}/{e.stat}: sole Unique should fire"
    print("ok  Fractal and Friendly are dead on these banners; Unique fires")


def test_best_order_never_loses_and_uses_the_ends():
    """Reordering is free, so the optimum must be at least as good as what is in
    the client -- and with a cheap enough emblem available, a Vampiric belongs at
    an end where it has one neighbour instead of two."""
    cfg = Config()
    banners = emblems.load()
    # A worthless stat and two rich ones: the Vampirics should be pushed away from
    # the rich emblems.
    base = {
        "smokes_used": 1000.0,
        "seconds_stunned": 500.0,
        "rune_pickups": 300.0,
        "teamfight_participation": 1400.0,
        "lotuses_grabbed": 0.0,
    }
    banner = banners["support"]
    order, pts, now = emblems.best_order(banner, cfg.scoring, base)
    assert pts >= now - 1e-9, (pts, now)
    vamp_positions = [i for i, e in enumerate(order) if e.trait == "vampiric"]
    neighbours = {
        j for i in vamp_positions for j in (i - 1, i + 1) if 0 <= j < len(order)
    }
    rich = {"teamfight_participation", "smokes_used"}
    penalised_rich = {order[j].stat for j in neighbours} & rich
    # teamfight_participation is itself Vampiric here, so it can sit beside the
    # other Vampiric; what must NOT happen is the untouchable Smokes taking a hit
    # while a zero-value emblem sits at an end.
    assert "smokes_used" not in penalised_rich, [e.stat for e in order]
    print(
        f"ok  optimal order {'>'.join(e.stat[:4] for e in order)} pays {pts:,.0f} "
        f"vs {now:,.0f} as rolled"
    )


def test_flat_loader_agrees_with_the_structure():
    from scripts.fixed_banner import load_banners

    cfg = Config()
    flat = load_banners(scoring=cfg.scoring)
    for slot, banner in emblems.load().items():
        derived = emblems.multipliers(banner, cfg.scoring)
        for e, m in zip(banner, derived):
            assert abs(flat[slot][e.stat] - m) < 1e-9, (slot, e.stat, flat[slot][e.stat], m)
    print("ok  the flat {stat: multiplier} view matches the derived multipliers")


if __name__ == "__main__":
    test_derived_percentages_match_the_client()
    test_positional_traits_actually_move_things()
    test_dead_conditions_are_dead()
    test_best_order_never_loses_and_uses_the_ends()
    test_flat_loader_agrees_with_the_structure()
    print("\nall emblem tests passed")
