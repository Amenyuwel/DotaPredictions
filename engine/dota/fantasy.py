"""Fantasy projection under the real TI 2026 scoring chain.

    per game   -> sum of the player's War Banner stats (nothing else),
                  x coach Title multipliers where the condition is met
    per role   -> AVERAGE across the players in that role (2 for core/support)
    per series -> sum of the TOP TWO games in that series
    per period -> the BEST series

The banner carried three emblems in the Group Stage and five in the Main Event, so
nothing here assumes a count -- it reads whatever `config/banners.yaml` holds.

Consequences that overturn ordinary fantasy reasoning:

* **Only the banner's stats exist per player.** Overall quality is close to
  irrelevant. What matters is what those few stats pay, and the base values are
  wildly unequal (Creep Score 3/unit, Roshan 1,172/unit), so this is not the same
  ordering as "who is good".
* **Role scores are averaged, not summed.** A weak partner in a duo drags the
  slot down directly -- you are buying the pair's mean, so the floor matters as
  much as the ceiling.
* **Top two games per series, best series.** Not a plain maximum: consistency
  within a single series is rewarded, because you need two good games in the
  same series rather than one spike across the phase.
* **Games played hardly matters.** More series is more chances at a good one,
  with heavy diminishing returns.

Modelling note: role scores are built by joining teammates *within the same
match*, not by averaging their independent per-game distributions. Teammates'
stats are strongly correlated -- a stomp inflates everyone -- and treating them
as independent would understate the spread of the pair's average.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

import numpy as np

from .banner import BannerPlan, banner_score_for_game, best_banner
from .config import Player, Scoring
from .sources.base import PlayerGame


@dataclass
class PlayerProfile:
    player: Player
    games_sampled: int
    stat_means: dict[str, float]
    banner: BannerPlan

    @property
    def key(self) -> str:
        return self.player.key

    @property
    def banner_points(self) -> float:
        return self.banner.points


@dataclass
class SlotProjection:
    """One roster slot: a core duo, a support duo, or the single mid."""

    slot: str
    team: str
    players: list[Player]
    banners: dict[str, BannerPlan]
    banner: BannerPlan | None = None      # the slot's shared banner
    stat_means: dict[str, float] = field(default_factory=dict)
    game_scores: list[float] = field(default_factory=list)
    matches_sampled: int = 0
    mean_game: float = 0.0
    sd_game: float = 0.0
    projected: float = 0.0        # E[best series score]

    @property
    def label(self) -> str:
        return " + ".join(p.nick for p in self.players)


def weighted_stat_means(
    games: list[PlayerGame],
    *,
    as_of: datetime | None = None,
    half_life_days: float = 60.0,
    game_weight: dict[int, float] | None = None,
) -> tuple[dict[str, float], float]:
    """Recency-weighted per-game mean of every raw stat we observed.

    `game_weight` multiplies the recency weight per match_id. It carries the
    evidence-quality factors -- league strength and hero viability -- so a game
    in an open qualifier on a hero the patch just gutted counts for less than a
    DreamLeague game on a hero that is still good.
    """
    as_of = as_of or max((g.start_time for g in games), default=None)
    gw = game_weight or {}
    sums: dict[str, float] = {}
    wts: dict[str, float] = {}
    total_w = 0.0
    for g in games:
        age = (as_of - g.start_time).total_seconds() / 86400.0 if as_of else 0.0
        w = 0.5 ** (max(age, 0.0) / half_life_days) * gw.get(g.match_id, 1.0)
        total_w += w
        for stat, v in g.stats.items():
            sums[stat] = sums.get(stat, 0.0) + v * w
            wts[stat] = wts.get(stat, 0.0) + w
    return {s: sums[s] / wts[s] for s in sums if wts[s] > 0}, total_w


def profile_player(
    player: Player,
    games: list[PlayerGame],
    scoring: Scoring,
    *,
    as_of: datetime | None = None,
    half_life_days: float = 60.0,
    game_weight: dict[int, float] | None = None,
) -> PlayerProfile:
    means, _ = weighted_stat_means(
        games, as_of=as_of, half_life_days=half_life_days, game_weight=game_weight
    )
    return PlayerProfile(
        player=player,
        games_sampled=len(games),
        stat_means=means,
        banner=best_banner(player.key, scoring, means),
    )


def role_game_scores(
    players: list[Player],
    player_games: dict[int, list[PlayerGame]],
    banners: dict[str, BannerPlan],
    scoring: Scoring,
    *,
    game_multiplier: "Callable[[Player, PlayerGame], float] | None" = None,
) -> list[tuple[float, datetime, int]]:
    """Per-match role score: the average of the slot's players in that match.

    Only matches where every player in the slot appears are used, which keeps
    teammate correlation intact. The match_id rides along so the caller can
    weight the bootstrap by evidence quality.

    `game_multiplier(player, game)` scales one player's score in one game before
    the role average is taken. Coach Title prefixes need exactly that: they key
    on the hero, so they fire per player per game, and averaging their rate over
    a season would erase the difference between two players with the same skill
    and different hero pools.
    """
    by_match: dict[int, dict[str, PlayerGame]] = {}
    for p in players:
        for g in player_games.get(p.account_id or -1, []):
            by_match.setdefault(g.match_id, {})[p.key] = g

    out: list[tuple[float, datetime, int]] = []
    for match_id, rows in by_match.items():
        if len(rows) != len(players):
            continue
        scores = [
            banner_score_for_game(banners[p.key], rows[p.key].stats, scoring)
            * (1.0 if game_multiplier is None else game_multiplier(p, rows[p.key]))
            for p in players
        ]
        when = next(iter(rows.values())).start_time
        out.append((sum(scores) / len(scores), when, match_id))
    out.sort(key=lambda r: r[1])
    return out


@dataclass
class SeriesPlan:
    """A flattened sample of `n_sims` periods, ready to score repeatedly.

    One row per *series*, tagged with which simulated period it belongs to. The
    schedule is drawn once so that re-scoring under a different weighting -- which
    is what a bootstrap interval needs -- costs a handful of vectorised draws
    rather than a Python loop per simulation.
    """

    n_sims: int
    sim_of_series: np.ndarray      # which simulated period each series belongs to
    games_in_series: np.ndarray    # games played in that series
    is_decider: np.ndarray         # did it go the full distance
    starts: np.ndarray             # reduceat offsets, one per period

    @property
    def n_series(self) -> int:
        return int(self.games_in_series.size)


def plan_series(
    series_samples: list[tuple[int, ...]],
    *,
    n_sims: int = 4000,
    decider_samples: list[tuple[bool, ...]] | None = None,
    rng: np.random.Generator | None = None,
    indices: "np.ndarray | None" = None,
) -> "SeriesPlan | None":
    """Draw `n_sims` periods from the simulated schedule and flatten them.

    `indices` selects specific simulations instead of drawing them at random. Pass
    the same indices for two teams and their schedules stay *joined*: both come from
    the same simulated bracket, so the fact that two of your teams cannot both win
    it is preserved. That matters for the spread of a roster total, though not for
    its mean.
    """
    if not series_samples:
        return None
    rng = rng or np.random.default_rng(20260813)
    picks = (
        rng.integers(0, len(series_samples), size=n_sims)
        if indices is None
        else np.asarray(indices, dtype=np.int64)
    )

    sim_of: list[int] = []
    games: list[int] = []
    decider: list[bool] = []
    starts: list[int] = []
    for out_i, i in enumerate(picks):
        shape = series_samples[i]
        flags = decider_samples[i] if decider_samples else ()
        starts.append(len(games))
        for j, n in enumerate(shape):
            sim_of.append(out_i)
            games.append(int(n))
            decider.append(bool(flags[j]) if j < len(flags) else False)
    if not games:
        return None
    return SeriesPlan(
        n_sims=len(picks),
        sim_of_series=np.asarray(sim_of, dtype=np.int64),
        games_in_series=np.asarray(games, dtype=np.int64),
        is_decider=np.asarray(decider, dtype=bool),
        starts=np.asarray(starts, dtype=np.int64),
    )


def _probabilities(pool_size: int, weights: list[float] | None) -> np.ndarray | None:
    """Normalised draw probabilities, or None for a uniform bootstrap."""
    if weights is None or len(weights) != pool_size:
        return None
    w = np.clip(np.asarray(weights, dtype=float), 0.0, None)
    return w / w.sum() if w.sum() > 0 else None


def score_plan_samples(
    pool: np.ndarray,
    plan: SeriesPlan,
    rng: np.random.Generator,
    *,
    p: np.ndarray | None = None,
    decider_bonus: float = 0.0,
) -> np.ndarray:
    """One period score per simulated run -- the distribution, not its mean.

    Kept separate from `score_plan` because the mean answers "what will this slot
    score" and the distribution answers "what happens if the team goes out early",
    which is a different question with a much wider answer.
    """
    cdf = None if p is None else np.cumsum(p)

    def draw(rows: int, cols: int) -> np.ndarray:
        if cdf is None:
            return pool[rng.integers(0, pool.size, size=(rows, cols))]
        # searchsorted on the CDF draws from the identical distribution as
        # rng.choice(p=...) at a fraction of the cost.
        idx = np.searchsorted(cdf, rng.random((rows, cols)), side="right")
        return pool[np.clip(idx, 0, pool.size - 1)]

    series_score = np.zeros(plan.n_series, dtype=float)
    for n in np.unique(plan.games_in_series):
        idx = np.flatnonzero(plan.games_in_series == n)
        draws = draw(idx.size, int(n))
        if decider_bonus:
            hit = plan.is_decider[idx]
            if hit.any():
                # The Clutch fires on the last possible game of a series, so it
                # amplifies exactly one drawn game -- and since a series scores
                # its top TWO games, an amplified decider is also likelier to
                # survive into the score. Charging the bonus as a flat rate over
                # the whole period would miss both effects.
                draws[hit, -1] *= 1.0 + decider_bonus
        if n >= 2:
            part = np.sort(draws, axis=1)[:, -2:].sum(axis=1)
        else:
            part = draws.sum(axis=1)
        series_score[idx] = part

    # The period keeps the BEST series, not the last.
    return np.maximum.reduceat(series_score, plan.starts)


def score_plan(
    pool: np.ndarray,
    plan: SeriesPlan,
    rng: np.random.Generator,
    *,
    p: np.ndarray | None = None,
    decider_bonus: float = 0.0,
) -> float:
    """E[best series] for one pool of game scores and one drawn schedule.

    Vectorised by series length rather than looped per simulation: every series of
    the same length is drawn in one call, so the cost is a few large draws instead
    of tens of thousands of tiny ones. That is what makes a bootstrap interval
    affordable at all.
    """
    return float(
        score_plan_samples(
            pool, plan, rng, p=p, decider_bonus=decider_bonus
        ).mean()
    )


def expected_best_series(
    game_scores: list[float],
    series_samples: list[tuple[int, ...]],
    *,
    rng: np.random.Generator | None = None,
    n_sims: int = 4000,
    weights: list[float] | None = None,
    decider_samples: list[tuple[bool, ...]] | None = None,
    decider_bonus: float = 0.0,
) -> float:
    """E[ best series score ], where a series scores its top two games.

    Games are resampled from the observed role scores rather than from a fitted
    curve. With the whole scoring chain riding on order statistics, the shape of
    the real distribution matters more than any parametric family would capture,
    and the bootstrap keeps it.

    A one-game series scores that single game; a series shorter than two games
    cannot be padded.
    """
    if not game_scores or not series_samples:
        return 0.0
    rng = rng or np.random.default_rng(20260813)
    pool = np.asarray(game_scores, dtype=float)
    plan = plan_series(
        series_samples, n_sims=n_sims, decider_samples=decider_samples, rng=rng
    )
    if plan is None:
        return 0.0
    return score_plan(
        pool,
        plan,
        rng,
        p=_probabilities(pool.size, weights),
        decider_bonus=decider_bonus,
    )


def best_series_interval(
    game_scores: list[float],
    series_samples: list[tuple[int, ...]],
    *,
    weights: list[float] | None = None,
    decider_samples: list[tuple[bool, ...]] | None = None,
    decider_bonus: float = 0.0,
    n_boot: int = 160,
    n_sims: int = 800,
    rng: np.random.Generator | None = None,
) -> tuple[float, float, float]:
    """(sd, p5, p95) of the projection under resampling of the observed games.

    A projection built on 40 observed games is not the same claim as one built on
    112, and a point estimate hides the difference. This is a Bayesian bootstrap:
    Dirichlet noise multiplies the evidence weights, so each replicate re-weights
    the *same* observations instead of re-drawing them, which leaves the
    league/hero/recency weighting intact.

    It covers sampling error in the observed pool, and nothing else. Bracket
    randomness is already inside the point estimate; model error -- a wrong stat
    definition, a stale roster, a meta shift -- is covered by no interval here.
    """
    if not game_scores or not series_samples:
        return 0.0, 0.0, 0.0
    rng = rng or np.random.default_rng(20260820)
    pool = np.asarray(game_scores, dtype=float)
    plan = plan_series(
        series_samples, n_sims=n_sims, decider_samples=decider_samples, rng=rng
    )
    if plan is None:
        return 0.0, 0.0, 0.0
    base = _probabilities(pool.size, weights)
    if base is None:
        base = np.full(pool.size, 1.0 / pool.size)

    draws = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        w = base * rng.dirichlet(np.ones(pool.size))
        draws[b] = score_plan(
            pool, plan, rng, p=w / w.sum(), decider_bonus=decider_bonus
        )
    return (
        float(draws.std(ddof=1)),
        float(np.percentile(draws, 5)),
        float(np.percentile(draws, 95)),
    )


def recency_weights(
    rows: list[tuple[float, datetime, int]],
    *,
    game_weight: dict[int, float] | None = None,
    half_life_days: float = 60.0,
    as_of: datetime | None = None,
) -> list[float]:
    """Bootstrap weights combining evidence quality with age.

    `weighted_stat_means` always decayed old games, but the *bootstrap* did not:
    it drew a February game as often as one from this week, so the distribution
    the projection samples was six months of form averaged flat. On a corpus
    whose median game is over two months old, and where the event's own games are
    barely a tenth of the sample, that is not a detail -- it is most of the reason
    a team that just changed form looks unchanged.
    """
    if not rows:
        return []
    gw = game_weight or {}
    latest = as_of or max(when for _, when, _ in rows)
    out = []
    for _score, when, match_id in rows:
        age = max((latest - when).total_seconds() / 86400.0, 0.0)
        out.append(0.5 ** (age / half_life_days) * gw.get(match_id, 1.0))
    return out


def project_slot(
    slot: str,
    team: str,
    players: list[Player],
    profiles: dict[str, PlayerProfile],
    player_games: dict[int, list[PlayerGame]],
    scoring: Scoring,
    series_samples: list[tuple[int, ...]],
    *,
    rng: np.random.Generator | None = None,
    game_weight: dict[int, float] | None = None,
) -> SlotProjection:
    # ONE banner per role slot, shared by both players in a duo. Since the role
    # score is the pair's average and both are scored through the same three
    # emblems, the optimal banner is the one fitted to their combined per-game
    # stats -- not the better of their two individual banners. A duo whose
    # strengths do not overlap is therefore worth less than either player
    # suggests alone, which is a real cost of the duo rule.
    combined: dict[str, float] = {}
    for stat in {s for p in players for s in profiles[p.key].stat_means}:
        vals = [
            profiles[p.key].stat_means[stat]
            for p in players
            if stat in profiles[p.key].stat_means
        ]
        combined[stat] = sum(vals) / len(vals)
    slot_banner = best_banner(f"{slot}/{team}", scoring, combined)
    banners = {p.key: slot_banner for p in players}

    rows = role_game_scores(players, player_games, banners, scoring)
    scores = [s for s, _, _ in rows]
    gw = game_weight or {}
    weights = [gw.get(mid, 1.0) for _, _, mid in rows] if gw else None

    proj = SlotProjection(
        slot=slot,
        team=team,
        players=players,
        banners=banners,
        banner=slot_banner,
        stat_means=combined,
        game_scores=scores,
        matches_sampled=len(scores),
    )
    if scores:
        arr = np.asarray(scores, dtype=float)
        proj.mean_game = float(arr.mean())
        proj.sd_game = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0
        proj.projected = expected_best_series(
            scores, series_samples, rng=rng, weights=weights
        )
    return proj


def summarise_banner(plan: BannerPlan, scoring: Scoring) -> str:
    parts = []
    for c in plan.ordered(scoring.colors):
        parts.append(f"{c.color[0].upper()}:{c.label} ({c.base_points:,.0f})")
    return "  ".join(parts)


__all__ = [
    "PlayerProfile",
    "SeriesPlan",
    "SlotProjection",
    "best_series_interval",
    "expected_best_series",
    "plan_series",
    "recency_weights",
    "score_plan",
    "score_plan_samples",
    "profile_player",
    "project_slot",
    "role_game_scores",
    "summarise_banner",
    "weighted_stat_means",
    "math",
]
