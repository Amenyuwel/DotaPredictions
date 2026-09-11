"""Watchers Taken, and the two ways reading it goes quietly wrong.

The stat spent a tournament marked `unmeasurable` because a search of OpenDota
payloads for the string "watcher" came back empty. It was there all along: Valve
calls a Watcher a *lamp*, and the field is `ability_uses.ability_lamp_use`.
Nothing failed while that was true -- every Support projection was simply short
one of its three blue stats, and the tool recommended rerolling an emblem worth
147 points a capture.

Two traps follow, and both produce a plausible number rather than an error:

1. **`ability_capture` is not the Watcher.** It sits in the same dict and reads
   like the obvious choice. It is the Outpost -- dotaconstants gives it
   `target_team: Enemy` and `base_capture_time: 6` -- and it fires once or twice
   a match against the Watcher's 27 to 44. Reading it would understate the stat
   roughly tenfold and still look reasonable.

2. **`ability_uses` is sparse.** Most players take no Watchers, so they carry no
   key at all. On a PARSED replay that absence is a measured zero; on an
   unparsed one the whole map is missing and there is no measurement. Collapse
   the two and every player who took none is dropped from the average instead of
   counted, which conditions the mean on "given they took one" and overstates
   the stat for exactly the supports the emblem is for.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dota.banner import STAT_SOURCE
from dota.config import Scoring
from dota.sources.opendota import OpenDota


def _match(players: list[dict]) -> dict:
    return {
        "match_id": 1,
        "start_time": 1_750_000_000,
        "duration": 2400,
        "radiant_win": True,
        "players": players,
    }


def _player(account_id: int, **extra) -> dict:
    base = {
        "account_id": account_id,
        "player_slot": 0,
        "isRadiant": True,
        "hero_id": 1,
        "kills": 1,
    }
    base.update(extra)
    return base


def _games(monkeypatch, payload: dict):
    source = OpenDota.__new__(OpenDota)
    monkeypatch.setattr(OpenDota, "match_detail", lambda self, mid: payload)
    return source.player_games_from_match(1)


def test_the_watcher_is_read_from_ability_lamp_use(monkeypatch):
    games = _games(
        monkeypatch,
        _match([_player(11, ability_uses={"ability_lamp_use": 6})]),
    )
    assert games[0].stats["watchers_taken"] == 6.0


def test_the_outpost_is_not_counted_as_a_watcher(monkeypatch):
    # `ability_capture` in the same dict, and nothing else. The Outpost must not
    # be read as a Watcher: it is a different structure with its own rate.
    games = _games(
        monkeypatch,
        _match([_player(11, ability_uses={"ability_capture": 2})]),
    )
    assert games[0].stats["watchers_taken"] == 0.0


def test_a_parsed_replay_with_no_key_is_a_measured_zero(monkeypatch):
    # The player took none. `ability_uses` exists, so this IS a measurement, and
    # dropping it would average only over the games where someone took one.
    games = _games(
        monkeypatch,
        _match([_player(11, ability_uses={"mirana_arrow": 3})]),
    )
    assert games[0].stats["watchers_taken"] == 0.0


def test_an_unparsed_replay_yields_no_measurement_at_all(monkeypatch):
    # No `ability_uses` map: the replay was never parsed. A zero here would be a
    # claim nobody made.
    games = _games(monkeypatch, _match([_player(11)]))
    assert "watchers_taken" not in games[0].stats


def test_the_stat_is_wired_all_the_way_through():
    # Three places have to agree or the stat is read and then dropped: the
    # source emits `watchers_taken`, STAT_SOURCE maps the scoring key onto that
    # column, and the config no longer excludes it.
    assert STAT_SOURCE["watchers_taken"] == "watchers_taken"
    scoring = Scoring.load("ti2026")
    assert scoring.stats["watchers_taken"].measurable is True
    # Its neighbour on the same colour stays unmeasurable: the pluck ability
    # exists in Valve's data and OpenDota never populates it.
    assert scoring.stats["lotuses_grabbed"].measurable is False


def test_watchers_is_a_blue_stat_and_blue_is_where_it_lands():
    # Not decoration. Support is blue-green-blue-green-blue and mid carries one
    # blue slot, so this stat only ever reaches those two roles -- which is why
    # marking it unmeasurable cost the Support banner three of its five slots'
    # worth of candidates.
    scoring = Scoring.load("ti2026")
    assert scoring.stats["watchers_taken"].color == "blue"
    assert scoring.slot_colors_for("support", 5).count("blue") == 3
    assert scoring.slot_colors_for("core", 5).count("blue") == 0
