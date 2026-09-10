"""Map config names onto OpenDota IDs.

Naive nickname lookup is actively dangerous here: OpenDota's `personaname` is
whatever a player last set on Steam, so a global search for "Suma1L" returns
Ammar's account (he uses it as a persona). A wrong account_id does not error --
it silently projects the wrong player's stats.

So resolution is roster-scoped instead:
    team name -> team_id -> /teams/{id}/players (current members only)
    -> match the nickname inside that five-player list
Matching a nick against five teammates is safe; matching it against 5,000 pros
is not. Anything still ambiguous is reported, never guessed.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from datetime import timedelta

from .config import Roster, Team
from .sources import OpenDota, utcnow


def norm(s: str | None) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


@dataclass
class PlayerMatch:
    nick: str
    role: str
    account_id: int | None
    opendota_name: str | None
    confidence: str  # exact | alias | fuzzy | unresolved
    note: str = ""


@dataclass
class TeamMatch:
    config_name: str
    team_id: int | None
    opendota_name: str | None
    players: list[PlayerMatch] = field(default_factory=list)
    roster_extras: list[str] = field(default_factory=list)
    note: str = ""


def build_team_index(od: OpenDota, history_days: int = 240) -> dict[str, tuple[int, str]]:
    """normalised team name -> (team_id, OpenDota's spelling).

    Three sources because none alone is complete: /teams is capped and misses
    newer orgs, proPlayers only covers rostered pros, and proMatches covers
    anyone who played recently.

    Org names get recycled -- "Nigma Galaxy" and "BetBoom Team" each map to
    several team_ids across eras, and the stale one carries a stale roster. So
    candidates are ranked by recency of play and the freshest id wins, rather
    than whichever source happened to be read first.
    """
    # normalised name -> {team_id: (priority, display name)}; higher is fresher
    candidates: dict[str, dict[int, tuple[float, str]]] = {}

    def offer(name: str | None, team_id, priority: float) -> None:
        if not name or not team_id:
            return
        key = norm(name)
        if not key:
            return
        slot = candidates.setdefault(key, {})
        tid = int(team_id)
        if tid not in slot or slot[tid][0] < priority:
            slot[tid] = (priority, name.strip())

    # Priority 0: the /teams dump, which includes long-dead orgs.
    for row in od._teams():
        offer(row.get("name"), row.get("team_id"), 0.0)
        offer(row.get("tag"), row.get("team_id"), -0.5)

    # Priority 1: currently rostered pros.
    for row in od._pro_players():
        offer(row.get("team_name"), row.get("team_id"), 1.0)

    # Priority 2+: actually played recently. Newer match = higher priority.
    since = utcnow() - timedelta(days=history_days)
    for m in od.recent_pro_matches(since, limit=6000):
        recency = 2.0 + m.start_time.timestamp() / 1e12
        offer(m.radiant_name, m.radiant_team_id, recency)
        offer(m.dire_name, m.dire_team_id, recency)

    return {
        key: (tid, slot[tid][1])
        for key, slot in candidates.items()
        if (tid := max(slot, key=lambda t: slot[t][0]))
    }


def _lookup_team(index: dict[str, tuple[int, str]], name: str) -> tuple[int, str] | None:
    key = norm(name)
    if key in index:
        return index[key]
    # "Team Liquid" vs "Liquid", "BetBoom Team" vs "BetBoom"
    stripped = key.removeprefix("team").removesuffix("team")
    if stripped and stripped in index:
        return index[stripped]
    contains = [v for k, v in index.items() if key and (key in k or k in key) and len(k) > 2]
    unique = {v[0] for v in contains}
    if len(unique) == 1:
        return contains[0]
    close = difflib.get_close_matches(key, list(index), n=1, cutoff=0.9)
    if close:
        return index[close[0]]
    return None


def _split_delimited(name: str) -> list[str]:
    for sep in ("-", ".", " "):
        name = name.replace(sep, "_")
    return [p for p in name.split("_") if p]


def _split_camel(name: str) -> list[str]:
    parts: list[str] = []
    current = ""
    for ch in name:
        if ch.isupper() and current:
            parts.append(current)
            current = ch
        elif ch.isalnum():
            current += ch
        elif current:
            parts.append(current)
            current = ""
    if current:
        parts.append(current)
    return parts


def _match_player(nick: str, candidates: list[dict]) -> tuple[dict | None, str, str]:
    """Match one nickname inside a single team's roster."""
    want = norm(nick)
    for c in candidates:
        if norm(c.get("name")) == want:
            return c, "exact", ""

    # Initialism: "ATF" for "AMMAR_THE_F", "KJ" for "KingJungles".
    for c in candidates:
        name = c.get("name") or ""
        for parts in (_split_delimited(name), _split_camel(name)):
            if len(parts) > 1 and norm("".join(p[0] for p in parts)) == want:
                return c, "alias", f"initials of {name}"

    for c in candidates:
        cn = norm(c.get("name"))
        if want and cn and (want in cn or cn in want):
            return c, "alias", f"substring of {c.get('name')}"

    names = {norm(c.get("name")): c for c in candidates if c.get("name")}
    close = difflib.get_close_matches(want, list(names), n=1, cutoff=0.6)
    if close:
        c = names[close[0]]
        return c, "fuzzy", f"closest name on roster: {c.get('name')}"

    return None, "unresolved", ""


def resolve(
    roster: Roster,
    od: OpenDota | None = None,
    overrides: dict | None = None,
    *,
    verbose: bool = True,
) -> list[TeamMatch]:
    od = od or OpenDota()
    overrides = overrides or {}
    ov_players = overrides.get("players") or {}
    ov_teams = overrides.get("teams") or {}

    if verbose:
        print("[resolve] building team index ...")
    index = build_team_index(od)

    out: list[TeamMatch] = []
    for team in roster.teams:
        forced_tid = ov_teams.get(team.name)
        if forced_tid:
            tid = int(forced_tid)
            # Take OpenDota's own spelling, not the config name. The alias map
            # built from this is what folds match rows onto the right team, and
            # the whole reason these are pinned is that the two names differ
            # (BetBoom Team -> BoomBoys). Using the config name here would make
            # the alias a no-op and silently drop every one of that team's games.
            canonical = None
            try:
                canonical = (od._get(f"/teams/{tid}") or {}).get("name")
            except Exception:  # noqa: BLE001
                pass
            if not canonical:
                canonical = next(
                    (n for n, (i, n2) in index.items() if i == tid and (n2 or n)), None
                )
                canonical = index.get(canonical, (None, None))[1] if canonical else None
            canonical = canonical or team.name
            note = f"team_id pinned in config/overrides.yaml (OpenDota: {canonical})"
        else:
            hit = _lookup_team(index, team.name)
            tid, canonical = hit if hit else (None, None)
            note = "" if hit else "team not found on OpenDota"

        tm = TeamMatch(
            config_name=team.name, team_id=tid, opendota_name=canonical, note=note
        )

        members: list[dict] = []
        if tid:
            try:
                rows = od._get(f"/teams/{tid}/players")
                members = [r for r in rows if r.get("is_current_team_member")]  # type: ignore[union-attr]
                if not members:  # org between rosters; fall back to most active
                    members = sorted(
                        rows, key=lambda r: -(r.get("games_played") or 0)  # type: ignore[union-attr]
                    )[:8]
                    tm.note = "no current members flagged; used most-played instead"
            except Exception as exc:  # noqa: BLE001
                tm.note = f"roster fetch failed: {exc}"

        claimed: set[int] = set()
        for p in team.players:
            forced = ov_players.get(p.key)
            if forced:
                tm.players.append(
                    PlayerMatch(p.nick, p.role, int(forced), None, "override",
                                "account_id from config/overrides.yaml")
                )
                claimed.add(int(forced))
                continue

            pool = [c for c in members if int(c["account_id"]) not in claimed]
            hit, confidence, note = _match_player(p.nick, pool)
            if hit is None:
                tm.players.append(PlayerMatch(p.nick, p.role, None, None, "unresolved"))
            else:
                acc = int(hit["account_id"])
                claimed.add(acc)
                tm.players.append(
                    PlayerMatch(p.nick, p.role, acc, hit.get("name"), confidence, note)
                )

        tm.roster_extras = [
            str(c.get("name"))
            for c in members
            if int(c["account_id"]) not in claimed
        ]
        out.append(tm)
    return out


def to_json(matches: list[TeamMatch]) -> dict:
    return {
        "teams": {
            m.config_name: {"team_id": m.team_id, "canonical": m.opendota_name}
            for m in matches
        },
        "players": {
            f"{m.config_name}/{p.nick}": {
                "account_id": p.account_id,
                "canonical": p.opendota_name,
                "confidence": p.confidence,
            }
            for m in matches
            for p in m.players
        },
    }


def problems(matches: list[TeamMatch]) -> tuple[list[str], list[str]]:
    """Returns (blocking, informational).

    Blocking means a projection would be built on the wrong data. Extra roster
    members are informational: a team listing six or seven accounts usually just
    means a coach or stand-in is attached, which is normal and harmless.
    """
    blocking: list[str] = []
    notes: list[str] = []
    seen: dict[int, str] = {}
    for m in matches:
        if m.team_id is None:
            blocking.append(f"TEAM {m.config_name}: {m.note or 'unresolved'}")
        for p in m.players:
            key = f"{m.config_name}/{p.nick}"
            if p.account_id is None:
                blocking.append(f"PLAYER {key}: unresolved")
                continue
            if p.account_id in seen:
                blocking.append(
                    f"PLAYER {key}: account_id {p.account_id} already used by "
                    f"{seen[p.account_id]} - one of the two is wrong"
                )
            seen[p.account_id] = key
            if p.confidence == "fuzzy":
                blocking.append(
                    f"PLAYER {key}: fuzzy match ({p.note}) - confirm and pin it"
                )
        if m.roster_extras:
            notes.append(
                f"TEAM {m.config_name}: OpenDota also lists {m.roster_extras} "
                "(likely coach or stand-in)"
            )
    return blocking, notes
