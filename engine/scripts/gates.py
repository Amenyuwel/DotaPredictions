"""Reasons to refuse to publish.

Every check here guards a failure that produces a *confident wrong number* and
no error. That is this project's whole failure mode: a bad `account_id`, a
stale org id or an unverified scoring table does not raise, it just quietly
projects the wrong thing. So freshness is not a maintenance chore, it is a
correctness gate, and the publisher's default answer to a failed one is to
write nothing at all.

The costliest instance on record: a team configured under a dead org id, whose
sixteen games at the event landed on a name the model had never heard of. It
was rated on no evidence and still printed a projection, and fixing it moved
that team from the weakest in the field to the third strongest. `min_team_games`
is that bug expressed as a gate.

Each gate returns a list of human-readable failures. Empty means it passed.
`--force` records the gate name on the run document rather than silencing it:
a number that shipped past a gate stays traceable to the override that let it.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from dota import emblems as emblems_mod
from dota.config import Config
from dota.pipeline import Analysis
from dota.titles import load_hero_tags

# Below this, a stray id is a mis-parse or a single stand-in appearance rather
# than an org playing a season under a second banner.
MIN_ORPHAN_GAMES = 5

# How old a roster check may be before it stops being evidence.
#
# Not a round number for its own sake: TI 2026's field was cross-checked on
# 2026-07-31 for a 2026-08-13 lock, thirteen days. Three weeks allows that
# working pattern and still refuses a roster carried over from the previous
# event, which is the case this exists for -- squads change in the off-season,
# stand-ins appear between stages, and orgs disband outright.
MAX_ROSTER_AGE_DAYS = 21

# A team that has not played in this long is not a team you have evidence about.
# Long enough to survive a normal gap between an event and its qualifiers;
# short enough that an org which quietly folded after the last International
# cannot be projected as though it still exists.
MAX_TEAM_IDLE_DAYS = 60


@dataclass
class GateResult:
    name: str
    failures: list[str]

    @property
    def passed(self) -> bool:
        return not self.failures


def run_all(
    cfg: Config,
    analysis: Analysis,
    *,
    stage: str = "group",
    min_team_games: int = 8,
    min_player_games: int = 5,
    max_roster_age_days: int = MAX_ROSTER_AGE_DAYS,
    max_team_idle_days: int = MAX_TEAM_IDLE_DAYS,
    now: datetime | None = None,
) -> list[GateResult]:
    now = now or datetime.now(timezone.utc)
    return [
        stage_ready(cfg, stage),
        roster_freshness(cfg, stage, max_age_days=max_roster_age_days, now=now),
        team_activity(cfg, analysis, max_idle_days=max_team_idle_days, now=now),
        patch_consistency(cfg, analysis),
        resolved_accounts(cfg),
        team_evidence(cfg, analysis, minimum=min_team_games),
        player_evidence(cfg, analysis, minimum=min_player_games),
        orphan_team_ids(cfg, analysis),
        hero_tags_known(analysis),
        scoring_verified(cfg),
        emblem_transcription(cfg),
    ]


# ---------------------------------------------------------------------------
# when a stage may be published at all
# ---------------------------------------------------------------------------


def stage_ready(cfg: Config, stage: str) -> GateResult:
    """Refuse a stage whose field is not settled yet.

    A tournament becomes knowable in steps, and each step is the moment to go
    and fetch: the group-stage field exists once the qualifiers finish, the Main
    Event field exists only once the group stage has been played. Publishing
    ahead of either does not fail -- it fits ratings against a field nobody has
    decided yet and prints a projection, which is the shape of every bug this
    file guards.

    Readiness is INFERRED from the config rather than declared by a `phase:`
    field. A declared phase and the data it describes are two copies of one
    fact, and this project's rule is that two copies drift silently. Here the
    bracket either has pairings or it does not.
    """
    failures: list[str] = []
    roster = cfg.roster
    expected = cfg.tournament.n_teams

    if len(roster.teams) != expected:
        failures.append(
            f"the group-stage field is {len(roster.teams)} teams, expected "
            f"{expected}. Wait for the qualifiers to finish, then run "
            f"scripts.discover_rosters"
        )
    if not roster.verified:
        failures.append(
            f"{cfg.dir.name}/teams.yaml has verified: false. The field is not "
            f"confirmed, so nothing computed from it is either"
        )

    if stage == "main":
        me = cfg.tournament.main_event
        if me is None or not me.pairings:
            failures.append(
                "the Main Event bracket has no pairings. It is drawn only after the "
                "group stage resolves -- publish --stage group until then"
            )
        else:
            known = set(roster.names)
            unknown = sorted({t for t in me.teams if t not in known})
            if unknown:
                failures.append(
                    "the bracket names teams the roster does not have: "
                    + ", ".join(unknown)
                    + ". Re-fetch the roster; the survivors are the field now"
                )
            if len(me.teams) != me.n_teams:
                failures.append(
                    f"the bracket lists {len(me.teams)} teams, expected {me.n_teams}"
                )
    return GateResult("stage_ready", failures)


def roster_freshness(
    cfg: Config, stage: str, *, max_age_days: int, now: datetime
) -> GateResult:
    """A roster check has a shelf life, and the Main Event resets it.

    `verified: true` says somebody looked; it does not say when. Between the end
    of one International and the start of the next, squads change, players
    retire and orgs disband -- so evidence of a roster ages out, and this gate is
    the difference between "we checked" and "we checked recently enough".

    The Main Event clause is the stronger half. Eight of sixteen teams are gone
    by then and the survivors may have swapped a player or brought in a stand-in
    mid-event, so a roster last confirmed before the group stage began is not
    evidence about the field that is actually left.
    """
    roster = cfg.roster
    failures: list[str] = []

    if roster.verified_utc is None:
        return GateResult(
            "roster_freshness",
            [
                f"{cfg.dir.name}/teams.yaml has no verified_utc. Add the date the "
                f"roster was actually checked -- a boolean with no date cannot age out"
            ],
        )

    age = (now - roster.verified_utc).days
    if age > max_age_days:
        failures.append(
            f"the roster was last checked {age} days ago "
            f"({roster.verified_utc:%Y-%m-%d}), limit {max_age_days}. Re-run "
            f"scripts.discover_rosters and scripts.resolve_ids"
        )

    if stage == "main":
        group_lock = cfg.tournament.lock_utc
        if group_lock and roster.verified_utc < group_lock:
            failures.append(
                f"the roster was checked {roster.verified_utc:%Y-%m-%d}, before the "
                f"group stage locked ({group_lock:%Y-%m-%d}). The Main Event field is "
                f"the eight survivors, and stand-ins appear between stages -- re-fetch "
                f"the roster now that the bracket is drawn"
            )
    return GateResult("roster_freshness", failures)


def team_activity(
    cfg: Config, analysis: Analysis, *, max_idle_days: int, now: datetime
) -> GateResult:
    """Every configured team must have played recently enough to be real.

    `team_evidence` counts result rows anywhere in the history window, so an org
    that folded three months ago still passes on its old games. This gate asks a
    different question -- is this team still playing? -- and it is the one that
    catches a disbanded org carried into the next event's config, which the
    ratings fit would otherwise happily rate on last season's results.
    """
    last_seen: dict[str, datetime] = {}
    for match in analysis.corpus.matches:
        for name in (match.radiant_name, match.dire_name):
            if not name:
                continue
            team = cfg.roster.aliases.get(name, name)
            seen = last_seen.get(team)
            if seen is None or match.start_time > seen:
                last_seen[team] = match.start_time

    failures = []
    for team in cfg.roster.names:
        seen = last_seen.get(team)
        if seen is None:
            failures.append(
                f"{team}: no match in the sampled window carries this name. "
                f"Disbanded, renamed, or the alias is missing from overrides.yaml"
            )
            continue
        idle = (now - seen).days
        if idle > max_idle_days:
            failures.append(
                f"{team}: last played {idle} days ago ({seen:%Y-%m-%d}), limit "
                f"{max_idle_days}. A team that stopped playing is not a team this "
                f"model has evidence about"
            )
    return GateResult("team_activity", failures)


def patch_consistency(cfg: Config, analysis: Analysis) -> GateResult:
    """The configured patch must be the one the evidence straddles.

    An empty `patch.yaml` is not a failure -- claiming a team got stronger from a
    patch with no post-patch results is worse than claiming nothing, and the
    README says so. What IS a failure is a patch prior that does not line up with
    the games it corrects:

    * released BEFORE every sampled match, so the corpus already reflects it and
      the correction counts a change that is already in the data twice;
    * released AFTER every sampled match, so the prior projects onto games with
      no post-patch evidence behind it at all;
    * undated, so nobody can tell which of those two it is.

    All three produce adjusted stat lines that look exactly like correct ones.
    """
    patch = analysis.patch
    if patch is None or not patch.active:
        return GateResult("patch_consistency", [])

    failures: list[str] = []
    starts = [m.start_time for m in analysis.corpus.matches]
    if not starts:
        return GateResult("patch_consistency", [])
    first, last = min(starts), max(starts)

    if not patch.released_utc:
        return GateResult(
            "patch_consistency",
            [
                f"patch {patch.version or '(unnamed)'} has no released_utc, so there "
                f"is no way to tell which sampled games were played under it"
            ],
        )

    released = datetime.fromisoformat(patch.released_utc.replace("Z", "+00:00"))
    if released < first:
        failures.append(
            f"patch {patch.version} was released {released:%Y-%m-%d}, before the "
            f"earliest sampled match ({first:%Y-%m-%d}). Every game already reflects "
            f"it, so applying the correction on top counts the change twice -- clear "
            f"the multipliers, or widen --history-days"
        )
    elif released > last + timedelta(days=1):
        failures.append(
            f"patch {patch.version} was released {released:%Y-%m-%d}, after the most "
            f"recent sampled match ({last:%Y-%m-%d}). The prior is projecting onto "
            f"games with no post-patch evidence at all"
        )
    return GateResult("patch_consistency", failures)


def resolved_accounts(cfg: Config) -> GateResult:
    """Every player has an id, and no two players share one.

    A duplicate is the more dangerous half: it means one player's stat lines are
    being scored under two names, and both slots look populated.
    """
    failures: list[str] = []
    seen: dict[int, str] = {}
    for p in cfg.roster.all_players():
        if p.account_id is None:
            failures.append(f"{p.key}: unresolved account_id -- run scripts.resolve_ids")
            continue
        if p.account_id in seen:
            failures.append(
                f"{p.key}: account_id {p.account_id} already used by {seen[p.account_id]} "
                f"-- one of the two is wrong"
            )
        seen[p.account_id] = p.key
    return GateResult("resolved_accounts", failures)


def team_evidence(cfg: Config, analysis: Analysis, *, minimum: int) -> GateResult:
    """No team may be rated on nothing.

    `Ratings.evidence` counts the result rows the fit actually saw for a team.
    A team whose org id is wrong scores zero here while still receiving a
    rating -- the shrinkage prior hands it the field average and the report
    prints it like any other number.
    """
    failures = []
    for team in cfg.roster.names:
        n = analysis.ratings.evidence(team)
        if n < minimum:
            failures.append(
                f"{team}: the rating fit saw {n} result rows (minimum {minimum}). "
                f"Check the pinned team_id and also_team_ids in config/"
            )
    return GateResult("team_evidence", failures)


def player_evidence(cfg: Config, analysis: Analysis, *, minimum: int) -> GateResult:
    """A player with almost no sampled games is usually a roster change."""
    failures = []
    for p in cfg.roster.all_players():
        rows = analysis.adjusted_games.get(p.account_id or -1, [])
        if len(rows) < minimum:
            failures.append(
                f"{p.key}: {len(rows)} sampled games (minimum {minimum}). "
                f"Benched, a stand-in, or the wrong account_id"
            )
    return GateResult("player_evidence", failures)


def orphan_team_ids(cfg: Config, analysis: Analysis) -> GateResult:
    """Games a player played under a team id the config does not know about.

    This is the Iron Wing sweep, computed rather than remembered. For each of a
    player's sampled matches, at least one side should carry their team's
    configured id. When neither does, the org was playing under a second banner
    and those games are attached to a team the model has never heard of.

    Reported as candidates for `also_team_ids`, keyed by how often they appear,
    because one stray match is a mis-parse and thirty is a second org id.
    """
    by_match = {m.match_id: m for m in analysis.corpus.matches}
    known: dict[str, set[int]] = {}
    for team in cfg.roster.teams:
        ids = {team.team_id} if team.team_id else set()
        ids |= {tid for tid, name in cfg.roster.extra_team_ids.items() if name == team.name}
        known[team.name] = {i for i in ids if i}

    orphans: dict[str, Counter] = defaultdict(Counter)
    for p in cfg.roster.all_players():
        mine = known.get(p.team) or set()
        if not mine:
            continue
        for g in analysis.adjusted_games.get(p.account_id or -1, []):
            m = by_match.get(g.match_id)
            if m is None:
                continue
            sides = {m.radiant_team_id, m.dire_team_id} - {None}
            if sides & mine:
                continue
            # Both sides are recorded because PlayerGame does not say which one
            # the player was on. The filtering below is what separates "our org
            # under a second id" from "the team we were playing".
            for tid in sides:
                orphans[p.team][tid] += 1

    # An id pinned to some other team in this tournament is an OPPONENT, not a
    # second banner. Without this the gate reports BetBoom's id as a candidate
    # alias for PARIVISION, and a gate that cries wolf just teaches you to pass
    # --force.
    pinned_elsewhere: set[int] = set()
    for ids in known.values():
        pinned_elsewhere |= ids

    # An id seen under several different teams is a shared opponent or a
    # qualifier-side entry, not one org's alias -- an org plays under its own
    # banner, not under three teams' at once.
    seen_by_teams: Counter = Counter()
    for counts in orphans.values():
        for tid in counts:
            seen_by_teams[tid] += 1

    failures = []
    for team, counts in sorted(orphans.items()):
        for tid, n in counts.most_common():
            if tid in pinned_elsewhere or seen_by_teams[tid] > 1 or n < MIN_ORPHAN_GAMES:
                continue
            failures.append(
                f"{team}: {n} sampled games carry team_id {tid}, which is pinned to "
                f"no team in this tournament. If it is the same org under another "
                f"banner, add it to also_team_ids in config/teams.yaml"
            )
    return GateResult("orphan_team_ids", failures)


def hero_tags_known(analysis: Analysis) -> GateResult:
    """Every played hero must exist in the appearance-tag table.

    `titles.prefix_multiplier` returns 1.0 for a hero it cannot find, which is
    the right default and an invisible failure: after Valve ships a hero, every
    coach prefix quietly pays less on games played on it. Regenerate the table
    with scripts.extract_hero_adjectives, which needs Dota installed -- hence a
    gate here rather than a lookup at publish time.
    """
    tags = load_hero_tags()
    seen = Counter(
        int(g.hero_id)
        for rows in analysis.adjusted_games.values()
        for g in rows
        if g.hero_id
    )
    missing = {hid: n for hid, n in seen.items() if hid not in tags}
    if not missing:
        return GateResult("hero_tags_known", [])
    listed = ", ".join(f"{hid} ({n} games)" for hid, n in sorted(missing.items())[:8])
    return GateResult(
        "hero_tags_known",
        [
            f"{len(missing)} hero id(s) in the samples are absent from "
            f"config/hero_adjectives.yaml: {listed}. Coach prefixes pay nothing on "
            f"those games. Re-run scripts.extract_hero_adjectives"
        ],
    )


def scoring_verified(cfg: Config) -> GateResult:
    """A scoring table copied forward from last year must not ship unchecked."""
    if cfg.scoring.verified:
        return GateResult("scoring_verified", [])
    return GateResult(
        "scoring_verified",
        [
            f"config/scoring.yaml (version {cfg.scoring.version}) has "
            f"verified_against_client: false. Check it against the client's HOW TO "
            f"PLAY and docs/ti2026-how-to-play.md before publishing"
        ],
    )


def emblem_transcription(cfg: Config) -> GateResult:
    """The rolled banner's percentages must agree with the derived ones.

    `banners.yaml` is a screenshot read by a human, and every projection is
    scaled by those multipliers. Deriving them from tier + trait + neighbours
    and demanding agreement catches both a mis-transcription and a wrong model
    of the trait rules.
    """
    failures = []
    for slot, banner in emblems_mod.load().items():
        for problem in emblems_mod.check_against_client(banner, cfg.scoring):
            failures.append(f"{slot}: {problem}")
    return GateResult("emblem_transcription", failures)
