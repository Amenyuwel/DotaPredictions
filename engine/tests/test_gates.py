"""The gates that make a tournament's timeline a correctness property.

Run: python -m tests.test_gates

These do not test arithmetic. They pin the failure this project actually has:
config that is *out of date rather than wrong*, which produces a confident
projection and no error at all. A roster carried over from the last
International, an org that folded in the off-season, a bracket read before it
was drawn, a patch prior applied to games that already reflect it -- every one
of them parses, validates and scores.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from scripts import gates

NOW = datetime(2027, 8, 20, tzinfo=timezone.utc)
GROUP_LOCK = datetime(2027, 8, 13, tzinfo=timezone.utc)


def fake_cfg(
    *,
    n_teams: int = 2,
    team_names: tuple[str, ...] = ("Alpha", "Beta"),
    verified: bool = True,
    verified_utc: datetime | None = None,
    pairings: list[tuple[str, str]] | None = None,
    main_teams: int = 2,
):
    """The parts of Config the gates actually read, and nothing else."""
    main_event = None
    if pairings is not None:
        main_event = SimpleNamespace(
            pairings=pairings,
            n_teams=main_teams,
            teams=[t for pair in pairings for t in pair],
        )
    return SimpleNamespace(
        dir=SimpleNamespace(name="ti2027"),
        roster=SimpleNamespace(
            teams=[SimpleNamespace(name=n) for n in team_names],
            names=list(team_names),
            verified=verified,
            verified_utc=verified_utc,
            aliases={},
        ),
        tournament=SimpleNamespace(
            n_teams=n_teams,
            lock_utc=GROUP_LOCK,
            main_event=main_event,
        ),
    )


def fake_analysis(*, matches=(), patch=None):
    return SimpleNamespace(corpus=SimpleNamespace(matches=list(matches)), patch=patch)


def match(name_a: str, name_b: str, when: datetime):
    return SimpleNamespace(radiant_name=name_a, dire_name=name_b, start_time=when)


# ---------------------------------------------------------------------------


def test_main_event_is_refused_until_the_bracket_is_drawn():
    """The whole point of the staged workflow.

    Before the group stage is played there is no Main Event field. Publishing
    one anyway does not raise -- it simulates a bracket of whatever happens to be
    in config and prints eight projections -- so the refusal has to be explicit.
    """
    not_drawn = gates.stage_ready(fake_cfg(pairings=[]), "main")
    assert not not_drawn.passed
    assert any("no pairings" in f for f in not_drawn.failures), not_drawn.failures

    # The same config is perfectly publishable as a group-stage run.
    assert gates.stage_ready(fake_cfg(pairings=[]), "group").passed

    drawn = gates.stage_ready(fake_cfg(pairings=[("Alpha", "Beta")]), "main")
    assert drawn.passed, drawn.failures
    print("ok  a Main Event with no drawn bracket is refused; the group stage is not")


def test_a_bracket_naming_unknown_teams_is_refused():
    """Survivors the roster has never heard of mean the roster is the stale half.

    This is the shape of the costliest bug on record -- a team the model did not
    know about, rated on no evidence -- reached one stage earlier.
    """
    result = gates.stage_ready(
        fake_cfg(team_names=("Alpha", "Beta"), pairings=[("Alpha", "Gamma")]), "main"
    )
    assert not result.passed
    assert any("Gamma" in f for f in result.failures), result.failures
    print("ok  a bracket naming teams the roster lacks is refused")


def test_an_unfinished_field_is_refused():
    result = gates.stage_ready(fake_cfg(n_teams=16, team_names=("Alpha", "Beta")), "group")
    assert not result.passed
    assert any("expected 16" in f for f in result.failures), result.failures
    print("ok  a field short of its team count is refused")


def test_a_roster_with_no_date_cannot_age_out():
    """`verified: true` with no date is the trap this field exists to close.

    A boolean somebody set last season looks exactly like one set this morning.
    """
    result = gates.roster_freshness(
        fake_cfg(verified_utc=None), "group", max_age_days=21, now=NOW
    )
    assert not result.passed
    assert any("verified_utc" in f for f in result.failures), result.failures
    print("ok  a roster with no verified_utc is refused")


def test_a_stale_roster_is_refused_even_when_verified():
    fresh = gates.roster_freshness(
        fake_cfg(verified_utc=NOW - timedelta(days=10)), "group", max_age_days=21, now=NOW
    )
    assert fresh.passed, fresh.failures

    stale = gates.roster_freshness(
        fake_cfg(verified_utc=NOW - timedelta(days=400)), "group", max_age_days=21, now=NOW
    )
    assert not stale.passed
    assert any("400 days ago" in f for f in stale.failures), stale.failures
    print("ok  a roster verified last season is refused, a recent one passes")


def test_the_main_event_demands_a_roster_checked_after_the_group_stage():
    """Eight of sixteen teams are gone and stand-ins appear between stages.

    A roster confirmed before the group stage locked is evidence about a field
    that no longer exists, even when it is only days old.
    """
    before = NOW - timedelta(days=10)  # recent, but earlier than GROUP_LOCK
    assert before < GROUP_LOCK

    cfg = fake_cfg(verified_utc=before, pairings=[("Alpha", "Beta")])
    assert gates.roster_freshness(cfg, "group", max_age_days=21, now=NOW).passed

    result = gates.roster_freshness(cfg, "main", max_age_days=21, now=NOW)
    assert not result.passed
    assert any("before the group stage locked" in f for f in result.failures), result.failures
    print("ok  the Main Event refuses a roster last checked before the group stage")


def test_a_disbanded_org_is_caught_by_activity_not_by_evidence():
    """`team_evidence` counts rows anywhere in the window and would pass this.

    An org that folded after the last International still has last season's
    games, so the question that catches it is "is this team still playing",
    not "does this team have results".
    """
    played = [
        match("Alpha", "Beta", NOW - timedelta(days=5)),
        match("Beta", "Alpha", NOW - timedelta(days=400)),
    ]
    result = gates.team_activity(
        fake_cfg(team_names=("Alpha", "Gone")),
        fake_analysis(matches=played),
        max_idle_days=60,
        now=NOW,
    )
    assert not result.passed
    assert any(f.startswith("Gone:") for f in result.failures), result.failures
    assert not any(f.startswith("Alpha:") for f in result.failures), result.failures
    print("ok  a team absent from the sampled window is refused; an active one is not")


def test_an_idle_team_is_refused():
    old = [match("Alpha", "Beta", NOW - timedelta(days=200))]
    result = gates.team_activity(
        fake_cfg(), fake_analysis(matches=old), max_idle_days=60, now=NOW
    )
    assert not result.passed
    assert len(result.failures) == 2, result.failures
    assert all("200 days ago" in f for f in result.failures), result.failures
    print("ok  a team that stopped playing is refused even though it has results")


def test_a_patch_older_than_the_evidence_double_counts():
    """The corpus already reflects it, so correcting on top counts it twice.

    Nothing about the output looks wrong afterwards, which is why it is a gate.
    """
    matches = [
        match("Alpha", "Beta", datetime(2027, 6, 1, tzinfo=timezone.utc)),
        match("Alpha", "Beta", datetime(2027, 8, 1, tzinfo=timezone.utc)),
    ]
    patch = SimpleNamespace(active=True, version="7.99a", released_utc="2027-01-01T00:00:00Z")
    result = gates.patch_consistency(fake_cfg(), fake_analysis(matches=matches, patch=patch))
    assert not result.passed
    assert any("counts the change twice" in f for f in result.failures), result.failures

    straddling = SimpleNamespace(active=True, version="7.99a", released_utc="2027-07-01T00:00:00Z")
    ok = gates.patch_consistency(fake_cfg(), fake_analysis(matches=matches, patch=straddling))
    assert ok.passed, ok.failures
    print("ok  a patch predating every sampled game is refused; one inside the window is not")


def test_an_undated_patch_is_refused_but_an_absent_one_is_not():
    """No patch is an honest answer; an undated patch is an unanswerable one.

    README's own position: claiming a team got stronger from a patch with no
    post-patch results moves the grid more than anything measured.
    """
    matches = [match("Alpha", "Beta", datetime(2027, 8, 1, tzinfo=timezone.utc))]

    absent = gates.patch_consistency(fake_cfg(), fake_analysis(matches=matches, patch=None))
    assert absent.passed, absent.failures

    inactive = SimpleNamespace(active=False, version="", released_utc="")
    assert gates.patch_consistency(
        fake_cfg(), fake_analysis(matches=matches, patch=inactive)
    ).passed

    undated = SimpleNamespace(active=True, version="7.99a", released_utc="")
    result = gates.patch_consistency(fake_cfg(), fake_analysis(matches=matches, patch=undated))
    assert not result.passed
    assert any("released_utc" in f for f in result.failures), result.failures
    print("ok  an undated patch is refused; no patch at all is allowed")


if __name__ == "__main__":
    test_main_event_is_refused_until_the_bracket_is_drawn()
    test_a_bracket_naming_unknown_teams_is_refused()
    test_an_unfinished_field_is_refused()
    test_a_roster_with_no_date_cannot_age_out()
    test_a_stale_roster_is_refused_even_when_verified()
    test_the_main_event_demands_a_roster_checked_after_the_group_stage()
    test_a_disbanded_org_is_caught_by_activity_not_by_evidence()
    test_an_idle_team_is_refused()
    test_a_patch_older_than_the_evidence_double_counts()
    test_an_undated_patch_is_refused_but_an_absent_one_is_not()
    print("\nall gate tests passed")
