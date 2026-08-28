"""Gameplay-patch adjustment, applied as an explicit prior.

The model is fit on ~6 months of results. When a balance patch lands days
before the event there is no post-patch data to fit on, so the choice is
between pretending nothing changed and stating an assumption out loud. This
module is the second option: every adjustment comes from `config/patch.yaml`,
is scaled by one global `strength` dial, and is echoed back in the run warnings
and in `out/analysis.json` so a locked pick can always be traced to what was
assumed when it was made.

Two things it touches, and one it deliberately does not:

* **Per-game stats.** Scaled on the raw `PlayerGame.stats`, not on the computed
  means. `weighted_stat_means` drives which emblem wins a colour, but
  `role_game_scores` re-scores every actual game under that banner and sets the
  right-tail sigma `expected_best_series` depends on. Scaling the means alone
  would move emblem selection while leaving the score distribution untouched,
  and the two would silently disagree.
* **Team ratings.** An additive delta in logit units, applied after the fit and
  before the Swiss simulation.
* **Not hero pools or drafts.** A stat multiplier is a blunt instrument standing
  in for "this hero left the meta". It cannot know who picked what.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import yaml

from .banner import STAT_SOURCE
from .config import CONFIG_DIR, ROLES
from .ratings import Ratings
from .sources.base import PlayerGame

DEFAULT_PATH = CONFIG_DIR / "patch.yaml"


@dataclass
class PatchAdjustment:
    version: str
    strength: float = 1.0
    released_utc: str = ""
    source: str = ""
    # scoring-stat name -> role -> raw multiplier (before `strength` is applied)
    stat_multipliers: dict[str, dict[str, float]] = field(default_factory=dict)
    team_rating_delta: dict[str, float] = field(default_factory=dict)
    # hero display name -> viability multiplier for the current patch
    hero_viability: dict[str, float] = field(default_factory=dict)

    @property
    def active(self) -> bool:
        """False when the layer would be a no-op, so callers can skip the work."""
        if self.strength == 0.0:
            return False
        return bool(
            self.stat_multipliers or self.team_rating_delta or self.hero_viability
        )

    def hero_weights_by_id(self, hero_names: dict[int, str]) -> dict[int, float]:
        """Resolve configured hero names against the API's id -> name map.

        Raises on an unknown name rather than silently ignoring it: a typo in a
        hero name would otherwise mean the adjustment simply never applies, and
        the audit would report a factor as active that is doing nothing.
        """
        if not self.hero_viability:
            return {}
        by_name = {v.lower(): k for k, v in hero_names.items()}
        out: dict[int, float] = {}
        unknown = []
        for name, mult in self.hero_viability.items():
            hid = by_name.get(name.lower())
            if hid is None:
                unknown.append(name)
                continue
            out[hid] = self.scaled(float(mult))
        if unknown:
            raise ValueError(
                f"config/patch.yaml hero_viability names not found in the hero "
                f"list: {sorted(unknown)}"
            )
        return out

    def scaled(self, multiplier: float) -> float:
        """Interpolate a multiplier toward 1.0 by `strength`."""
        return 1.0 + (multiplier - 1.0) * self.strength

    def source_field_multipliers(self, role: str) -> dict[str, float]:
        """Multipliers for one role, keyed by OpenDota field name.

        Config is written in scoring-stat names because that is what a reader of
        the patch notes thinks in. `PlayerGame.stats` is keyed by OpenDota field
        name. `STAT_SOURCE` already owns that translation, so reuse it rather
        than maintaining a second copy that can drift.
        """
        out: dict[str, float] = {}
        for stat, by_role in self.stat_multipliers.items():
            raw = by_role.get(role)
            if raw is None:
                continue
            source = STAT_SOURCE.get(stat)
            if source is None:
                continue
            m = self.scaled(float(raw))
            if m != 1.0:
                out[source] = m
        return out

    def applied(self) -> dict[str, Any]:
        """What this layer actually did, for the JSON dump."""
        return {
            "version": self.version,
            "released_utc": self.released_utc,
            "source": self.source,
            "strength": self.strength,
            "stat_multipliers": {
                stat: {
                    role: self.scaled(float(m))
                    for role, m in by_role.items()
                    if self.scaled(float(m)) != 1.0
                }
                for stat, by_role in self.stat_multipliers.items()
            },
            "team_rating_delta": {
                t: d * self.strength for t, d in self.team_rating_delta.items()
            },
            "hero_viability": {
                h: self.scaled(float(m)) for h, m in self.hero_viability.items()
            },
        }


def load(
    path: Path | None = None, *, strength: float | None = None
) -> PatchAdjustment | None:
    """Read `config/patch.yaml`. A missing file is not an error."""
    path = path or DEFAULT_PATH
    if not path.exists():
        return None
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    mults: dict[str, dict[str, float]] = {}
    for stat, by_role in (raw.get("stat_multipliers") or {}).items():
        if stat not in STAT_SOURCE:
            raise ValueError(
                f"config/patch.yaml: {stat!r} is not a scoring stat this model "
                f"can measure. Known: {sorted(STAT_SOURCE)}"
            )
        bad = set(by_role) - set(ROLES)
        if bad:
            raise ValueError(
                f"config/patch.yaml: {stat!r} names unknown roles {sorted(bad)}. "
                f"Known: {list(ROLES)}"
            )
        mults[stat] = {r: float(v) for r, v in by_role.items()}

    return PatchAdjustment(
        version=str(raw.get("version", "unknown")),
        strength=float(raw["strength"] if strength is None else strength),
        released_utc=str(raw.get("released_utc", "")),
        source=str(raw.get("source", "")),
        stat_multipliers=mults,
        team_rating_delta={
            str(k): float(v) for k, v in (raw.get("team_rating_delta") or {}).items()
        },
        hero_viability={
            str(k): float(v) for k, v in (raw.get("hero_viability") or {}).items()
        },
    )


def scale_games(
    games: list[PlayerGame], role: str, adj: PatchAdjustment
) -> list[PlayerGame]:
    """Copy `games` with the role's stat multipliers applied.

    Copies rather than mutating: the same `PlayerGame` objects are reachable
    from `corpus.player_games` and a second call would compound the scaling.
    """
    factors = adj.source_field_multipliers(role)
    if not factors:
        return games
    return [
        replace(
            g,
            stats={k: v * factors.get(k, 1.0) for k, v in g.stats.items()},
        )
        for g in games
    ]


def adjust_ratings(ratings: Ratings, adj: PatchAdjustment) -> Ratings:
    """Additive delta in logit units. Unlisted teams are unchanged."""
    deltas = {t: d * adj.strength for t, d in adj.team_rating_delta.items()}
    if not any(deltas.values()):
        return ratings
    return replace(
        ratings,
        values={t: v + deltas.get(t, 0.0) for t, v in ratings.values.items()},
    )


def describe(adj: PatchAdjustment | None) -> list[str]:
    """Lines for the pre-lock warning panel."""
    if adj is None:
        return [
            "Patch layer OFF (--no-patch, or no config/patch.yaml): the model "
            "assumes the current patch plays exactly like the fitted history."
        ]
    if not adj.active:
        return [
            f"Patch layer {adj.version} loaded but INACTIVE "
            f"(strength={adj.strength:g}, no non-trivial adjustments): "
            f"projections assume no balance change since the fitted history."
        ]

    stats = sorted(
        f"{stat} {role} x{adj.scaled(float(m)):.2f}"
        for stat, by_role in adj.stat_multipliers.items()
        for role, m in by_role.items()
        if adj.scaled(float(m)) != 1.0
    )
    lines = [
        f"Patch {adj.version} ({adj.released_utc[:10]}) applied as a PRIOR at "
        f"strength {adj.strength:g}, not fit from post-patch results - there are "
        f"almost none before the lock. Adjustments: "
        + (", ".join(stats) if stats else "none")
        + "."
    ]
    if adj.team_rating_delta:
        lines.append(
            "Patch team rating deltas: "
            + ", ".join(
                f"{t} {d * adj.strength:+.3f}"
                for t, d in sorted(adj.team_rating_delta.items())
            )
        )
    return lines


__all__ = [
    "PatchAdjustment",
    "adjust_ratings",
    "describe",
    "load",
    "scale_games",
]
