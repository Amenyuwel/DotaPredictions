"""Typed access to the YAML config files."""
from __future__ import annotations

import os
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

# Config that belongs to the GAME, not to an event, and is therefore shared by
# every tournament. Hero appearance flags come out of Valve's VPK
# (scripts/extract_hero_adjectives.py); a new International does not change which
# heroes read as "cerulean". Everything else -- rosters, banners, scoring values,
# the bracket, the patch prior -- describes one event and lives under its id.
GLOBAL_CONFIG = frozenset({"hero_adjectives.yaml", "active.yaml"})

# Names the default event. See config/active.yaml for why it is config.
ACTIVE_FILE = "active.yaml"

# Read when no tournament is named. An env var rather than a constant, because a
# hardcoded default is exactly how last year's roster ships against this year's
# event -- the costliest bug this project has produced.
TOURNAMENT_ENV = "DOTA_TOURNAMENT"


def available_tournaments() -> list[str]:
    """Every tournament with a config directory, oldest id first."""
    return sorted(
        d.name for d in CONFIG_DIR.iterdir() if d.is_dir() and (d / "tournament.yaml").is_file()
    )


def active_tournament_id() -> str:
    """Which event the engine is being run for.

    Resolution order, and the last branch is the point of the function: when
    there is more than one tournament configured and nobody said which, this
    RAISES rather than picking. Guessing here would mean fitting one event's
    ratings against another's roster and printing a projection anyway, which is
    the failure mode every gate in this project exists to prevent.
    """
    available = available_tournaments()

    named = os.environ.get(TOURNAMENT_ENV, "").strip()
    if not named:
        named = _active_file_id()
    if named:
        if named not in available:
            raise ValueError(
                f"tournament {named!r} has no config directory "
                f"(named by {TOURNAMENT_ENV} or config/{ACTIVE_FILE}). "
                f"Available: {', '.join(available) or 'none'}. "
                f"Scaffold one with `python -m scripts.new_tournament {named}`."
            )
        return named
    if len(available) == 1:
        return available[0]
    if not available:
        raise ValueError(
            f"no tournament config found under {CONFIG_DIR}. "
            "Scaffold one with `python -m scripts.new_tournament <id>`."
        )
    raise ValueError(
        f"{len(available)} tournaments are configured ({', '.join(available)}) and none "
        f"was named. Set `tournament:` in config/{ACTIVE_FILE}, set {TOURNAMENT_ENV}, "
        "or pass --tournament-id."
    )


def _active_file_id() -> str:
    """The default named in config/active.yaml, or "" when it names none."""
    path = CONFIG_DIR / ACTIVE_FILE
    if not path.is_file():
        return ""
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return str(raw.get("tournament") or "").strip()


def tournament_dir(tournament_id: str | None = None) -> Path:
    """Where one event's config lives."""
    return CONFIG_DIR / (tournament_id or active_tournament_id())


def _parse_utc(value: Any) -> datetime | None:
    """An ISO-8601 timestamp, or None when the field is absent."""
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _load(name: str, tournament_id: str | None = None) -> dict[str, Any]:
    base = CONFIG_DIR if name in GLOBAL_CONFIG else tournament_dir(tournament_id)
    path = base / name
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} is missing. A tournament is not configured until every file "
            "under its directory exists; an absent one is not an empty one."
        )
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    _reject_placeholders(path, raw)
    return raw


