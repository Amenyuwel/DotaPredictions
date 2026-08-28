"""Wires sources -> ratings -> Swiss simulation -> projections -> picks."""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from datetime import timedelta

import numpy as np

from . import factors as factors_mod
from . import patch as patch_mod
from . import ratings as ratings_mod
from . import swiss
from .banner import STAT_SOURCE, BannerPlan
from .config import CACHE_DIR, DATA_DIR, OUT_DIR, Config, Player
from .fantasy import (
    PlayerProfile,
    SlotProjection,
    profile_player,
    project_slot,
    summarise_banner,
)
from .optimize import (
    FantasyRoster,
    PredictionPlan,
    enumerate_fantasy_rosters,
    k_best_predictions,
    optimal_predictions,
    prediction_alternatives,
)
from .sources import MatchResult, OpenDota, PlayerGame, Stratz, utcnow


@dataclass
class Analysis:
    config: Config
    ratings: ratings_mod.Ratings
    outcome: swiss.SwissOutcome
    profiles: dict[str, PlayerProfile]
    slots: dict[str, SlotProjection]
    predictions: PredictionPlan
    prediction_variants: list[PredictionPlan]
    alternatives: dict[str, list[tuple[str, float]]]
    rosters: list[FantasyRoster]
    corpus: "Corpus"
    patch: patch_mod.PatchAdjustment | None = None
    factor_reports: list[factors_mod.FactorReport] = field(default_factory=list)
    # Stat lines after the factor stack, plus the evidence weight per match.
    # Kept so a fixed-banner re-projection scores the same corrected numbers the
    # main projection did, rather than the raw ones.
    adjusted_games: dict[int, list[PlayerGame]] = field(default_factory=dict)
    game_weight: dict[int, float] = field(default_factory=dict)


@dataclass
class Corpus:
    matches: list[MatchResult]
    player_games: dict[int, list[PlayerGame]]
    match_ids_used: list[int]
    stat_coverage: dict[str, float]
    source_notes: list[str]


def canonicalise(cfg: Config, matches: list[MatchResult]) -> list[MatchResult]:
    """Rewrite match team names to the config spelling, keyed on team_id.

    Without this, a rebranded org's games are split across two names and both
    halves get a weak rating. Falls back to the alias map for teams whose id
    was never resolved.
    """
    by_id = {t.team_id: t.name for t in cfg.roster.teams if t.team_id}
    by_id.update(cfg.roster.extra_team_ids)
    aliases = cfg.roster.aliases
    out = []
    for m in matches:
        r = by_id.get(m.radiant_team_id) or aliases.get(m.radiant_name or "")
        d = by_id.get(m.dire_team_id) or aliases.get(m.dire_name or "")
        if r or d:
            m = replace(
                m,
                radiant_name=r or m.radiant_name,
                dire_name=d or m.dire_name,
            )
        out.append(m)
    return out


