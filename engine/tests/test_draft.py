"""Draft availability layer. Run: python -m tests.test_draft"""
from __future__ import annotations

from datetime import datetime, timezone

from dota.draft import PRIOR_MATCHES, DraftAction, DraftModel
from dota.sources.base import MatchResult, PlayerGame

RADIANT, DIRE = 0, 1


def _match(match_id: int, radiant: str, dire: str) -> MatchResult:
    return MatchResult(
        match_id=match_id,
        start_time=datetime(2026, 8, 1, tzinfo=timezone.utc),
        radiant_team_id=None,
        dire_team_id=None,
        radiant_name=radiant,
        dire_name=dire,
        radiant_win=True,
        league_id=1,
        league_name="L",
        duration_seconds=2400,
    )


def _corpus(n: int = 40):
    """`n` matches of A vs B. A always bans hero 1; nobody touches hero 2."""
    matches = [_match(i, "A", "B") for i in range(n)]
    drafts = {
        i: [
            DraftAction(match_id=i, hero_id=1, is_pick=False, team_side=RADIANT),
            DraftAction(match_id=i, hero_id=3, is_pick=True, team_side=DIRE),
        ]
        for i in range(n)
    }
    return matches, drafts


def test_denial_is_shrunk_toward_the_field():
    """A team that banned a hero in every match should read as very likely to deny it,
    but never as a certainty on a finite sample -- that is the shrinkage doing its job,
    and without it a single ban in thirty games would read as a real rate."""
    matches, drafts = _corpus(40)
    m = DraftModel.build(matches, drafts)
    assert m.matches_seen == 40
    always = m.denial_rate("A", 1)
    never = m.denial_rate("A", 2)
    assert 0.6 < always < 1.0, always
    assert never < 0.05, never
    # More evidence, same behaviour -> an estimate closer to the extreme.
    big = DraftModel.build(*_corpus(200))
    assert big.denial_rate("A", 1) > always
    print(
        f"ok  denial shrinks: 40 matches -> {always:.2f}, 200 matches -> "
        f"{big.denial_rate('A', 1):.2f} (prior {PRIOR_MATCHES:.0f} pseudo-matches)"
    )


def test_availability_is_a_probability_and_tracks_the_opponent():
    matches, drafts = _corpus(60)
    m = DraftModel.build(matches, drafts)
    # Facing A, hero 1 is mostly gone; facing C (unseen), the prior applies and the
    # hero is nearly always available.
    vs_a = m.availability(1, {"A": 1.0})
    vs_c = m.availability(1, {"C": 1.0})
    split = m.availability(1, {"A": 0.5, "C": 0.5})
    for v in (vs_a, vs_c, split):
        assert 0.0 <= v <= 1.0, v
    assert vs_a < split < vs_c, (vs_a, split, vs_c)
    assert m.availability(2, {"A": 1.0}) > 0.95
    assert m.availability(1, {}) == 1.0, "no opponents means no denial"
    print(f"ok  availability vs A {vs_a:.2f}, split {split:.2f}, vs unseen team {vs_c:.2f}")


def test_game_weights_align_and_downweight_contested_heroes():
    matches, drafts = _corpus(60)
    m = DraftModel.build(matches, drafts)
    games = [
        PlayerGame(
            account_id=1,
            match_id=i,
            start_time=datetime(2026, 8, 1, tzinfo=timezone.utc),
            won=True,
            duration_seconds=2400,
            stats={},
            hero_id=hero,
        )
        for i, hero in enumerate((1, 2, None))
    ]
    w = m.game_weights(games, {"A": 1.0})
    assert len(w) == len(games)
    assert w[0] < w[1], "a hero the opponent always removes must count for less"
    assert w[2] == 1.0, "an unknown hero cannot be penalised"
    print(f"ok  game weights {[round(x, 2) for x in w]} (contested, free, unknown)")


def test_picks_and_bans_both_deny():
    """A hero the opponent takes first is as unavailable as one they ban."""
    matches = [_match(i, "A", "B") for i in range(30)]
    drafts = {
        i: [DraftAction(match_id=i, hero_id=7, is_pick=True, team_side=DIRE)]
        for i in range(30)
    }
    m = DraftModel.build(matches, drafts)
    assert m.denial_rate("B", 7) > 0.5, m.denial_rate("B", 7)
    assert m.picked[7] == 30 and m.banned.get(7, 0) == 0
    print("ok  an opponent's first pick denies a hero as surely as a ban")


def test_event_filter_narrows_the_corpus():
    matches, drafts = _corpus(40)
    m = DraftModel.build(matches, drafts, only_match_ids={0, 1, 2})
    assert m.matches_seen == 3, m.matches_seen
    print("ok  fitting on the event's own matches only restricts the sample")


if __name__ == "__main__":
    test_denial_is_shrunk_toward_the_field()
    test_availability_is_a_probability_and_tracks_the_opponent()
    test_game_weights_align_and_downweight_contested_heroes()
    test_picks_and_bans_both_deny()
    test_event_filter_narrows_the_corpus()
    print("\nall draft tests passed")
