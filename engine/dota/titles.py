"""Coach Titles, applied rather than merely tabulated.

A prefix and a suffix, each a conditional percentage on a player's **per-game**
score (`docs/ti2026-how-to-play.md`). They are free to change and cost no roll
tokens, which makes them the cheapest points on the board -- and until now the
model priced them at zero, so every projection was systematically low and, worse,
low *unevenly*.

Both conditions are per-game, and that is what makes them worth modelling
properly instead of multiplying the total by an average rate:

* **Prefixes key on the hero's appearance.** Cerulean pays on a blue hero, and
  `config/hero_adjectives.yaml` carries Valve's own flags per hero id. Every
  observed game already records which hero was played, so the bonus can be applied
  to the exact games that would have earned it. Two mids with identical stat lines
  and different hero pools are then correctly valued differently -- which a
  season-average rate would have erased.
* **`the Clutch` pays on the last possible game of a series.** Under a
  top-two-games-per-series rule an amplified decider is also *more likely to be
  counted*, so its value is strictly greater than `bonus x P(decider)`. It is
  applied inside the bracket simulation, on the game that actually is the decider.

Everything else in the suffix pool is either unmeasurable from match data (the
Tormented, the Cruel) or keys on a bad game and is close to worthless under an
E[max] objective (the Underdog, the Pacifist, of the Ant). Those fall back to
`bonus x p` from `config/scoring.yaml` when equipped, and say so.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yaml

from .config import CONFIG_DIR, Player, Scoring
from .sources.base import PlayerGame

# The one suffix whose condition the bracket simulation can place exactly.
DECIDER_SUFFIX = "the Clutch"

# Match time under which a game counts as decided quickly, per the client's
# wording ("games lasting under 25 minutes").
DECISIVE_SECONDS = 25 * 60
PATIENT_SECONDS = 10 * 60


def _lost(g: PlayerGame) -> bool | None:
    return not g.won


def _lucky(g: PlayerGame) -> bool | None:
    if not g.duration_seconds:
        return None
    # "match time ends with an 8" -- the clock's last digit, i.e. the seconds.
    return g.duration_seconds % 10 == 8


def _decisive(g: PlayerGame) -> bool | None:
    if not g.duration_seconds:
        return None
    return g.duration_seconds < DECISIVE_SECONDS


def _patient(g: PlayerGame) -> bool | None:
    if g.first_blood_time is None:
        return None
    return g.first_blood_time > PATIENT_SECONDS


def _pre_horn(g: PlayerGame) -> bool | None:
    if g.first_blood_time is None:
        return None
    return g.first_blood_time < 0


def _tormented(g: PlayerGame) -> bool | None:
    if g.tormentor_death is None:
        return None
    return bool(g.tormentor_death)


# Suffix -> per-game predicate. A predicate returning None means "this game cannot
# say", which is not the same as False: the rate is then computed over the games
# that can say, and never silently counted as a miss.
#
# Absent from this table, deliberately:
#   the Clutch  -- positional inside a series, applied as a decider bonus instead
#   the Cruel   -- fountain kills are not in the match data at any depth
SUFFIX_CONDITIONS = {
    "the Underdog": _lost,
    "the Lucky": _lucky,
    "the Decisive": _decisive,
    "the Patient": _patient,
    "the Flayed Twins Acolyte": _pre_horn,
    "the Tormented": _tormented,
}


@lru_cache(maxsize=4)
def load_hero_tags(path=None) -> dict[int, set[str]]:
    """hero_id -> Valve appearance flags, from config/hero_adjectives.yaml.

    Cached: evaluating a grid of title pairs would otherwise re-parse an 866-line
    YAML file once per candidate.
    """
    path = path or CONFIG_DIR / "hero_adjectives.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {
        int(hid): set(row.get("tags") or [])
        for hid, row in (raw.get("heroes") or {}).items()
    }


@dataclass
class Titles:
    """The equipped pair, resolved against the scoring config."""

    prefix: str | None = None
    prefix_bonus: float = 0.0
    prefix_tags: frozenset[str] = frozenset()
    suffix: str | None = None
    suffix_bonus: float = 0.0
    # The static rate recorded in scoring.yaml. Only a last-resort fallback --
    # `measured_suffix_rate` computes the real one from the roster's own games.
    suffix_p: float | None = None
    hero_tags: dict[int, set[str]] | None = None

    @classmethod
    def load(cls, scoring: Scoring, equipped: dict[str, Any] | None) -> "Titles":
        if not equipped:
            return cls()
        titles = scoring.coach_titles or {}
        prefixes = titles.get("prefixes") or {}
        suffixes = titles.get("suffixes") or {}
        pname = equipped.get("prefix")
        sname = equipped.get("suffix")
        prow = prefixes.get(pname) or {}
        srow = suffixes.get(sname) or {}
        if pname and not prow:
            raise SystemExit(f"coach prefix {pname!r} is not in scoring.yaml")
        if sname and not srow:
            raise SystemExit(f"coach suffix {sname!r} is not in scoring.yaml")
        return cls(
            prefix=pname,
            prefix_bonus=float(prow.get("bonus") or 0.0),
            prefix_tags=frozenset(prow.get("tags") or ()),
            suffix=sname,
            suffix_bonus=float(srow.get("bonus") or 0.0),
            suffix_p=(
                None if srow.get("p") is None else float(srow["p"])
            ),
            hero_tags=load_hero_tags() if pname else None,
        )

    @property
    def active(self) -> bool:
        return bool(self.prefix or self.suffix)

    # -- prefix: per player, per game -------------------------------------
    def prefix_multiplier(self, game: PlayerGame) -> float:
        """What the prefix pays in this specific game.

        A hero with no entry in the tag table returns 1.0 rather than assuming the
        condition is met -- an unknown hero is not a blue one.
        """
        if not self.prefix or not self.prefix_bonus or not self.hero_tags:
            return 1.0
        if game.hero_id is None:
            return 1.0
        tags = self.hero_tags.get(int(game.hero_id))
        if not tags or self.prefix_tags.isdisjoint(tags):
            return 1.0
        return 1.0 + self.prefix_bonus

    # -- suffix: per game, where the condition is in the data -------------
    def suffix_multiplier(self, game: PlayerGame) -> float:
        """What the suffix pays in this game, when the condition is measurable.

        Applied per game rather than as a rate on the total, because several of
        these conditions are *correlated with the score itself* and the sign of the
        correlation decides whether the title is worth anything. `the Underdog`
        pays on losses, which are the games you did not want counted; `the Decisive`
        pays on short games, which suppress every cumulative stat but not GPM. A
        flat `bonus x p` cannot tell those apart from a free bonus.
        """
        if not self.suffix or not self.suffix_bonus:
            return 1.0
        cond = SUFFIX_CONDITIONS.get(self.suffix)
        if cond is None:
            # Not measurable per game (the Clutch is positional, the Cruel has no
            # data): the caller handles it via decider_bonus or the flat fallback.
            return 1.0
        met = cond(game)
        if not met:
            return 1.0
        return 1.0 + self.suffix_bonus

    def game_multiplier(self, _player: Player, game: PlayerGame) -> float:
        """Combined per-game Title multiplier.

        Prefix and suffix are multiplied. The client may instead add the two
        bonuses; on a game meeting both conditions that is a ~1.4% difference, and
        it is recorded as an assumption in README rather than hidden here.
        """
        return self.prefix_multiplier(game) * self.suffix_multiplier(game)

    def measured_suffix_rate(self, games: list[PlayerGame]) -> float | None:
        """Measured firing rate, over the games that can answer. None if none can."""
        if not self.suffix:
            return None
        cond = SUFFIX_CONDITIONS.get(self.suffix)
        if cond is None:
            return None
        answers = [cond(g) for g in games]
        usable = [a for a in answers if a is not None]
        if not usable:
            return None
        return sum(1 for a in usable if a) / len(usable)

    def fires(self, game: PlayerGame) -> bool:
        """Would the prefix pay on this game's hero?"""
        if not self.prefix or not self.hero_tags or game.hero_id is None:
            return False
        return not self.prefix_tags.isdisjoint(
            self.hero_tags.get(int(game.hero_id), set())
        )

    def prefix_rate(
        self, games: list[PlayerGame], weights: list[float] | None = None
    ) -> float:
        """Share of these games that would fire the prefix.

        `weights` must be the same weights the projection bootstraps with. Reporting
        an unweighted rate beside a weighted projection is not a cosmetic mismatch:
        a hero pool is not stationary, so the recency-weighted rate can be far from
        the flat one, and the unweighted number then fails to explain the figure
        sitting next to it.
        """
        if not games or not self.prefix or not self.hero_tags:
            return 0.0
        if weights is None or len(weights) != len(games):
            hits = sum(1 for g in games if self.fires(g))
            return hits / len(games)
        total = sum(weights)
        if total <= 0:
            return 0.0
        return sum(w for g, w in zip(games, weights) if self.fires(g)) / total

    # -- suffix: per game, positional inside a series ---------------------
    @property
    def decider_bonus(self) -> float:
        """The suffix bonus, if it is the one that fires on a series decider."""
        if self.suffix == DECIDER_SUFFIX:
            return self.suffix_bonus
        return 0.0

    @property
    def flat_suffix_multiplier(self) -> float:
        """Last-resort fallback: a suffix with neither a placement nor a predicate.

        `bonus x p` treats the condition as independent of how well the game went,
        which is wrong for every suffix that rewards a bad game. Only `the Cruel`
        reaches this path, and only if it is equipped.
        """
        if not self.suffix or self.suffix == DECIDER_SUFFIX:
            return 1.0
        if self.suffix in SUFFIX_CONDITIONS:
            return 1.0
        if self.suffix_p is None:
            return 1.0
        return 1.0 + self.suffix_bonus * self.suffix_p

    def describe(self) -> str:
        bits = []
        if self.prefix:
            bits.append(
                f"{self.prefix} +{self.prefix_bonus:.0%} on "
                f"{'/'.join(sorted(self.prefix_tags))} heroes, per game"
            )
        if self.suffix == DECIDER_SUFFIX:
            bits.append(f"{self.suffix} +{self.suffix_bonus:.0%} on series deciders")
        elif self.suffix in SUFFIX_CONDITIONS:
            bits.append(
                f"{self.suffix} +{self.suffix_bonus:.0%} per game, on the games "
                f"meeting the condition"
            )
        elif self.suffix:
            bits.append(
                f"{self.suffix} +{self.suffix_bonus:.0%} applied as a flat "
                f"x{self.flat_suffix_multiplier:.3f} (condition not measurable)"
            )
        return "; ".join(bits) or "none equipped"


__all__ = ["DECIDER_SUFFIX", "Titles", "load_hero_tags"]
