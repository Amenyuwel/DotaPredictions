"""The draft: which heroes a player will actually be allowed to play.

Everything else in this project treats a player's hero pool as a fixed property
measured from history. It is not. A hero reaches the game only if the opponent
declines to ban it and declines to take it first, and at a LAN with a live ban phase
that filter is severe and *opponent-specific*. Two things depend on it:

* **Coach Title prefixes.** They key on hero appearance, so a prefix's value is the
  share of games on a tagged hero. If those heroes are contested out of the draft, the
  prefix quietly pays nothing - the one place a fantasy recommendation here rests on
  predicting what gets picked.
* **Stat lines.** Heroes drive stats. A projection that bootstraps a player's past
  games weights his Naga games and his Juggernaut games by how often he played them
  historically, not by how likely he is to get them in this bracket.

The estimate is measured, not assumed. OpenDota returns a full `picks_bans` list for
993 of 997 cached matches, including all 109 at TI 2026, which is 23,832 draft actions.
From those:

    denial[T][h]      share of team T's matches where T banned or picked hero h
    contest[h]        share of all matches where h was picked or banned by anyone
    availability(h)   1 - the denial that this player's expected opponents apply to h

Per-team rates on a single hero are thin, so `denial` is shrunk toward the field's
contest rate with a Beta-binomial prior. Without that, a hero a team happened to ban
once in thirty games reads as a 3.3% denial rate and a hero they banned twice reads as
twice as threatening, which is noise.

Two honest limits. This models *availability*, not the draft as a game: no first-pick
advantage, no counter-picking, no positional flexibility, and no modelling of what a
team does when its preferred hero is gone. And it overlaps with the patch layer's
hand-entered hero viability, which is a different channel (how good a hero is) than
this one (whether you get it) - but a hero nerfed into irrelevance is also one nobody
bothers to ban, so the two are not fully independent.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .sources.base import MatchResult, PlayerGame

# Strength of the shrinkage prior on a team's per-hero denial rate, in pseudo-matches.
PRIOR_MATCHES = 20.0


@dataclass
class DraftAction:
    match_id: int
    hero_id: int
    is_pick: bool
    team_side: int          # 0 = radiant, 1 = dire


@dataclass
class DraftModel:
    """Measured pick/ban behaviour, per team and across the field."""

    matches_seen: int = 0
    actions: int = 0
    # team -> matches in which we saw its draft
    team_matches: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # team -> hero -> matches where that team banned or picked the hero
    team_denials: dict[str, dict[int, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )
    # hero -> matches where anyone picked or banned it
    contested: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    banned: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    picked: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    # -- construction ------------------------------------------------------
    @classmethod
    def build(
        cls,
        matches: list[MatchResult],
        drafts: dict[int, list[DraftAction]],
        *,
        only_match_ids: set[int] | None = None,
    ) -> "DraftModel":
        m = cls()
        by_id = {x.match_id: x for x in matches}
        for match_id, actions in drafts.items():
            if only_match_ids is not None and match_id not in only_match_ids:
                continue
            info = by_id.get(match_id)
            if info is None or not actions:
                continue
            m.matches_seen += 1
            side_team = {0: info.radiant_name, 1: info.dire_name}
            for name in side_team.values():
                if name:
                    m.team_matches[name] += 1
            seen_hero: set[int] = set()
            seen_pair: set[tuple[str, int]] = set()
            for act in actions:
                m.actions += 1
                if act.is_pick:
                    m.picked[act.hero_id] += 1
                else:
                    m.banned[act.hero_id] += 1
                if act.hero_id not in seen_hero:
                    m.contested[act.hero_id] += 1
                    seen_hero.add(act.hero_id)
                name = side_team.get(act.team_side)
                if name and (name, act.hero_id) not in seen_pair:
                    m.team_denials[name][act.hero_id] += 1
                    seen_pair.add((name, act.hero_id))
        return m

    # -- estimates ---------------------------------------------------------
    def denial_rate(self, team: str, hero_id: int) -> float:
        """P(team removes this hero from the pool), shrunk toward the field rate.

        A team's own count on one hero is a handful of observations, so it is blended
        with the rate at which the field contests that hero at all. `prior` is in
        pseudo-matches: at PRIOR_MATCHES=20 a team with 40 matches gets two thirds of
        its own evidence.
        """
        n = self.team_matches.get(team, 0)
        hits = self.team_denials.get(team, {}).get(hero_id, 0)
        base = (
            self.contested.get(hero_id, 0) / self.matches_seen / 2.0
            if self.matches_seen
            else 0.0
        )
        return (hits + PRIOR_MATCHES * base) / (n + PRIOR_MATCHES)

    def availability(self, hero_id: int, opponents: dict[str, float]) -> float:
        """P(this hero survives the draft), against a weighted set of opponents.

        `opponents` maps team name -> share of expected series. A hero is unavailable
        if the opponent bans it or takes it first, so availability is one minus the
        denial the expected field applies.
        """
        total = sum(opponents.values())
        if total <= 0:
            return 1.0
        denial = sum(w * self.denial_rate(t, hero_id) for t, w in opponents.items()) / total
        return max(0.0, 1.0 - denial)

    def game_weights(
        self, games: list[PlayerGame], opponents: dict[str, float]
    ) -> list[float]:
        """Per-game availability weight, aligned with `games`.

        Multiply into the bootstrap weights so a past game on a hero this bracket will
        not allow counts for less than one the player can expect to get again.
        """
        return [
            1.0 if g.hero_id is None else self.availability(int(g.hero_id), opponents)
            for g in games
        ]

    # -- reporting ---------------------------------------------------------
    def most_banned(self, n: int = 10) -> list[tuple[int, float]]:
        if not self.matches_seen:
            return []
        rows = [(h, c / self.matches_seen) for h, c in self.banned.items()]
        rows.sort(key=lambda r: -r[1])
        return rows[:n]


def load_drafts(source, match_ids: list[int]) -> dict[int, list[DraftAction]]:
    """Read `picks_bans` for cached matches. Offline for anything already fetched."""
    out: dict[int, list[DraftAction]] = {}
    for match_id in match_ids:
        try:
            detail = source.match_detail(match_id)
        except Exception:  # noqa: BLE001 - a missing draft shrinks the sample, never fails the run
            continue
        rows = (detail or {}).get("picks_bans") or []
        actions = [
            DraftAction(
                match_id=match_id,
                hero_id=int(r["hero_id"]),
                is_pick=bool(r.get("is_pick")),
                team_side=int(r.get("team", 0)),
            )
            for r in rows
            if r.get("hero_id") is not None
        ]
        if actions:
            out[match_id] = actions
    return out


__all__ = ["PRIOR_MATCHES", "DraftAction", "DraftModel", "load_drafts"]
