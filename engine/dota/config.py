"""Typed access to the YAML config files."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
OUT_DIR = ROOT / "out"

ROLES = ("carry", "mid", "offlane", "soft_support", "hard_support")
CORE_DUO_ROLES = ("carry", "offlane")
SUPPORT_DUO_ROLES = ("soft_support", "hard_support")


def _load(name: str) -> dict[str, Any]:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@dataclass(frozen=True)
class Player:
    nick: str
    role: str
    team: str
    account_id: int | None = None

    @property
    def key(self) -> str:
        return f"{self.team}/{self.nick}"


@dataclass
class Team:
    name: str
    players: list[Player]
    team_id: int | None = None

    def by_role(self, role: str) -> Player:
        for p in self.players:
            if p.role == role:
                return p
        raise KeyError(f"{self.name} has no player in role {role!r}")


@dataclass
class Bucket:
    id: str
    label: str
    count: int
    points: float


@dataclass
class MainEvent:
    """The drawn Main Event bracket. Absent until the group stage resolves."""

    n_teams: int
    series_format: str
    grand_final_format: str
    pairings: list[tuple[str, str]]
    eliminated: list[str]
    lock_utc: datetime | None = None
    # The bracket already filled in inside the client, node -> picked winner.
    # Kept in config so a run can score what was actually submitted rather than
    # only the bracket the model would have submitted.
    my_picks: dict[str, str] = field(default_factory=dict)
    # OpenDota league the event itself is played under. Lets a run be fitted on
    # this tournament's own results instead of six months of everything.
    league_id: int | None = None

    @property
    def teams(self) -> list[str]:
        return [t for pair in self.pairings for t in pair]

    @property
    def best_of(self) -> int:
        return int(self.series_format.lower().removeprefix("bo"))

    @property
    def final_best_of(self) -> int:
        return int(self.grand_final_format.lower().removeprefix("bo"))

    @classmethod
    def from_raw(cls, raw: dict[str, Any] | None) -> "MainEvent | None":
        if not raw:
            return None
        pairs = [tuple(p) for p in raw.get("upper_bracket_round_1") or []]
        lock = raw.get("lock_utc")
        return cls(
            n_teams=int(raw.get("teams", 8)),
            series_format=str(raw.get("series_format", "bo3")),
            grand_final_format=str(raw.get("grand_final_format", "bo5")),
            pairings=pairs,  # type: ignore[arg-type]
            eliminated=list(raw.get("eliminated") or []),
            my_picks=dict(raw.get("my_picks") or {}),
            league_id=raw.get("league_id"),
            lock_utc=(
                datetime.fromisoformat(lock.replace("Z", "+00:00")) if lock else None
            ),
        )


@dataclass
class Tournament:
    name: str
    lock_utc: datetime
    rounds: int
    n_teams: int
    direct_advance: int
    elimination_round_slots: int
    buckets: list[Bucket]
    fantasy_distinct_teams: bool
    main_event: MainEvent | None = None

    @classmethod
    def load(cls) -> "Tournament":
        raw = _load("tournament.yaml")
        gs = raw["group_stage"]
        buckets = [Bucket(**b) for b in raw["prediction_buckets"]]
        total = sum(b.count for b in buckets)
        if total != gs["teams"]:
            raise ValueError(
                f"prediction_buckets counts sum to {total}, expected {gs['teams']}"
            )
        return cls(
            name=raw["name"],
            lock_utc=datetime.fromisoformat(raw["lock_utc"].replace("Z", "+00:00")),
            rounds=gs["rounds"],
            n_teams=gs["teams"],
            direct_advance=gs["direct_advance"],
            elimination_round_slots=gs["elimination_round_slots"],
            buckets=buckets,
            fantasy_distinct_teams=raw["fantasy"].get("distinct_teams_required", False),
            main_event=MainEvent.from_raw(raw.get("main_event")),
        )


@dataclass
class Stat:
    """One scorable stat: what it pays, and which emblem colour carries it."""

    key: str
    per_unit: float
    color: str
    base: float = 0.0
    measurable: bool = True

    def points(self, per_game_value: float) -> float:
        return self.base + self.per_unit * per_game_value


@dataclass
class Scoring:
    stats: dict[str, Stat]
    quality: dict[str, float]
    traits: dict[str, dict[str, Any]]
    colors: list[str]
    coach_titles: dict[str, Any]
    verified: bool
    version: str
    # Which prefix/suffix pair is actually equipped in the client. Titles are free
    # to change, so this is a choice to be re-checked, not a constant. Defaulted so
    # a hand-built Scoring (tests, ad-hoc scripts) needs no coach block.
    coach_equipped: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls) -> "Scoring":
        raw = _load("scoring.yaml")
        unmeasurable = set(raw.get("unmeasurable") or [])
        stats = {
            k: Stat(
                key=k,
                per_unit=float(v["per_unit"]),
                color=str(v["color"]),
                base=float(v.get("base", 0.0)),
                measurable=k not in unmeasurable,
            )
            for k, v in raw["stats"].items()
        }
        return cls(
            stats=stats,
            quality={k: float(v) for k, v in (raw.get("emblem_quality") or {}).items()},
            traits=raw.get("emblem_traits") or {},
            colors=list(raw.get("banner_colors") or ["red", "blue", "green"]),
            coach_titles=(raw.get("coach") or {}).get("titles") or {},
            coach_equipped=(raw.get("coach") or {}).get("equipped") or {},
            verified=bool(raw.get("verified_against_client", False)),
            version=str(raw.get("version", "unknown")),
        )

    def by_color(self, color: str, measurable_only: bool = True) -> list[Stat]:
        return [
            s
            for s in self.stats.values()
            if s.color == color and (s.measurable or not measurable_only)
        ]


@dataclass
class Roster:
    teams: list[Team]
    verified: bool = False
    source: str = ""
    aliases: dict[str, str] = field(default_factory=dict)
    # OpenDota team_id -> our team name, for ids that are the same org under a
    # second banner. `aliases` cannot cover these: it keys on the display name,
    # and two banners can share a name or neither can match ours.
    extra_team_ids: dict[int, str] = field(default_factory=dict)

    @classmethod
    def load(cls) -> "Roster":
        raw = _load("teams.yaml")
        # IDs resolved by scripts/resolve_ids.py live outside the YAML so the
        # hand-maintained config keeps its comments and stays diffable.
        resolved = {}
        resolved_path = DATA_DIR / "resolved_ids.json"
        if resolved_path.exists():
            import json

            resolved = json.loads(resolved_path.read_text(encoding="utf-8"))
        r_players = resolved.get("players", {})
        r_teams = resolved.get("teams", {})

        teams = []
        for t in raw["teams"]:
            players = [
                Player(
                    nick=p["nick"],
                    role=p["role"],
                    team=t["name"],
                    account_id=p.get("account_id")
                    or (r_players.get(f"{t['name']}/{p['nick']}") or {}).get("account_id"),
                )
                for p in t["players"]
            ]
            got = {p.role for p in players}
            missing = set(ROLES) - got
            if missing:
                raise ValueError(f"{t['name']} missing roles: {sorted(missing)}")
            teams.append(
                Team(
                    name=t["name"],
                    players=players,
                    team_id=t.get("team_id")
                    or (r_teams.get(t["name"]) or {}).get("team_id"),
                )
            )
        return cls(
            teams=teams,
            verified=bool(raw.get("verified", False)),
            source=str(raw.get("source", "")),
            extra_team_ids={
                int(k): str(v) for k, v in (raw.get("also_team_ids") or {}).items()
            },
            # OpenDota's spelling -> our config spelling, so match rows fold
            # onto the right team when the two disagree.
            aliases={
                v["canonical"]: k
                for k, v in r_teams.items()
                if v.get("canonical") and v["canonical"] != k
            },
        )

    @property
    def names(self) -> list[str]:
        return [t.name for t in self.teams]

    def get(self, name: str) -> Team:
        for t in self.teams:
            if t.name == name:
                return t
        raise KeyError(name)

    def all_players(self) -> list[Player]:
        return [p for t in self.teams for p in t.players]


@dataclass
class Config:
    tournament: Tournament = field(default_factory=Tournament.load)
    scoring: Scoring = field(default_factory=Scoring.load)
    roster: Roster = field(default_factory=Roster.load)

    def warnings(self) -> list[str]:
        out = []
        if not self.scoring.verified:
            out.append(
                "config/scoring.yaml is NOT verified against the client "
                "(version=%s)." % self.scoring.version
            )
        if not self.roster.verified:
            out.append(
                "config/teams.yaml is NOT verified (source: %s). Confirm the 16 "
                "teams and their role assignments before locking picks."
                % (self.roster.source or "unknown")
            )
        blind = sorted(k for k, s in self.scoring.stats.items() if not s.measurable)
        if blind:
            out.append(
                "Not measurable from match data, so excluded from emblem choice "
                "rather than scored as zero: " + ", ".join(blind)
            )
        if not self.scoring.coach_titles:
            out.append(
                "No Coach Titles configured. They are free to change and apply a "
                "conditional % to the final score - fill config/scoring.yaml -> "
                "coach.titles with what the client offers you."
            )
        return out