def build_corpus(
    cfg: Config,
    *,
    history_days: int = 180,
    max_detail_matches: int = 400,
    verbose: bool = True,
) -> Corpus:
    """Fetch results for the rating model and parsed stat lines for fantasy."""
    od = OpenDota()
    stratz = Stratz()
    notes: list[str] = []
    since = utcnow() - timedelta(days=history_days)

    if verbose:
        print(f"[fetch] pro matches since {since:%Y-%m-%d} ...")
    matches = od.recent_pro_matches(since, limit=6000)
    if verbose:
        print(f"[fetch] {len(matches)} pro matches")

    # Canonicalise by team_id, which is stable, rather than by display name,
    # which is not: orgs rebrand mid-season (BetBoom plays as BoomBoys) and
    # OpenDota rows carry whatever name was current at the time.
    matches = canonicalise(cfg, matches)

    # Restrict detailed (expensive) fetches to games our 16 teams actually played.
    ours = set(cfg.roster.names)
    relevant = [
        m for m in matches if (m.radiant_name in ours) or (m.dire_name in ours)
    ]
    relevant.sort(key=lambda m: m.start_time, reverse=True)
    detail_ids = [m.match_id for m in relevant[:max_detail_matches]]
    if verbose:
        print(
            f"[fetch] {len(relevant)} involve TI teams; pulling stat lines for "
            f"{len(detail_ids)}"
        )

    wanted_accounts = {
        p.account_id for p in cfg.roster.all_players() if p.account_id
    }
    games: dict[int, list[PlayerGame]] = {}

    def absorb(rows: list[PlayerGame]) -> None:
        for g in rows:
            if g.account_id in wanted_accounts:
                games.setdefault(g.account_id, []).append(g)

    if stratz.available():
        notes.append("STRATZ token present: bulk stat fetch enabled.")
        try:
            absorb(stratz.player_games_for_matches(detail_ids))
        except Exception as exc:  # noqa: BLE001 - degrade, never fail the run
            notes.append(f"STRATZ bulk fetch failed ({exc}); using OpenDota only.")
    else:
        notes.append(
            "No STRATZ_API_TOKEN: using OpenDota match details "
            "(slower, same stats for parsed pro games)."
        )

    # OpenDota fills whatever STRATZ did not, and supplies the stats STRATZ's
    # trimmed query omits (stuns, wards, teamfight participation).
    failed: list[str] = []
    for i, mid in enumerate(detail_ids, 1):
        if verbose and i % 25 == 0:
            print(f"[fetch] match details {i}/{len(detail_ids)}")
        try:
            rows = od.player_games_from_match(mid)
        except Exception as exc:  # noqa: BLE001
            failed.append(f"{mid}: {exc}")
            continue
        for g in rows:
            if g.account_id not in wanted_accounts:
                continue
            existing = next(
                (x for x in games.get(g.account_id, []) if x.match_id == g.match_id),
                None,
            )
            if existing is None:
                games.setdefault(g.account_id, []).append(g)
            else:
                # Merge: keep STRATZ values, add stats it did not return.
                for k, v in g.stats.items():
                    existing.stats.setdefault(k, v)

    if failed:
        notes.append(
            f"{len(failed)} of {len(detail_ids)} match details could not be "
            f"fetched, so those games are missing from every projection "
            f"(first: {failed[0]})"
        )

    # How much of the scoring config we can actually observe.
    wanted = {s for s, m in cfg.scoring.stats.items() if m != 0.0}
    coverage: dict[str, float] = {}
    all_games = [g for rows in games.values() for g in rows]
    for stat in sorted(wanted):
        if not all_games:
            coverage[stat] = 0.0
            continue
        coverage[stat] = sum(1 for g in all_games if stat in g.stats) / len(all_games)

    return Corpus(
        matches=matches,
        player_games=games,
        match_ids_used=detail_ids,
        stat_coverage=coverage,
        source_notes=notes,
    )


def analyse(
    cfg: Config | None = None,
    *,
    corpus: Corpus | None = None,
    n_sims: int = 20000,
    history_days: int = 180,
    detail_matches: int = 400,
    half_life_days: float = 90.0,
    prior_strength: float = 3.0,
    elimination_pairing: str = "seeded",
    top_rosters: int = 15,
    variants: int = 5,
    use_patch: bool = True,
    patch_strength: float | None = None,
    enabled_factors: set[str] | None = None,
    verbose: bool = True,
) -> Analysis:
    cfg = cfg or Config()
    corpus = corpus or build_corpus(
        cfg,
        history_days=history_days,
        max_detail_matches=detail_matches,
        verbose=verbose,
    )

    # Kept on the Analysis even when inactive, so the report can say *why* no
    # adjustment was made rather than leaving it ambiguous.
    adj = patch_mod.load(strength=patch_strength) if use_patch else None
    active = adj if (adj is not None and adj.active) else None

    if verbose:
        print("[model] fitting team ratings ...")
    r = ratings_mod.fit(
        corpus.matches,
        cfg.roster.names,
        half_life_days=half_life_days,
        prior_strength=prior_strength,
        alias=cfg.roster.aliases,
    )
    if active is not None:
        r = patch_mod.adjust_ratings(r, active)

    if verbose:
        print(f"[model] simulating Swiss stage x{n_sims:,} ...")
    outcome = swiss.simulate(
        cfg.roster.names,
        r.win_prob,
        n_sims=n_sims,
        elimination_pairing=elimination_pairing,
    )

    # Patch-scaled stat lines, applied once here so banner selection, the mean,
    # and the right-tail sigma all see the same numbers.
    games = corpus.player_games
    if active is not None:
        if verbose:
            print(f"[model] applying patch {active.version} to stat lines ...")
        games = _scale_games(cfg, games, active)

    if verbose:
        print("[model] fitting stat-line factors ...")
    games, game_weight, reports = _apply_factors(
        cfg, corpus, games, r, active, enabled=enabled_factors
    )

    if verbose:
        print("[model] optimising War Banners per player ...")
    profiles = _profile_all(cfg, games, game_weight)

    if verbose:
        print("[model] projecting slot scores ...")
    slots = _project_slots(cfg, games, outcome, profiles, game_weight)

    grids = k_best_predictions(
        outcome, cfg.tournament.buckets, cfg.roster.names, k=max(variants, 1)
    )
    # Fall back rather than fail: a single optimal grid is still a usable answer
    # if Murty ever comes back empty.
    predictions = (
        grids[0]
        if grids
        else optimal_predictions(outcome, cfg.tournament.buckets, cfg.roster.names)
    )
    alternatives = prediction_alternatives(
        outcome, cfg.tournament.buckets, cfg.roster.names
    )
    rosters = enumerate_fantasy_rosters(
        cfg.roster,
        slots,
        distinct_teams=cfg.tournament.fantasy_distinct_teams,
        top_n=top_rosters,
    )

    return Analysis(
        config=cfg,
        ratings=r,
        outcome=outcome,
        profiles=profiles,
        slots=slots,
        predictions=predictions,
        prediction_variants=grids or [predictions],
        alternatives=alternatives,
        rosters=rosters,
        corpus=corpus,
        patch=adj,
        factor_reports=reports,
        adjusted_games=games,
        game_weight=game_weight,
    )