def _reject_placeholders(path: Path, raw: Any) -> None:
    """Refuse a scaffold that nobody has filled in.

    `scripts/new_tournament.py` writes TODO where a value belongs, and without
    this the first TODO surfaces wherever it happens to be parsed --
    `Invalid isoformat string: 'TODO'` names neither the file nor the fix. A
    half-filled config is not a config, and it should say so at the point of
    reading rather than somewhere downstream.
    """
    pending: list[str] = []

    def walk(node: Any, trail: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                walk(value, f"{trail}.{key}" if trail else str(key))
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{trail}[{i}]")
        elif isinstance(node, str) and node.strip() == "TODO":
            pending.append(trail)

    walk(raw, "")
    if not pending:
        return
    shown = ", ".join(pending[:5])
    more = f" (+{len(pending) - 5} more)" if len(pending) > 5 else ""
    raise ValueError(
        f"{path.parent.name}/{path.name} is still a scaffold: {len(pending)} value(s) "
        f"left as TODO -- {shown}{more}.\n"
        "Fill them in before running anything against this tournament; a config "
        "half copied from last year is how a stale roster ships as a confident "
        "projection."
    )


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


def _tokens(raw: Any) -> int | None:
    """A period's reroll budget, or None when it is not known.

    The template ships `reroll_tokens: TODO`, which YAML reads as the string
    "TODO" -- so an event onboarded without filling it in must come out as
    unknown rather than crashing a publish or, worse, parsing as some number.
    """
    if raw is None or isinstance(raw, str):
        return None
    return int(raw)


@dataclass
class MainEvent:
    """The drawn Main Event bracket. Absent until the group stage resolves."""

    n_teams: int
    series_format: str
    grand_final_format: str
    banner_slots: int
    # Reroll tokens for this period, or None when the client's number was never
    # transcribed. None is not zero and not "plenty": it means the budget half
    # of a goal's feasibility cannot be answered, and the tool says so.
    reroll_tokens: int | None
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
            banner_slots=int(raw["banner_slots"]),
            reroll_tokens=_tokens(raw.get("reroll_tokens")),
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
    banner_slots: int
    # The group stage's own token budget. See `MainEvent.reroll_tokens`.
    reroll_tokens: int | None
    buckets: list[Bucket]
    fantasy_distinct_teams: bool
    # OpenDota league id -> region, for the qualifiers that fed this event.
    qualifier_leagues: dict[int, str] = field(default_factory=dict)
    main_event: MainEvent | None = None

    @classmethod
    def load(cls, tournament_id: str | None = None) -> "Tournament":
        raw = _load("tournament.yaml", tournament_id)
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
            banner_slots=gs["banner_slots"],
            reroll_tokens=_tokens(gs.get("reroll_tokens")),
            buckets=buckets,
            fantasy_distinct_teams=raw["fantasy"].get("distinct_teams_required", False),
            qualifier_leagues={
                int(k): str(v) for k, v in (raw.get("qualifier_leagues") or {}).items()
            },
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
    # Role -> the colour of each banner slot, at Main Event length. A shorter
    # period takes the first `slots` of the row: the emblems carry over. Empty
    # only for a hand-built Scoring; `slot_colors_for` is the reader.
    slot_colors: dict[str, list[str]] = field(default_factory=dict)

    def slot_colors_for(self, role: str, slots: int) -> list[str]:
        """The colour of each slot for one role, at this period's length.

        Not a preference and not one-of-each: Core is red-green-red-green-red and
        Support has no red slot at all. A role with no row raises rather than
        falling back to a plausible sequence -- guessing here would put a stat on
        a slot that cannot hold it and nothing downstream would notice.
        """
        row = self.slot_colors.get(role)
        if not row:
            raise KeyError(f"no banner_slot_colors row for role {role!r}")
        if slots > len(row):
            raise ValueError(
                f"{role} has {len(row)} slot colours, asked for {slots}"
            )
        return row[:slots]

    @classmethod
    def load(cls, tournament_id: str | None = None) -> "Scoring":
        raw = _load("scoring.yaml", tournament_id)
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
            slot_colors={
                role: list(seq)
                for role, seq in (raw.get("banner_slot_colors") or {}).items()
            },
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
    # WHEN the roster was checked, not just whether. `verified: true` has no
    # shelf life, and a roster is the most perishable thing in this config:
    # squads change between events, stand-ins appear between stages, and orgs
    # disband entirely. A date lets a gate refuse evidence that has aged out
    # instead of trusting a boolean somebody set last season.
    verified_utc: datetime | None = None
    aliases: dict[str, str] = field(default_factory=dict)
    # OpenDota team_id -> our team name, for ids that are the same org under a
    # second banner. `aliases` cannot cover these: it keys on the display name,
    # and two banners can share a name or neither can match ours.
    extra_team_ids: dict[int, str] = field(default_factory=dict)

    @classmethod
    def load(cls, tournament_id: str | None = None) -> "Roster":
        raw = _load("teams.yaml", tournament_id)
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
            verified_utc=_parse_utc(raw.get("verified_utc")),
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
    """One event's configuration, loaded together.

    `tournament_id` comes first and everything else is derived from it, so the
    three files can never describe different events. Construct it bare --
    `Config()` -- and the id resolves from $DOTA_TOURNAMENT, or from the sole
    configured tournament when there is exactly one; with several configured and
    none named, that resolution raises rather than picking.
    """

    tournament_id: str = field(default_factory=active_tournament_id)
    tournament: Tournament = field(init=False)
    scoring: Scoring = field(init=False)
    roster: Roster = field(init=False)

    def __post_init__(self) -> None:
        self.tournament = Tournament.load(self.tournament_id)
        self.scoring = Scoring.load(self.tournament_id)
        self.roster = Roster.load(self.tournament_id)

    @property
    def dir(self) -> Path:
        """This event's config directory. The place to look for banners.yaml,
        patch.yaml and overrides.yaml, none of which Config itself reads."""
        return tournament_dir(self.tournament_id)

    def warnings(self) -> list[str]:
        out = []
        if not self.scoring.verified:
            out.append(
                "%s/scoring.yaml is NOT verified against the client "
                % self.dir.name +
                "(version=%s)." % self.scoring.version
            )
        if not self.roster.verified:
            out.append(
                "%s/teams.yaml is NOT verified (source: %%s). Confirm the 16 " % self.dir.name +
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
