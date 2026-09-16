"""Source-agnostic shapes. OpenDota and STRATZ both normalise into these."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

# Stat keys the scoring config understands. A source fills what it can and
# leaves the rest absent; the fantasy model treats absent as "no signal" rather
# than zero, so a missing stat does not silently deflate a projection.
FANTASY_STATS = (
    "kills",
    "deaths",
    "last_hits_denies",
    "gold_per_min",
    "xp_per_min",
    "seconds_stunned",
    "tower_kills",
    "roshan_kills",
    "teamfight_participation",
    "observer_wards_planted",
    "camps_stacked",
    "rune_pickups",
    "first_blood",
    "sentry_wards_planted",
    "courier_kills",
)


@dataclass
class MatchResult:
    """One completed game between two pro teams."""

    match_id: int
    start_time: datetime
    radiant_team_id: int | None
    dire_team_id: int | None
    radiant_name: str | None
    dire_name: str | None
    radiant_win: bool
    league_id: int | None = None
    league_name: str | None = None
    duration_seconds: int | None = None

    @property
    def winner_name(self) -> str | None:
        return self.radiant_name if self.radiant_win else self.dire_name

    @property
    def loser_name(self) -> str | None:
        return self.dire_name if self.radiant_win else self.radiant_name


@dataclass
class PlayerGame:
    """One player's line in one game, normalised to FANTASY_STATS keys.

    The last three fields carry nothing a War Banner scores. They exist because
    coach Title *suffixes* are conditions on the game rather than on the stat line
    -- who won, how long it lasted, when first blood fell, whether a Tormentor
    killed anyone -- and pricing a suffix by its season-average rate throws away
    the correlation between the condition and the score. A 22-minute stomp is not
    a randomly chosen game.
    """

    account_id: int
    match_id: int
    start_time: datetime
    won: bool
    duration_seconds: int
    stats: dict[str, float] = field(default_factory=dict)
    hero_id: int | None = None
    # Seconds from the horn to first blood; negative if it fell before the horn.
    # None when the replay was not parsed.
    first_blood_time: int | None = None
    # Did any of the ten players die to the Tormentor in this match?
    tormentor_death: bool | None = None

    def per_game(self, stat: str) -> float | None:
        return self.stats.get(stat)


class Source(Protocol):
    """What `build_corpus` may ask of a source before it has fetched anything.

    Two members, and the shortness is the point. This used to carry five --
    `resolve_player`, `resolve_team`, `recent_pro_matches` and `player_games`
    alongside these -- and STRATZ satisfied four of them with stubs returning
    `None` or `[]`. Nothing ever called them, so nothing ever noticed; a caller
    that had would have received an empty corpus and no error, which is this
    project's worst failure mode wearing a type annotation.

    The fetch methods are deliberately absent rather than forgotten. The two
    sources do not fetch in the same SHAPE: OpenDota answers one match at a
    time (`player_games_from_match`) and STRATZ answers in bulk
    (`player_games_for_matches`), and `build_corpus` uses both of them for what
    each is good at rather than picking one behind a common name. Flattening
    that into one signature would mean a per-match loop against an endpoint
    built for batches, or a batch call faked by looping -- an abstraction that
    costs a real fetch strategy to buy a uniformity nobody uses.

    So a third source implements this much to be recognised, and exports
    whatever fetch methods it can actually serve. `build_corpus` is the one
    place that knows which is which, and it already is.
    """

    name: str

    def available(self) -> bool:
        """Whether this source has what it needs -- a token, usually -- to be
        asked anything at all. Must never raise: a source that cannot answer is
        a smaller corpus, not a failed run."""
        ...


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
