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

from dota import emblems as emblems_mod
from dota.config import Config
from dota.pipeline import Analysis
from dota.titles import load_hero_tags

# Below this, a stray id is a mis-parse or a single stand-in appearance rather
# than an org playing a season under a second banner.
MIN_ORPHAN_GAMES = 5


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
    min_team_games: int = 8,
    min_player_games: int = 5,
) -> list[GateResult]:
    return [
        resolved_accounts(cfg),
        team_evidence(cfg, analysis, minimum=min_team_games),
        player_evidence(cfg, analysis, minimum=min_player_games),
        orphan_team_ids(cfg, analysis),
        hero_tags_known(analysis),
        scoring_verified(cfg),
        emblem_transcription(cfg),
    ]


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
