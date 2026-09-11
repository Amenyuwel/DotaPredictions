"""The re-check that stops an `unmeasurable` entry going stale.

Run: python -m tests.test_unmeasured

The trap this pins is the quiet one. `scoring.yaml` marks a stat unmeasurable
because nobody published it on the day someone looked; if that changes and the
list does not, every emblem carrying the stat goes on being excluded from choice
and scored as absent, silently, for as long as the file says so. Nothing fails,
nothing warns, and the answer is quietly worse.

So the interesting test is not "it is quiet today" -- that is the boring half.
It is "it actually fires when the field arrives".
"""
from __future__ import annotations

from dota.config import Config
from dota.unmeasured import CANDIDATE_FIELDS, rediscover, report, scan_payload


def match(**player_fields):
    """A parsed match payload carrying one player with these fields."""
    base = {"kills": 3, "deaths": 1, "camps_stacked": 2}
    return {"match_id": 1, "players": [{**base, **player_fields}]}


def test_it_fires_when_the_field_appears_under_valves_own_name():
    """`lotuses` is what Valve calls it.

    CMsgDOTAFantasyPlayerStats numbers it 25. If OpenDota ever surfaces the
    parsed value it most likely keeps that spelling, so that is one of the names
    this has to catch.

    `watchers_taken` used to be checked here too and is gone on purpose: it is
    measured now, read from `ability_uses.ability_lamp_use`. It is also the
    reason this list is no longer trusted to be complete -- it guessed
    "watchers", the data said "lamp", and the stat sat excluded for a
    tournament. See tests/test_watchers.py.
    """
    found = rediscover(["lotuses_grabbed"], [match(lotuses=4)])
    assert found == {"lotuses_grabbed": ["lotuses"]}, found
    print("ok  a newly published field is detected under Valve's own name")


def test_it_looks_for_the_pluck_ability_by_its_real_name():
    """The name the stat would actually arrive under.

    `ability_pluck_lotus` is not a guess: it exists in odota/dotaconstants with
    a `lotus_rate` attribute, and OpenDota simply never populates it. So it is
    the first thing to look for, and it arrives nested inside `ability_uses`
    exactly as `ability_lamp_use` does.
    """
    found = rediscover(
        ["lotuses_grabbed"], [match(ability_uses={"ability_pluck_lotus": 5})]
    )
    assert found == {"lotuses_grabbed": ["ability_pluck_lotus"]}, found


def test_lotus_consumption_does_not_fire_the_notice():
    """`famango` is already populated and is not the stat.

    It counts lotuses CONSUMED, not plucked -- a lotus can be handed to a
    teammate. Listing it as a candidate would fire this notice on every publish
    forever while naming a field that cannot answer the question.
    """
    consumed = match(item_uses={"famango": 3, "great_famango": 1})
    assert rediscover(["lotuses_grabbed"], [consumed]) == {}


def test_it_looks_one_level_into_nested_stat_dicts():
    """Two stats already arrive nested, so a third could.

    Madstone is counted out of `item_uses` and tormentors out of `killed`. A new
    stat landing inside a dict like those would be invisible to a top-level scan.
    """
    found = rediscover(["lotuses_grabbed"], [match(item_uses={"lotus_pickups": 3})])
    assert found == {"lotuses_grabbed": ["lotus_pickups"]}, found
    print("ok  a field nested one level down is still detected")


def test_the_item_lotus_orb_is_not_mistaken_for_the_stat():
    """The false positive that would waste an afternoon.

    Every parsed match already contains the word "lotus" -- as `lotus_orb`, the
    item. A looser substring match would fire on all 1,514 cached matches and
    report a stat that is still unpublished.
    """
    noisy = match(item_uses={"lotus_orb": 2, "power_treads": 6}, purchase={"lotus_orb": 1})
    assert rediscover(["lotuses_grabbed"], [noisy]) == {}
    print("ok  the item lotus_orb does not read as a lotus pickup")


def test_silence_is_the_expected_answer_and_is_not_an_error():
    assert rediscover(["lotuses_grabbed", "watchers_taken"], [match()]) == {}
    assert rediscover(["lotuses_grabbed"], []) == {}
    assert report({}) == []
    print("ok  nothing found reports nothing, and no payloads is not a failure")


def test_every_unmeasurable_stat_in_config_has_candidates_to_look_for():
    """A stat with no candidate names would never be re-checked.

    That is the failure this whole module exists to prevent, one level up: an
    entry marked unmeasurable that nothing is watching.
    """
    cfg = Config()
    blind = sorted(k for k, s in cfg.scoring.stats.items() if not s.measurable)
    assert blind, "expected at least one unmeasurable stat in this config"
    missing = [s for s in blind if s not in CANDIDATE_FIELDS]
    assert not missing, f"no candidate field names to watch for: {missing}"
    print(f"ok  all {len(blind)} unmeasurable stats have candidate names: {', '.join(blind)}")


def test_the_report_says_what_to_do_about_it():
    lines = report(rediscover(["lotuses_grabbed"], [match(lotuses=4)]))
    assert len(lines) == 1
    assert "lotuses" in lines[0] and "scoring.yaml" in lines[0]
    print("ok  the notice names the field and the file to edit")


def test_scan_payload_tolerates_a_malformed_match():
    """Cached payloads are whatever the API returned, including partials."""
    assert scan_payload({}, ("lotuses",)) == []
    assert scan_payload({"players": None}, ("lotuses",)) == []
    assert scan_payload({"players": ["not a dict"]}, ("lotuses",)) == []
    print("ok  a malformed payload is skipped rather than raising")


if __name__ == "__main__":
    test_it_fires_when_the_field_appears_under_valves_own_name()
    test_it_looks_one_level_into_nested_stat_dicts()
    test_the_item_lotus_orb_is_not_mistaken_for_the_stat()
    test_silence_is_the_expected_answer_and_is_not_an_error()
    test_every_unmeasurable_stat_in_config_has_candidates_to_look_for()
    test_the_report_says_what_to_do_about_it()
    test_scan_payload_tolerates_a_malformed_match()
    print("\nall unmeasured-stat tests passed")
