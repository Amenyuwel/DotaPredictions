"""Publish an immutable run snapshot to MongoDB.

    python -m scripts.publish --stage main --out ../run.json     # dry run, no DB
    python -m scripts.publish --stage main --mongo-uri "$MONGODB_URI"

This is a serialiser, not a model. Everything it writes comes from
`pipeline.analyse` and the stage simulators; nothing is recomputed, because a
second implementation of a number is a second answer that can disagree with the
first.

What it emits, all scoped to one runId:

    runs              params, data window, and which gates were forced
    teams / players   by id, with also_team_ids folded in
    emblems           the FULL generatable catalog, not one rolled banner
    playerSamples     factor-corrected stat lines, plus the per-game scalars
                      the coach titles need
    stageProjections  sampled series shapes and decider flags -- the scorer
                      needs shapes, not a games total, because a period sums the
                      top two games WITHIN a series and then keeps the best one
    factorAudit       what each factor was worth, including the absent ones

Refuses to write when a freshness gate fails (see `scripts/gates.py`). `--force`
does not silence a gate; it records the gate name on the run document, so a
number that shipped past one stays traceable to the override that allowed it.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

from dota import bracket as bracket_mod
from dota import pipeline
from dota.banner import STAT_SOURCE
from dota.config import CONFIG_DIR, ROOT, Config, Player
from dota.pipeline import SLOT_ROLES, Analysis
from dota.sources.base import PlayerGame
from scripts import gates as gates_mod

SCHEMA_PATH = ROOT.parent / "shared" / "run-schema.json"

# Column order of the games matrix. These are OpenDota field names, which is
# what PlayerGame.stats is keyed by; STAT_SOURCE owns that translation and is
# reused rather than copied.
STAT_COLUMNS: list[str] = sorted(set(STAT_SOURCE.values()))

# A missing measurement is not a zero. NaN travels through Float32 unchanged and
# forces the scorer to decide explicitly, where a 0 would silently deflate a
# projection and look like a real observation.
MISSING_STAT = float("nan")

# Sentinels for the per-game scalars, which are integers and cannot carry NaN.
UNKNOWN_HERO = 0            # hero_id 0 is not a real hero
UNKNOWN_TIME = -(2**31)     # firstBloodTime is legitimately negative, so this
                            # has to sit outside any plausible value

# Below this many JOINT games with the duo partner, the E[max] ceiling is
# truncated by the sample rather than by the player.
#
# Chosen against the observed distribution, not picked round: joint counts on
# this field run 19 to 54 with a median of 44, so a threshold of 60 flags 94% of
# slots and says nothing. 40 is also where the README's worked example sits --
# the 40-game duo whose ceiling is demonstrably cut off.
THIN_SAMPLE = 40


# ---------------------------------------------------------------------------
# encoding
# ---------------------------------------------------------------------------


def b64(array: np.ndarray) -> str:
    """Canonical wire form. The publisher encodes, the server decodes; Mongo
    holds the raw bytes as BSON Binary."""
    return base64.b64encode(array.tobytes()).decode("ascii")


def raw(array: np.ndarray) -> bytes:
    return array.tobytes()


# ---------------------------------------------------------------------------
# run metadata
# ---------------------------------------------------------------------------


def engine_version() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return out.stdout.strip() or "unknown"
    except Exception:  # noqa: BLE001 - a missing git is not a reason to fail
        return "unknown"


def config_hash(tournament_id: str) -> str:
    """Hash of the config that produced this run, so a number traces to inputs."""
    digest = hashlib.sha256()
    for path in sorted(CONFIG_DIR.rglob("*.yaml")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    digest.update(tournament_id.encode())
    return digest.hexdigest()[:16]


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_run_meta(
    cfg: Config,
    analysis: Analysis,
    *,
    run_id: str,
    tournament_id: str,
    stage: str,
    sims: int,
    prior_strength: float,
    gates_forced: list[str],
) -> dict[str, Any]:
    starts = [m.start_time for m in analysis.corpus.matches]
    as_of = max(starts) if starts else datetime.now(timezone.utc)
    return {
        "runId": run_id,
        "tournamentId": tournament_id,
        "stage": stage,
        "schemaVersion": 1,
        "createdAt": iso(datetime.now(timezone.utc)),
        "engineVersion": engine_version(),
        "configHash": config_hash(tournament_id),
        "params": {
            # Two different decays, and the server cannot rebuild the bootstrap
            # weights from one of them. 60 days is fantasy.weighted_stat_means
            # and fantasy.recency_weights; 90 is the Bradley-Terry fit.
            "statHalfLife": 60.0,
            "ratingHalfLife": analysis.ratings.half_life_days,
            "asOf": iso(as_of),
            "l2Prior": prior_strength,
            "patchStrength": (
                analysis.patch.strength if analysis.patch is not None else 0.0
            ),
            "sims": sims,
        },
        "dataWindow": {
            "from": iso(min(starts)) if starts else iso(as_of),
            "to": iso(as_of),
            "matchCount": len(analysis.corpus.matches),
        },
        "gatesForced": gates_forced,
        "isCurrent": True,
    }


# ---------------------------------------------------------------------------
# catalogues
# ---------------------------------------------------------------------------


def build_teams(cfg: Config, tournament_id: str) -> list[dict[str, Any]]:
    out = []
    for team in cfg.roster.teams:
        also = sorted(
            tid for tid, name in cfg.roster.extra_team_ids.items() if name == team.name
        )
        out.append(
            {
                "teamId": int(team.team_id or 0),
                "tournamentId": tournament_id,
                "name": team.name,
                "alsoTeamIds": also,
            }
        )
    return out


FANTASY_ROLE = {
    "carry": "core",
    "offlane": "core",
    "mid": "mid",
    "soft_support": "support",
    "hard_support": "support",
}


def build_players(cfg: Config, tournament_id: str) -> list[dict[str, Any]]:
    return [
        {
            "playerId": int(p.account_id or 0),
            "tournamentId": tournament_id,
            "nick": p.nick,
            "teamId": int(cfg.roster.get(p.team).team_id or 0),
            "fantasyRole": FANTASY_ROLE[p.role],
            "lane": p.role,
        }
        for p in cfg.roster.all_players()
    ]


def build_scoring(cfg: Config) -> dict[str, Any]:
    """The scoring table itself, published rather than reimplemented.

    Without this the server would need its own copy of `scoring.yaml` to turn a
    stat line into points, and two copies of a table drift silently. Base values
    are wildly unequal -- Creep Score pays 3 per unit and Roshan 1,172 -- so a
    raw rate is meaningless until it is multiplied through these numbers.

    Trait adjacency travels too: an emblem's displayed percentage depends on its
    NEIGHBOURS, so the server cannot derive an ordering's value without it.
    """
    traits = {}
    for name, spec in (cfg.scoring.traits or {}).items():
        traits[name] = {
            "bonus": float(spec.get("bonus") or 0.0),
            "adjacentBonus": float(spec.get("adjacent_bonus") or 0.0),
            "condition": spec.get("condition"),
        }
    return {
        "version": cfg.scoring.version,
        "verifiedAgainstClient": cfg.scoring.verified,
        "colors": list(cfg.scoring.colors),
        "stats": {
            key: {
                "perUnit": stat.per_unit,
                "base": stat.base,
                "color": stat.color,
                "measurable": stat.measurable,
                "source": STAT_SOURCE.get(key),
            }
            for key, stat in sorted(cfg.scoring.stats.items())
        },
        "quality": {k: float(v) for k, v in (cfg.scoring.quality or {}).items()},
        "traits": traits,
    }


def build_emblems(cfg: Config, tournament_id: str, stage: str) -> list[dict[str, Any]]:
    """The full generatable catalog: every stat x tier x trait.

    Not the rolled banner in `banners.yaml`, which is one operator's hand. Users
    of a public tool own their own emblems, so the catalog is the space the
    client can produce.

    The displayed multiplier is deliberately absent. It depends on NEIGHBOURS --
    Vampiric charges each adjacent emblem -10%, Benevolent pays each +20% -- so
    it is a property of an arrangement, not of an emblem, and storing it would
    make every ordering score identically.
    """
    out = []
    for stat_key, stat in sorted(cfg.scoring.stats.items()):
        for tier in cfg.scoring.quality:
            for trait in cfg.scoring.traits:
                pretty = stat_key.replace("_", " ").title()
                out.append(
                    {
                        "emblemId": f"{stat_key}:{tier}:{trait}",
                        "tournamentId": tournament_id,
                        "stage": stage,
                        "stat": stat_key,
                        "tier": tier,
                        "trait": trait,
                        "displayName": (
                            f"{pretty} {tier.removeprefix('tier_').upper()} "
                            f"{trait.title()}"
                        ),
                        "measurable": stat.measurable,
                    }
                )
    return out


# ---------------------------------------------------------------------------
# samples
# ---------------------------------------------------------------------------


def partner_of(cfg: Config, player: Player) -> Player | None:
    """The other half of a duo, or None for mid.

    A slot's score is the average of its members IN THE SAME MATCH, so the
    sample that actually backs a core or support projection is the intersection
    of two players' games, not either player's own count.
    """
    slot = FANTASY_ROLE[player.role]
    roles = SLOT_ROLES.get(slot, ())
    if len(roles) < 2:
        return None
    team = cfg.roster.get(player.team)
    other = next((r for r in roles if r != player.role), None)
    return team.by_role(other) if other else None


def sample_warnings(
    cfg: Config, player: Player, games: dict[int, list[PlayerGame]]
) -> list[str]:
    mine = games.get(player.account_id or -1, [])
    partner = partner_of(cfg, player)
    if partner is None:
        n, label = len(mine), "games"
    else:
        theirs = {g.match_id for g in games.get(partner.account_id or -1, [])}
        n = len({g.match_id for g in mine} & theirs)
        label = "joint games"

    if n == 0:
        return [f"n=0 {label}; this slot cannot be projected"]
    if n < THIN_SAMPLE:
        # State the direction. The bootstrap can never draw above the observed
        # maximum, so under an E[max] objective a thin sample truncates the
        # ceiling: biased low, not merely uncertain.
        return [f"n={n} {label}; ceiling likely understated"]
    return []


def build_player_samples(
    cfg: Config, analysis: Analysis, run_id: str
) -> list[dict[str, Any]]:
    out = []
    for p in cfg.roster.all_players():
        rows = sorted(
            analysis.adjusted_games.get(p.account_id or -1, []),
            key=lambda g: g.start_time,
        )
        n = len(rows)
        matrix = np.full((n, len(STAT_COLUMNS)), MISSING_STAT, dtype=np.float32)
        for i, g in enumerate(rows):
            for j, stat in enumerate(STAT_COLUMNS):
                value = g.stats.get(stat)
                if value is not None:
                    matrix[i, j] = value

        out.append(
            {
                "runId": run_id,
                "playerId": int(p.account_id or 0),
                "stats": STAT_COLUMNS,
                "games": matrix,
                "nGames": n,
                # int64, not int32: Dota match ids passed 2**31 in 2023 and a
                # 32-bit column would wrap silently into a different match.
                "matchId": np.array([g.match_id for g in rows], dtype=np.int64),
                "heroId": np.array(
                    [int(g.hero_id or UNKNOWN_HERO) for g in rows], dtype=np.int32
                ),
                "won": np.array([1 if g.won else 0 for g in rows], dtype=np.uint8),
                "durationSeconds": np.array(
                    [int(g.duration_seconds or 0) for g in rows], dtype=np.int32
                ),
                "firstBloodTime": np.array(
                    [
                        UNKNOWN_TIME if g.first_blood_time is None else int(g.first_blood_time)
                        for g in rows
                    ],
                    dtype=np.int32,
                ),
                "startTime": np.array(
                    # int64 for the same reason a timestamp column always should be:
                    # int32 unix seconds die in 2038.
                    [int(g.start_time.timestamp()) for g in rows], dtype=np.int64
                ),
                "gameWeight": np.array(
                    [analysis.game_weight.get(g.match_id, 1.0) for g in rows],
                    dtype=np.float32,
                ),
                "sampleWarnings": sample_warnings(cfg, p, analysis.adjusted_games),
            }
        )
    return out


# ---------------------------------------------------------------------------
# stage projections
# ---------------------------------------------------------------------------


@dataclass
class Shapes:
    """Sampled period structure for one team: games per series, and which
    series went the full distance."""

    series: np.ndarray   # (nShapeSamples, maxSeries) int8, 0-padded
    decider: np.ndarray  # (nShapeSamples, maxSeries) uint8
    expected_series: float
    elimination_risk: float


def pack_shapes(
    samples: list[tuple[int, ...]],
    deciders: list[tuple[bool, ...]] | None,
    *,
    max_series: int,
    best_of: int | None,
) -> Shapes:
    """Pack per-simulation shapes into two rectangular matrices.

    `deciders` is None for a stage whose series are all the same length, where a
    decider is exactly "went the full distance" and is derivable from the game
    count. It must be supplied wherever a Bo5 exists, because a 3-game Bo5 is a
    sweep and a 3-game Bo3 is a decider -- the same number, opposite meaning.
    """
    n = len(samples)
    series = np.zeros((n, max_series), dtype=np.int8)
    decider = np.zeros((n, max_series), dtype=np.uint8)

    for i, shape in enumerate(samples):
        for j, games in enumerate(shape[:max_series]):
            series[i, j] = games
            if deciders is not None:
                flags = deciders[i]
                decider[i, j] = 1 if j < len(flags) and flags[j] else 0
            else:
                assert best_of is not None
                decider[i, j] = 1 if games == best_of else 0

    lengths = np.array([len(s) for s in samples], dtype=float)
    return Shapes(
        series=series,
        decider=decider,
        expected_series=float(lengths.mean()) if n else 0.0,
        # "Gone after two series" is the question a risk view actually asks. In
        # the Swiss every team is guaranteed four, so this is near zero there by
        # construction, which is the correct answer rather than a broken one.
        elimination_risk=float((lengths <= 2).mean()) if n else 0.0,
    )


def build_group_projections(
    cfg: Config, analysis: Analysis, run_id: str
) -> list[dict[str, Any]]:
    outcome = analysis.outcome
    longest = max(
        (len(s) for samples in outcome.series_samples.values() for s in samples),
        default=0,
    )
    out = []
    for team in cfg.roster.teams:
        samples = outcome.series_samples.get(team.name, [])
        over_bo3 = [s for s in samples if any(g > 3 for g in s)]
        if over_bo3:
            raise SystemExit(
                "group stage contains a series longer than Bo3, so decider flags "
                "cannot be derived from the game count. Emit them from swiss.py."
            )
        shapes = pack_shapes(samples, None, max_series=longest, best_of=3)
        out.append(
            {
                "runId": run_id,
                "teamId": int(team.team_id or 0),
                "stage": "group",
                "swiss": {
                    "bucketProbs": dict(outcome.bucket_prob.get(team.name, {})),
                    "advanceProb": outcome.advance_prob.get(team.name, 0.0),
                },
                "seriesSamples": shapes.series,
                "deciderSamples": shapes.decider,
                "nSims": outcome.n_sims,
                "nShapeSamples": len(samples),
                "maxSeries": longest,
                "expectedSeries": shapes.expected_series,
                # A group-stage team is never eliminated early -- the format
                # guarantees four series -- so the risk that matters is failing
                # to advance at all.
                "eliminationRisk": 1.0 - outcome.advance_prob.get(team.name, 0.0),
            }
        )
    return out


def build_main_projections(
    cfg: Config, analysis: Analysis, run_id: str, *, sims: int
) -> list[dict[str, Any]]:
    me = cfg.tournament.main_event
    if me is None or not me.pairings:
        raise SystemExit(
            "config/tournament.yaml has no main_event bracket to simulate. "
            "Publish --stage group until the draw exists."
        )

    b = bracket_mod.simulate(
        me.pairings,
        analysis.ratings.win_prob,
        n_sims=sims,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )
    longest = max(
        (len(s) for samples in b.series_samples.values() for s in samples), default=0
    )

    out = []
    for name in b.teams:
        team = cfg.roster.get(name)
        shapes = pack_shapes(
            b.series_samples.get(name, []),
            b.decider_samples.get(name, []),
            max_series=longest,
            best_of=None,
        )
        out.append(
            {
                "runId": run_id,
                "teamId": int(team.team_id or 0),
                "stage": "main",
                "bracket": {
                    "placementProbs": {
                        "1st": b.champion_prob.get(name, 0.0),
                        "top2": b.grand_final_prob.get(name, 0.0),
                        "top4": b.top4_prob.get(name, 0.0),
                    },
                    "winProb": b.champion_prob.get(name, 0.0),
                },
                "seriesSamples": shapes.series,
                "deciderSamples": shapes.decider,
                "nSims": b.n_sims,
                "nShapeSamples": len(b.series_samples.get(name, [])),
                "maxSeries": longest,
                "expectedSeries": b.expected_series.get(name, 0.0),
                "eliminationRisk": shapes.elimination_risk,
            }
        )
    return out


def build_factor_audit(analysis: Analysis, run_id: str) -> list[dict[str, Any]]:
    """What each factor is, and whether it is doing anything.

    `delta` is null here: measuring it means re-running the pipeline with the
    factor removed, which is `scripts.audit`'s job and costs a full run. An
    unmeasured effect is reported as unmeasured rather than as zero.
    """
    verdict = {"data": "keep", "assumption": "keep", "absent": "missing"}
    return [
        {
            "runId": run_id,
            "factor": r.name,
            "kind": r.kind,
            "delta": None,
            "ciCrossesZero": None,
            "verdict": verdict[r.kind] if r.enabled else "reject",
            "evidence": r.evidence,
        }
        for r in analysis.factor_reports
    ]


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


def to_wire(payload: dict[str, Any]) -> dict[str, Any]:
    """The canonical JSON form: every ndarray becomes base64."""

    def convert(value: Any) -> Any:
        if isinstance(value, np.ndarray):
            return b64(value)
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        if isinstance(value, list):
            return [convert(v) for v in value]
        if isinstance(value, (np.floating, np.integer)):
            return value.item()
        return value

    return convert(payload)


def assert_probabilities(payload: dict[str, Any]) -> None:
    """Distributions must sum to 1. A simulation that lost a team, or double
    counted one, shows up here and nowhere else."""
    problems: list[str] = []

    for p in payload["stageProjections"]:
        buckets = (p.get("swiss") or {}).get("bucketProbs")
        if buckets:
            total = sum(buckets.values())
            if abs(total - 1.0) > 1e-9:
                problems.append(
                    f"team {p['teamId']}: bucket probabilities sum to {total!r}, not 1"
                )

    champions = [
        (p.get("bracket") or {}).get("winProb", 0.0) for p in payload["stageProjections"]
    ]
    if any(c > 0 for c in champions):
        total = sum(champions)
        if abs(total - 1.0) > 1e-9:
            problems.append(f"champion probabilities sum to {total!r}, not 1")

    if problems:
        raise SystemExit("probability check failed:\n  " + "\n  ".join(problems))


def validate(wire: dict[str, Any]) -> None:
    """Validate against the contract both sides share.

    The server validates the same file on read. A mismatch here means the two
    would disagree about what the bytes mean, which is the one failure this
    project refuses to degrade around.
    """
    import jsonschema

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(wire), key=lambda e: list(e.path))
    if errors:
        lines = [
            f"{'/'.join(str(p) for p in e.path) or '/'}: {e.message}" for e in errors[:10]
        ]
        raise SystemExit(
            f"run payload does not match {SCHEMA_PATH.name}:\n  " + "\n  ".join(lines)
        )


# ---------------------------------------------------------------------------
# writing
# ---------------------------------------------------------------------------

COLLECTIONS = (
    "teams",
    "players",
    "emblems",
    "playerSamples",
    "stageProjections",
    "factorAudit",
)


def write_mongo(payload: dict[str, Any], uri: str, db_name: str) -> None:
    from bson.binary import Binary
    from pymongo import ASCENDING, MongoClient

    def bsonify(value: Any) -> Any:
        if isinstance(value, np.ndarray):
            return Binary(raw(value))
        if isinstance(value, dict):
            return {k: bsonify(v) for k, v in value.items()}
        if isinstance(value, list):
            return [bsonify(v) for v in value]
        if isinstance(value, (np.floating, np.integer)):
            return value.item()
        return value

    run = payload["run"]
    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    db = client[db_name]

    db.playerSamples.create_index([("runId", ASCENDING), ("playerId", ASCENDING)], unique=True)
    db.stageProjections.create_index([("runId", ASCENDING), ("teamId", ASCENDING)])
    db.runs.create_index([("tournamentId", ASCENDING), ("stage", ASCENDING), ("isCurrent", ASCENDING)])

    # Order matters more than atomicity here. The data lands first with the run
    # marked current last, so a reader never sees a current run whose samples are
    # still arriving. Two runs briefly current is harmless -- the server takes the
    # newest by createdAt -- while a current run with no data is not.
    for name in COLLECTIONS:
        docs = [bsonify(d) for d in payload[name]]
        if not docs:
            continue
        db[name].delete_many({"runId": run["runId"]}) if "runId" in docs[0] else None
        db[name].insert_many(docs)

    db.runs.insert_one(bsonify({**run, "isCurrent": True}))
    db.runs.update_many(
        {
            "tournamentId": run["tournamentId"],
            "stage": run["stage"],
            "runId": {"$ne": run["runId"]},
        },
        {"$set": {"isCurrent": False}},
    )
    client.close()


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="Publish a run snapshot")
    ap.add_argument("--stage", choices=("group", "main"), default="main")
    ap.add_argument("--tournament-id", default="ti2026")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--group-sims", type=int, default=20000)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--detail-matches", type=int, default=400)
    ap.add_argument("--prior-strength", type=float, default=3.0)
    ap.add_argument("--min-team-games", type=int, default=8)
    ap.add_argument("--min-player-games", type=int, default=5)
    ap.add_argument(
        "--force",
        action="append",
        default=[],
        metavar="GATE",
        help="publish despite this gate failing; the name is recorded on the run",
    )
    ap.add_argument("--out", type=Path, help="write the payload as JSON instead of to Mongo")
    ap.add_argument("--mongo-uri", default="")
    ap.add_argument("--mongo-db", default="dotapredictions")
    args = ap.parse_args()

    load_dotenv()
    cfg = Config()

    analysis = pipeline.analyse(
        cfg,
        n_sims=args.group_sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        prior_strength=args.prior_strength,
        top_rosters=1,
        verbose=True,
    )

    print("\n[gates] checking freshness ...")
    results = gates_mod.run_all(
        cfg,
        analysis,
        min_team_games=args.min_team_games,
        min_player_games=args.min_player_games,
    )
    forced: list[str] = []
    blocking = False
    for gate in results:
        if gate.passed:
            print(f"  ok    {gate.name}")
            continue
        if gate.name in args.force:
            forced.append(gate.name)
            print(f"  FORCED {gate.name} ({len(gate.failures)} failure(s)):")
        else:
            blocking = True
            print(f"  FAIL  {gate.name}:")
        for line in gate.failures:
            print(f"          {line}")

    if blocking:
        print(
            "\nRefusing to publish. Each failure above is a bug that ships as a "
            "confident wrong number rather than an error.\n"
            "Fix it, or re-run with --force <gate> to publish anyway and record it."
        )
        return 1

    run_id = f"{args.tournament_id}-{args.stage}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
    payload: dict[str, Any] = {
        "run": build_run_meta(
            cfg,
            analysis,
            run_id=run_id,
            tournament_id=args.tournament_id,
            stage=args.stage,
            sims=args.sims if args.stage == "main" else args.group_sims,
            prior_strength=args.prior_strength,
            gates_forced=forced,
        ),
        "scoring": build_scoring(cfg),
        "teams": build_teams(cfg, args.tournament_id),
        "players": build_players(cfg, args.tournament_id),
        "emblems": build_emblems(cfg, args.tournament_id, args.stage),
        "playerSamples": build_player_samples(cfg, analysis, run_id),
        "stageProjections": (
            build_main_projections(cfg, analysis, run_id, sims=args.sims)
            if args.stage == "main"
            else build_group_projections(cfg, analysis, run_id)
        ),
        "factorAudit": build_factor_audit(analysis, run_id),
    }

    assert_probabilities(payload)
    wire = to_wire(payload)
    validate(wire)
    print(
        f"[publish] {run_id}: {len(payload['playerSamples'])} player samples, "
        f"{len(payload['stageProjections'])} projections, "
        f"{len(payload['emblems'])} emblems -- schema OK"
    )

    if args.out:
        args.out.write_text(json.dumps(wire, indent=2), encoding="utf-8")
        print(f"[publish] wrote {args.out} (dry run, nothing sent to Mongo)")
        return 0

    uri = args.mongo_uri or ""
    if not uri:
        print("[publish] no --mongo-uri and no --out: nothing written")
        return 1

    write_mongo(payload, uri, args.mongo_db)
    print(f"[publish] {run_id} is now current in {args.mongo_db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
