"""Everything that distorts a raw stat line, measured rather than assumed.

A player's observed Creep Score is not a clean signal of how much Creep Score
they will post at TI. It is contaminated by at least four things:

  * **Game length.** A 60-minute game hands out roughly twice the last hits of a
    30-minute one. Median duration in the corpus is 41 minutes and the range is
    11 to 112, so this is the largest single distortion in the data.
  * **Opponent quality.** Farming 500 creeps against a Division 2 side is not
    the same accomplishment as 500 against Falcons.
  * **League quality.** Same idea one level up: an open-qualifier Bo3 is weaker
    evidence than a DreamLeague Bo3.
  * **Hero.** Naga Siren stacks camps; Juggernaut does not. Zeus farms kills;
    Spectre farms creeps. A player's banner stats are a property of their hero
    pool as much as of their skill, and hero pools move when the patch does.

The point of this module is that every one of those is **estimated from the
corpus**, not hand-tuned. Elasticities and slopes are fitted; the only thing a
human supplies is the hero viability shift for a patch too new to have data,
and that one is labelled `assumption` in the audit so it can never masquerade
as a measurement.

Each factor reports what kind of thing it is, how much evidence stands behind
it, and what it did. `scripts/audit.py` re-runs the pipeline with each factor
disabled in turn, so "does this actually matter" is answered with a number
rather than a story.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Iterable, Literal

import numpy as np

from .config import Player
from .sources.base import MatchResult, PlayerGame

Kind = Literal["data", "assumption", "absent"]

# Duration is normalised to this length. The value only sets the scale of the
# adjusted numbers, not the ranking -- every game is moved to the same yardstick.
REFERENCE_MINUTES = 40.0

# Guard for the denominator of a least-squares slope. A predictor with no
# spread -- every game the same length, every opponent the same rating -- gives
# a zero sum of squares, and dividing by it would produce an infinity that then
# scales a whole stat line. The stat is skipped instead, which leaves it
# uncorrected rather than corrected by garbage.
_EPS = 1e-9


@dataclass
class FactorReport:
    name: str
    kind: Kind
    enabled: bool
    evidence: str
    detail: dict = field(default_factory=dict)

    @property
    def status(self) -> str:
        if not self.enabled:
            return "off"
        return {"data": "measured", "assumption": "assumed", "absent": "missing"}[
            self.kind
        ]


# --------------------------------------------------------------------------
# 1. Duration
# --------------------------------------------------------------------------


def fit_duration_elasticity(
    games: Iterable[PlayerGame], stats: Iterable[str]
) -> tuple[dict[str, float], dict[str, dict]]:
    """Per stat, the exponent b in `stat ~ duration^b`, fitted by OLS on logs.

    Fitting this rather than assuming it matters: last hits scale close to
    linearly with time (b near 1), teamfight participation is a fraction and
    should not scale at all (b near 0), and deaths sit somewhere in between.
    Assuming a single rule for all of them would be wrong for most of them.
    """
    rows = [g for g in games if g.duration_seconds]
    out: dict[str, float] = {}
    diag: dict[str, dict] = {}
    if len(rows) < 30:
        return out, diag

    logd = np.log(np.array([g.duration_seconds for g in rows], dtype=float) / 60.0)
    for stat in stats:
        vals = np.array([g.stats.get(stat, np.nan) for g in rows], dtype=float)
        mask = np.isfinite(vals) & (vals > 0)
        if mask.sum() < 30:
            continue
        x = logd[mask]
        y = np.log(vals[mask])
        x_c = x - x.mean()
        denom = float((x_c**2).sum())
        if denom <= _EPS:
            continue
        b = float((x_c * (y - y.mean())).sum() / denom)
        resid = y - (y.mean() + b * x_c)
        ss_tot = float(((y - y.mean()) ** 2).sum())
        r2 = 1.0 - float((resid**2).sum()) / ss_tot if ss_tot > _EPS else 0.0
        # Clamp: an |elasticity| above 2 is a fitting artefact on a sparse stat,
        # not a real scaling law, and would blow up short or long games.
        b = max(-2.0, min(2.0, b))
        out[stat] = b
        diag[stat] = {"elasticity": b, "r2": r2, "n": int(mask.sum())}
    return out, diag


def normalise_duration(
    games: list[PlayerGame], elasticity: dict[str, float]
) -> list[PlayerGame]:
    """Move every stat line onto a `REFERENCE_MINUTES` game."""
    if not elasticity:
        return games
    out = []
    for g in games:
        if not g.duration_seconds:
            out.append(g)
            continue
        ratio = REFERENCE_MINUTES / (g.duration_seconds / 60.0)
        out.append(
            replace(
                g,
                stats={
                    k: v * (ratio ** elasticity[k]) if k in elasticity else v
                    for k, v in g.stats.items()
                },
            )
        )
    return out


# --------------------------------------------------------------------------
# 2. Opponent strength
# --------------------------------------------------------------------------


def build_opponent_index(
    matches: list[MatchResult], players: list[Player]
) -> dict[tuple[int, int], str]:
    """(account_id, match_id) -> opposing team name, via the player's own team.

    Indexed by team name first. The obvious spelling -- for each player, scan
    every match -- is eighty players against six thousand matches, and all but a
    handful of those comparisons are a name against a name it was never going to
    equal. One pass to group the matches by side turns it into a lookup.
    """
    opponents: dict[str, list[tuple[int, str]]] = {}
    for m in matches:
        if not (m.radiant_name and m.dire_name):
            continue
        opponents.setdefault(m.radiant_name, []).append((m.match_id, m.dire_name))
        opponents.setdefault(m.dire_name, []).append((m.match_id, m.radiant_name))

    # Still keyed by account first, so one account listed twice resolves to one
    # team exactly as it did before -- the last entry wins, and the index does
    # not quietly gain the other team's games.
    team_of = {p.account_id: p.team for p in players if p.account_id}
    out: dict[tuple[int, int], str] = {}
    for acct, team in team_of.items():
        for mid, opponent in opponents.get(team, ()):
            out[(acct, mid)] = opponent
    return out


def fit_opponent_slope(
    games: Iterable[PlayerGame],
    opponent_rating: dict[tuple[int, int], float],
    stats: Iterable[str],
) -> tuple[dict[str, float], dict[str, dict]]:
    """Per stat, slope c in `log(stat) ~ c * opponent_rating`.

    Negative c is the expected sign for farm stats -- stronger opposition means
    fewer creeps, less gold, fewer free stacks.
    """
    pairs = [
        (g, opponent_rating[(g.account_id, g.match_id)])
        for g in games
        if (g.account_id, g.match_id) in opponent_rating
    ]
    out: dict[str, float] = {}
    diag: dict[str, dict] = {}
    if len(pairs) < 30:
        return out, diag

    r = np.array([p[1] for p in pairs], dtype=float)
    for stat in stats:
        vals = np.array([p[0].stats.get(stat, np.nan) for p in pairs], dtype=float)
        mask = np.isfinite(vals) & (vals > 0)
        if mask.sum() < 30:
            continue
        x = r[mask]
        y = np.log(vals[mask])
        x_c = x - x.mean()
        denom = float((x_c**2).sum())
        if denom <= _EPS:
            continue
        c = float((x_c * (y - y.mean())).sum() / denom)
        c = max(-1.0, min(1.0, c))
        out[stat] = c
        diag[stat] = {"slope": c, "n": int(mask.sum()), "mean_opp": float(x.mean())}
    return out, diag


def normalise_opponent(
    games: list[PlayerGame],
    slope: dict[str, float],
    opponent_rating: dict[tuple[int, int], float],
    reference: float,
) -> list[PlayerGame]:
    """Restate every line as if it had been played against an average TI team."""
    if not slope:
        return games
    out = []
    for g in games:
        rating = opponent_rating.get((g.account_id, g.match_id))
        if rating is None:
            out.append(g)
            continue
        delta = reference - rating
        out.append(
            replace(
                g,
                stats={
                    k: v * math.exp(slope[k] * delta) if k in slope else v
                    for k, v in g.stats.items()
                },
            )
        )
    return out


# --------------------------------------------------------------------------
# 2b. Restating a normalised line onto the conditions actually expected
# --------------------------------------------------------------------------


def restate(
    games: list[PlayerGame],
    *,
    elasticity: dict[str, float] | None = None,
    minutes_from: float = REFERENCE_MINUTES,
    minutes_to: float | None = None,
    slope: dict[str, float] | None = None,
    rating_from: float = 0.0,
    rating_to: float | None = None,
) -> list[PlayerGame]:
    """Move normalised stat lines from the fitting yardstick to the expected one.

    `normalise_duration` and `normalise_opponent` exist to put every observation on
    a common scale: a 40-minute game against a field-average TI team. That is the
    right thing for *comparing* games and the wrong thing for *projecting* them,
    because the games being projected are neither. Two gaps, both measured:

    * TI games run about 45 minutes, not 40. Stats scale with length at very
      different rates -- Creep Score close to linearly, Teamfight Participation not
      at all -- so a 12% length error is not a harmless level shift. It re-weights
      the emblems against each other and can reorder teams whose stat mixes differ.
    * The Main Event field is the eight strongest teams left, all well above the
      16-team average the lines were normalised to, and each team faces a different
      expected strength depending on its bracket path.

    Both corrections reuse the coefficients already fitted by this module, so
    nothing new is assumed -- the same elasticity and slope are simply evaluated at
    the conditions that will actually obtain.
    """
    mult: dict[str, float] = {}
    if elasticity and minutes_to and minutes_to > 0 and minutes_from > 0:
        ratio = minutes_to / minutes_from
        for stat, b in elasticity.items():
            mult[stat] = mult.get(stat, 1.0) * ratio**b
    if slope and rating_to is not None:
        delta = rating_to - rating_from
        for stat, c in slope.items():
            mult[stat] = mult.get(stat, 1.0) * math.exp(c * delta)
    if not mult:
        return games
    return [
        replace(g, stats={k: v * mult.get(k, 1.0) for k, v in g.stats.items()})
        for g in games
    ]


# --------------------------------------------------------------------------
# 3. League strength
# --------------------------------------------------------------------------


def league_strength(
    matches: list[MatchResult], rating: dict[str, float]
) -> dict[int, float]:
    """Mean participant rating per league.

    Deliberately not OpenDota's `tier`: in this corpus 790 of 833 relevant
    matches are labelled `professional`, which puts the Esports World Cup and
    DreamLeague Division 2 in the same bucket. Averaging the fitted strength of
    everyone who actually played is both finer grained and free of hand-assigned
    weights.
    """
    acc: dict[int, list[float]] = {}
    for m in matches:
        if m.league_id is None:
            continue
        for name in (m.radiant_name, m.dire_name):
            if name and name in rating:
                acc.setdefault(m.league_id, []).append(rating[name])
    return {lid: float(np.mean(v)) for lid, v in acc.items() if v}


def league_weights(
    games: Iterable[PlayerGame],
    match_league: dict[int, int],
    strength: dict[int, float],
    *,
    spread: float = 0.5,
) -> dict[int, float]:
    """match_id -> weight in (0, 1], centred on the median league.

    `spread` controls how hard a weak league is discounted. A game in a league
    one rating point below the median is worth exp(-spread) of a median game.
    """
    if not strength:
        return {}
    med = float(np.median(list(strength.values())))
    out: dict[int, float] = {}
    for g in games:
        lid = match_league.get(g.match_id)
        s = strength.get(lid) if lid is not None else None
        out[g.match_id] = 1.0 if s is None else math.exp(-spread * max(0.0, med - s))
    return out


# --------------------------------------------------------------------------
# 4. Hero pool
# --------------------------------------------------------------------------


def hero_weights(
    games: Iterable[PlayerGame], viability: dict[int, float]
) -> dict[int, float]:
    """match_id -> weight from the hero played.

    `viability` is a per-hero multiplier for the current patch. The *mapping*
    from a game to a hero is data (OpenDota gives `hero_id` on every row in
    this corpus); the *magnitude* of each shift is a human judgement read off
    the patch notes, and is reported as an assumption for exactly that reason.
    """
    if not viability:
        return {}
    return {
        g.match_id: viability.get(g.hero_id, 1.0) if g.hero_id else 1.0 for g in games
    }


def hero_profile(games: Iterable[PlayerGame]) -> dict[int, int]:
    """hero_id -> games played, for the audit."""
    out: dict[int, int] = {}
    for g in games:
        if g.hero_id:
            out[g.hero_id] = out.get(g.hero_id, 0) + 1
    return out


__all__ = [
    "REFERENCE_MINUTES",
    "FactorReport",
    "build_opponent_index",
    "fit_duration_elasticity",
    "fit_opponent_slope",
    "hero_profile",
    "hero_weights",
    "league_strength",
    "league_weights",
    "normalise_duration",
    "normalise_opponent",
    "restate",
]