SLOT_ROLES = {
    "core": ("carry", "offlane"),
    "support": ("soft_support", "hard_support"),
    "mid": ("mid",),
}


def _scale_games(
    cfg: Config,
    games: dict[int, list[PlayerGame]],
    adj: patch_mod.PatchAdjustment,
) -> dict[int, list[PlayerGame]]:
    """Apply the patch layer per account, using that player's config role."""
    role_of = {
        p.account_id: p.role for p in cfg.roster.all_players() if p.account_id
    }
    return {
        acct: patch_mod.scale_games(rows, role_of[acct], adj)
        if acct in role_of
        else rows
        for acct, rows in games.items()
    }


ALL_FACTORS = ("duration", "opponent", "league", "hero")


def _apply_factors(
    cfg: Config,
    corpus: Corpus,
    games: dict[int, list[PlayerGame]],
    ratings: ratings_mod.Ratings,
    adj: patch_mod.PatchAdjustment | None,
    *,
    enabled: set[str] | None = None,
) -> tuple[dict[int, list[PlayerGame]], dict[int, float], list[factors_mod.FactorReport]]:
    """Fit and apply every stat-line correction, and say what each one did.

    Order matters. Duration is removed first because it is the largest and most
    mechanical distortion; the opponent fit then sees stat lines that are
    already on a common yardstick, so its slope measures opposition quality
    rather than the fact that good teams end games faster.
    """
    on = set(ALL_FACTORS) if enabled is None else enabled
    reports: list[factors_mod.FactorReport] = []
    stat_keys = sorted({v for v in STAT_SOURCE.values()})
    flat = [g for rows in games.values() for g in rows]

    # -- 1. duration -------------------------------------------------------
    if "duration" in on and flat:
        elast, diag = factors_mod.fit_duration_elasticity(flat, stat_keys)
        games = {a: factors_mod.normalise_duration(r, elast) for a, r in games.items()}
        flat = [g for rows in games.values() for g in rows]
        top = sorted(diag.items(), key=lambda kv: -abs(kv[1]["elasticity"]))[:4]
        reports.append(
            factors_mod.FactorReport(
                name="duration",
                kind="data",
                enabled=True,
                evidence=f"{len(flat):,} player-games, elasticity fitted per stat",
                detail={
                    "reference_minutes": factors_mod.REFERENCE_MINUTES,
                    "elasticities": diag,
                    "largest": [
                        f"{k} b={v['elasticity']:+.2f} r2={v['r2']:.2f}" for k, v in top
                    ],
                },
            )
        )
    else:
        reports.append(
            factors_mod.FactorReport(
                "duration", "data", False, "disabled; stat lines keep raw game length"
            )
        )

    # -- 2. opponent strength ---------------------------------------------
    field_avg = (
        float(np.mean([ratings.get(t) for t in cfg.roster.names]))
        if cfg.roster.names
        else 0.0
    )
    opp_idx = factors_mod.build_opponent_index(corpus.matches, cfg.roster.all_players())
    opp_rating = {k: ratings.get(v) for k, v in opp_idx.items()}
    if "opponent" in on and opp_rating:
        slope, diag = factors_mod.fit_opponent_slope(flat, opp_rating, stat_keys)
        games = {
            a: factors_mod.normalise_opponent(r, slope, opp_rating, field_avg)
            for a, r in games.items()
        }
        flat = [g for rows in games.values() for g in rows]
        top = sorted(diag.items(), key=lambda kv: -abs(kv[1]["slope"]))[:4]
        reports.append(
            factors_mod.FactorReport(
                name="opponent",
                kind="data",
                enabled=True,
                evidence=f"{len(opp_rating):,} player-games matched to an opponent",
                detail={
                    "reference_rating": field_avg,
                    "slopes": diag,
                    "largest": [f"{k} c={v['slope']:+.3f}" for k, v in top],
                },
            )
        )
    else:
        reports.append(
            factors_mod.FactorReport(
                "opponent", "data", False, "disabled; all opposition treated as equal"
            )
        )

    # -- 3. league strength (a weight, not a correction) -------------------
    weight: dict[int, float] = {}
    match_league = {m.match_id: m.league_id for m in corpus.matches if m.league_id}
    if "league" in on:
        strength = factors_mod.league_strength(corpus.matches, ratings.values)
        lw = factors_mod.league_weights(flat, match_league, strength)
        for mid, w in lw.items():
            weight[mid] = weight.get(mid, 1.0) * w
        ranked = sorted(strength.items(), key=lambda kv: -kv[1])
        names = {m.league_id: m.league_name for m in corpus.matches if m.league_id}
        reports.append(
            factors_mod.FactorReport(
                name="league",
                kind="data",
                enabled=True,
                evidence=f"{len(strength):,} leagues rated by mean participant strength",
                detail={
                    "strongest": [
                        f"{names.get(l, l)} {s:+.2f}" for l, s in ranked[:3]
                    ],
                    "weakest": [f"{names.get(l, l)} {s:+.2f}" for l, s in ranked[-3:]],
                },
            )
        )
    else:
        reports.append(
            factors_mod.FactorReport(
                "league", "data", False, "disabled; every league weighted equally"
            )
        )

    # -- 4. hero pool ------------------------------------------------------
    hero_ids = {g.hero_id for g in flat if g.hero_id}
    viability: dict[int, float] = {}
    if "hero" in on and adj is not None and adj.hero_viability:
        try:
            names = OpenDota().heroes()
            viability = adj.hero_weights_by_id(names)
        except Exception as exc:  # noqa: BLE001 - degrade, never fail the run
            reports.append(
                factors_mod.FactorReport(
                    "hero", "assumption", False, f"hero list unavailable ({exc})"
                )
            )
            viability = {}
    if viability:
        hw = factors_mod.hero_weights(flat, viability)
        for mid, w in hw.items():
            weight[mid] = weight.get(mid, 1.0) * w
        touched = sum(1 for g in flat if g.hero_id in viability)
        by_name = {v: k for k, v in OpenDota().heroes().items()}
        reports.append(
            factors_mod.FactorReport(
                name="hero",
                kind="assumption",
                enabled=True,
                evidence=(
                    f"hero_id on {sum(1 for g in flat if g.hero_id):,}/{len(flat):,} "
                    f"rows ({len(hero_ids)} heroes) is DATA; the "
                    f"{len(adj.hero_viability)} viability magnitudes are ASSUMED "
                    f"from the {adj.version} notes"
                ),
                detail={
                    "games_reweighted": touched,
                    "share_of_corpus": touched / len(flat) if flat else 0.0,
                    "adjustments": adj.hero_viability,
                },
            )
        )
    elif "hero" not in on:
        reports.append(
            factors_mod.FactorReport(
                "hero", "assumption", False, "disabled; hero pool ignored entirely"
            )
        )
    elif adj is None or not adj.hero_viability:
        reports.append(
            factors_mod.FactorReport(
                "hero",
                "absent",
                False,
                "no hero_viability configured in config/patch.yaml",
            )
        )

    # -- things that are simply missing ------------------------------------
    reports.append(
        factors_mod.FactorReport(
            "coach_titles",
            "absent",
            False,
            "config/scoring.yaml coach.titles is empty; a conditional % on the "
            "final score is unmodelled",
        )
    )
    reports.append(
        factors_mod.FactorReport(
            "emblem_inventory",
            "absent",
            False,
            "banners are idealized; emblem quality tiers and traits are parsed "
            "and then ignored",
        )
    )
    return games, weight, reports


