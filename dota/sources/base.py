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
    """Minimal contract so STRATZ can be swapped in for OpenDota."""

    name: str

    def available(self) -> bool: ...

    def resolve_player(self, nick: str) -> tuple[int, str] | None:
        """Nickname -> (account_id, canonical_name)."""

    def resolve_team(self, name: str) -> tuple[int, str] | None:
        """Team name -> (team_id, canonical_name)."""

    def recent_pro_matches(self, since: datetime, limit: int) -> list[MatchResult]: ...

    def player_games(
        self, account_id: int, since: datetime, limit: int
    ) -> list[PlayerGame]: ...


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
