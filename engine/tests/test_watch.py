"""The unattended watch's two decisions. Run: python -m tests.test_watch

Both are guards against the same thing in opposite directions: a watch that
never fires is indistinguishable from an event that never happened, and a watch
that fires every month is one you stop reading. The dates below are the real
ones -- editions of The International have started in August, September and
October, and the gaps inside an event are days rather than weeks.
"""
from __future__ import annotations

from datetime import datetime, timezone

import yaml

from dota.config import CONFIG_DIR
from scripts.watch import ALERTING_TIERS, in_season, is_concluded

WATCH = yaml.safe_load((CONFIG_DIR / "watch.yaml").read_text(encoding="utf-8"))

# Every edition on record, as (year, first day, last day).
EDITIONS = [
    (2019, datetime(2019, 8, 20, tzinfo=timezone.utc), datetime(2019, 8, 25, tzinfo=timezone.utc)),
    (2021, datetime(2021, 10, 7, tzinfo=timezone.utc), datetime(2021, 10, 17, tzinfo=timezone.utc)),
    (2022, datetime(2022, 10, 15, tzinfo=timezone.utc), datetime(2022, 10, 30, tzinfo=timezone.utc)),
    (2023, datetime(2023, 10, 12, tzinfo=timezone.utc), datetime(2023, 10, 29, tzinfo=timezone.utc)),
    (2024, datetime(2024, 9, 4, tzinfo=timezone.utc), datetime(2024, 9, 15, tzinfo=timezone.utc)),
    (2025, datetime(2025, 9, 4, tzinfo=timezone.utc), datetime(2025, 9, 14, tzinfo=timezone.utc)),
    (2026, datetime(2026, 8, 13, tzinfo=timezone.utc), datetime(2026, 8, 23, tzinfo=timezone.utc)),
]


def test_the_configured_window_covers_every_edition_on_record():
    """The window has to contain the months TIs have actually started in.

    This is the test that would have caught the tempting version of this
    feature: a "-ber months" window, which reads as obvious and misses August --
    and August is two of the seven editions on record, including the most recent.
    """
    months = [int(m) for m in WATCH["months"]]
    for year, start, _end in EDITIONS:
        assert in_season(start.month, months), (
            f"TI {year} started in month {start.month}, which the window excludes"
        )
    print(f"ok  window {months} covers all {len(EDITIONS)} editions on record")


def test_the_window_opens_before_the_qualifiers():
    """The league appears before the qualifiers, and the qualifiers are the point.

    TI 2026's regional qualifiers ran June 15-28 for an August event. That is
    the only clean window for gathering roster data, so a watch that wakes up in
    the month of the event is already too late to be useful.
    """
    months = [int(m) for m in WATCH["months"]]
    assert in_season(6, months), "June is a qualifier month and must be watched"
    assert min(months) <= 4, "the window should open early enough to see a league created"
    print("ok  the window opens before the qualifier season, not at the event")


def test_months_never_hosting_an_edition_are_excluded():
    """Cheap, but it is the half of the trade the window exists for."""
    months = [int(m) for m in WATCH["months"]]
    for month in (11, 12, 1, 2):
        assert not in_season(month, months), f"month {month} has never hosted an edition"
    print("ok  November through February are outside the window")


def test_an_empty_window_fails_open():
    """Deleting `months:` must mean "always", never "never".

    A watch silenced by empty config looks exactly like an event that has not
    happened yet, and it would stay silent for a year before anyone noticed.
    """
    assert in_season(1, []), "an empty window must not silence the watch"
    print("ok  an empty months list watches every month")


def test_open_qualifiers_never_raise_the_alarm():
    """Five `excluded` leagues per edition that nobody ever configures.

    Without a tier filter each one reads as "an unconfigured league matching The
    International" and fires the alert every month of the window -- measured at
    5 false alerts against 0 real ones on the current data. An alert that is
    always on is an alert nobody reads, which is the same as no watch at all.
    """
    assert "excluded" not in ALERTING_TIERS
    assert "premium" in ALERTING_TIERS, "the event itself must alert"
    assert "professional" in ALERTING_TIERS, "regional qualifiers must alert"
    print("ok  open qualifiers are excluded; the event and its regionals are not")


def test_the_break_between_stages_does_not_read_as_concluded():
    """The gap between a group stage and a main event is days, not weeks.

    Treating it as "concluded" would stop the watch exactly when the Main Event
    roster needs re-fetching, which is the one moment the whole staged workflow
    exists for.
    """
    cutoff = int(WATCH["concluded_after_days"])

    # TI 2026: group stage ends Aug 16, main event starts Aug 20.
    mid_break = datetime(2026, 8, 18, tzinfo=timezone.utc)
    assert not is_concluded(datetime(2026, 8, 16, tzinfo=timezone.utc), mid_break, cutoff)

    # TI 2024: group ends Sep 10, finals start Sep 13.
    assert not is_concluded(
        datetime(2024, 9, 10, tzinfo=timezone.utc),
        datetime(2024, 9, 12, tzinfo=timezone.utc),
        cutoff,
    )
    print("ok  an inter-stage break is not mistaken for the end of the event")


def test_a_finished_event_is_recognised_within_one_monthly_run():
    """Detected before the next scheduled run, or the watch alerts on a dead event.

    The watch runs monthly, so anything slower than ~30 days means a concluded
    event still reads as live the next time it wakes up. TI 2026's final game
    was Aug 23; at the original 30-day cutoff it still read as live on Sep 10.
    """
    cutoff = int(WATCH["concluded_after_days"])
    last_game = datetime(2026, 8, 23, tzinfo=timezone.utc)

    assert is_concluded(last_game, datetime(2026, 9, 10, tzinfo=timezone.utc), cutoff)
    assert cutoff < 30, "a monthly watch must notice the end within one run"
    assert cutoff > 7, "a week-long gap is plausible inside an event"
    print(f"ok  concluded_after_days={cutoff} sits between an inter-stage gap and a month")


if __name__ == "__main__":
    test_the_configured_window_covers_every_edition_on_record()
    test_the_window_opens_before_the_qualifiers()
    test_months_never_hosting_an_edition_are_excluded()
    test_an_empty_window_fails_open()
    test_open_qualifiers_never_raise_the_alarm()
    test_the_break_between_stages_does_not_read_as_concluded()
    test_a_finished_event_is_recognised_within_one_monthly_run()
    print("\nall watch tests passed")