def _profile_all(
    cfg: Config,
    games: dict[int, list[PlayerGame]],
    game_weight: dict[int, float] | None = None,
) -> dict[str, PlayerProfile]:
    return {
        p.key: profile_player(
            p,
            games.get(p.account_id or -1, []),
            cfg.scoring,
            game_weight=game_weight,
        )
        for p in cfg.roster.all_players()
    }


def _project_slots(
    cfg: Config,
    games: dict[int, list[PlayerGame]],
    outcome: swiss.SwissOutcome,
    profiles: dict[str, PlayerProfile],
    game_weight: dict[int, float] | None = None,
) -> dict[str, SlotProjection]:
    """One projection per (slot type, team). 16 teams x 3 slots = 48."""
    rng = np.random.default_rng(20260813)
    out: dict[str, SlotProjection] = {}
    for team in cfg.roster.teams:
        samples = outcome.series_samples.get(team.name, [])
        for slot, roles in SLOT_ROLES.items():
            players = [team.by_role(r) for r in roles]
            out[f"{slot}/{team.name}"] = project_slot(
                slot,
                team.name,
                players,
                profiles,
                games,
                cfg.scoring,
                samples,
                rng=rng,
                game_weight=game_weight,
            )
    return out


def save(analysis: Analysis, name: str = "analysis") -> str:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.json"
    blob = {
        "generated_at": utcnow().isoformat(),
        "tournament": analysis.config.tournament.name,
        "warnings": analysis.config.warnings(),
        "ratings": [
            {"team": t, "rating": v, "result_rows": g}
            for t, v, g in analysis.ratings.table()
            if t in set(analysis.config.roster.names)
        ],
        "bucket_probabilities": analysis.outcome.bucket_prob,
        "expected_games": analysis.outcome.expected_games,
        "advance_probability": analysis.outcome.advance_prob,
        "predictions": [
            {
                "bucket": p.bucket_id,
                "label": p.bucket_label,
                "team": p.team,
                "probability": p.probability,
            }
            for p in analysis.predictions.picks
        ],
        "expected_correct_predictions": analysis.predictions.expected_correct,
        "prediction_variants": [
            {
                "rank": i,
                "expected_correct": plan.expected_correct,
                "delta_vs_best": plan.expected_correct
                - analysis.predictions.expected_correct,
                "swaps_vs_best": [
                    {"bucket": label, "from": was, "to": now}
                    for label, was, now in plan.diff_vs(analysis.predictions)
                ],
                "picks": [
                    {"bucket": p.bucket_id, "team": p.team, "probability": p.probability}
                    for p in plan.picks
                ],
            }
            for i, plan in enumerate(analysis.prediction_variants, 1)
        ],
        "patch": (
            {"applied": analysis.patch.active, **analysis.patch.applied()}
            if analysis.patch is not None
            else {"applied": False, "reason": "no config/patch.yaml, or --no-patch"}
        ),
        "fantasy_rosters": [
            {
                "supports": r.support_team,
                "cores": r.core_team,
                "mid": f"{r.mid_player} ({r.mid_team})",
                "projected_total": r.projected_total,
                "breakdown": r.breakdown,
            }
            for r in analysis.rosters
        ],
        "scoring_objective": (
            "banner stats only -> role average -> top 2 games in a series -> best series"
        ),
        "slot_projections": {
            k: {
                "slot": s.slot,
                "team": s.team,
                "players": [p.nick for p in s.players],
                "matches_sampled": s.matches_sampled,
                "mean_game": s.mean_game,
                "sd_game": s.sd_game,
                "projected_best_series": s.projected,
                # The banner that actually scores this slot. Distinct from the
                # per-player banners under "banners" below: a duo shares ONE
                # banner fitted to their combined line, so reading a player's
                # individual banner here gives the wrong three stats.
                "banner": [
                    {
                        "color": c.color,
                        "stat": c.stat.key,
                        "per_game": c.per_game_value,
                        "points": c.base_points,
                    }
                    for c in (
                        s.banner.ordered(analysis.config.scoring.colors)
                        if s.banner
                        else []
                    )
                ],
            }
            for k, s in analysis.slots.items()
        },
        "banners": {
            k: {
                "team": p.player.team,
                "role": p.player.role,
                "games_sampled": p.games_sampled,
                "banner_points_per_game": p.banner_points,
                "emblems": [
                    {
                        "color": c.color,
                        "stat": c.stat.key,
                        "per_game": c.per_game_value,
                        "points": c.base_points,
                    }
                    for c in p.banner.ordered(analysis.config.scoring.colors)
                ],
                "runners_up": {
                    color: [
                        {"stat": r.stat.key, "points": r.base_points}
                        for r in rs
                    ]
                    for color, rs in p.banner.runners_up.items()
                },
            }
            for k, p in analysis.profiles.items()
        },
        "stat_coverage": analysis.corpus.stat_coverage,
    }
    path.write_text(json.dumps(blob, indent=2), encoding="utf-8")
    return str(path)


__all__ = ["Analysis", "Corpus", "analyse", "build_corpus", "save", "CACHE_DIR", "DATA_DIR"]
