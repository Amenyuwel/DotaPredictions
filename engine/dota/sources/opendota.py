"""OpenDota adapter.

Free and keyless (an OPENDOTA_API_KEY raises the rate limit if you have one).
Pro-league matches are fully parsed on OpenDota, so every stat the fantasy
config scores -- including `stuns`, `camps_stacked` and
`teamfight_participation` -- is available from `/matches/{id}`.

Cost note: one request per match detail returns all ten player lines, so we
harvest by match, not by player.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Callable

import requests

from .. import cache
from .base import MatchResult, PlayerGame, utcnow

BASE = "https://api.opendota.com/api"

# Field name on OpenDota -> canonical stat key in config/scoring.yaml
FIELD_MAP = {
    "kills": "kills",
    "deaths": "deaths",
    "gold_per_min": "gold_per_min",
    "xp_per_min": "xp_per_min",
    "stuns": "seconds_stunned",
    "towers_killed": "tower_kills",
    "roshans_killed": "roshan_kills",
    "teamfight_participation": "teamfight_participation",
    "obs_placed": "observer_wards_planted",
    "sen_placed": "sentry_wards_planted",
    "camps_stacked": "camps_stacked",
    "rune_pickups": "rune_pickups",
    "firstblood_claimed": "first_blood",
}


class OpenDota:
    name = "opendota"

    def __init__(
        self,
        min_interval: float = 1.25,
        ttl: int = 6 * 3600,
        max_retries: int = 5,
    ):
        self.api_key = os.environ.get("OPENDOTA_API_KEY")
        # Keyless free tier is nominally 60/min, but the limiter is bursty and
        # 1.0s spacing still draws 429s. 1.25s costs a couple of minutes on the
        # first run and holds up over a full fetch.
        self.min_interval = 0.35 if self.api_key else min_interval
        self.ttl = ttl
        self.max_retries = max_retries
        self._last_call = 0.0
        self._session = requests.Session()
        self._session.headers["User-Agent"] = "DotaPredictions/0.1"

    def available(self) -> bool:
        return True

    # -- plumbing --------------------------------------------------------
    def _get(
        self, path: str, ttl: "int | Callable[[object], int] | None" = None, **params
    ) -> object:
        def fetch():
            q = dict(params)
            if self.api_key:
                q["api_key"] = self.api_key

            last_error: Exception | None = None
            for attempt in range(self.max_retries):
                wait = self.min_interval - (time.monotonic() - self._last_call)
                if wait > 0:
                    time.sleep(wait)
                try:
                    resp = self._session.get(f"{BASE}{path}", params=q, timeout=60)
                    self._last_call = time.monotonic()
                    # A dropped match is not a loud failure -- it just quietly
                    # shrinks the sample a projection is built on, so back off
                    # and retry rather than accept the hole.
                    if resp.status_code == 429 or resp.status_code >= 500:
                        retry_after = resp.headers.get("Retry-After")
                        delay = (
                            float(retry_after)
                            if retry_after and retry_after.isdigit()
                            else 2.0 * (2**attempt)
                        )
                        time.sleep(min(delay, 60.0))
                        last_error = requests.HTTPError(
                            f"{resp.status_code} from {path}", response=resp
                        )
                        continue
                    resp.raise_for_status()
                    return resp.json()
                except requests.RequestException as exc:
                    self._last_call = time.monotonic()
                    last_error = exc
                    time.sleep(min(2.0 * (2**attempt), 60.0))

            raise last_error or RuntimeError(f"failed to fetch {path}")

        key = path + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        return cache.get_or_fetch(
            "opendota", key, fetch, ttl_seconds=self.ttl if ttl is None else ttl
        )

    # -- resolution ------------------------------------------------------
    def _pro_players(self) -> list[dict]:
        return self._get("/proPlayers")  # type: ignore[return-value]

    def _teams(self) -> list[dict]:
        return self._get("/teams")  # type: ignore[return-value]

    def resolve_player(self, nick: str) -> tuple[int, str] | None:
        want = _norm(nick)
        rows = self._pro_players()
        exact = [r for r in rows if _norm(r.get("name") or "") == want]
        if not exact:
            exact = [r for r in rows if _norm(r.get("personaname") or "") == want]
        if not exact:
            # last resort: unique substring hit on the pro alias
            hits = [r for r in rows if want and want in _norm(r.get("name") or "")]
            if len(hits) == 1:
                exact = hits
        if not exact:
            return None
        # Prefer the most recently active account when a nick is reused.
        best = max(exact, key=lambda r: r.get("last_match_time") or "")
        return int(best["account_id"]), str(best.get("name") or best["personaname"])

    def resolve_team(self, name: str) -> tuple[int, str] | None:
        want = _norm(name)
        rows = self._teams()
        for r in rows:
            if _norm(r.get("name") or "") == want or _norm(r.get("tag") or "") == want:
                return int(r["team_id"]), str(r.get("name") or name)
        hits = [r for r in rows if want and want in _norm(r.get("name") or "")]
        if len(hits) == 1:
            return int(hits[0]["team_id"]), str(hits[0]["name"])
        return None

    # -- match data ------------------------------------------------------
    def recent_pro_matches(self, since: datetime, limit: int = 4000) -> list[MatchResult]:
        """Walk /proMatches backwards until we pass `since`."""
        out: list[MatchResult] = []
        cursor: int | None = None
        cutoff = since.timestamp()
        while len(out) < limit:
            rows = self._get("/proMatches", **({"less_than_match_id": cursor} if cursor else {}))
            if not rows:
                break
            for r in rows:  # type: ignore[union-attr]
                out.append(_match_from_row(r))
            cursor = min(int(r["match_id"]) for r in rows)  # type: ignore[union-attr]
            if min(int(r["start_time"]) for r in rows) < cutoff:  # type: ignore[union-attr]
                break
        return [m for m in out if m.start_time >= since][:limit]

    def leagues(self) -> dict[int, dict]:
        """league_id -> {name, tier}. Tiers: premium > professional > amateur.

        A Bo3 in a regional open qualifier and a Bo3 in an EWC final are not
        equal evidence, and OpenDota already labels which is which.
        """
        rows = self._get("/leagues")
        return {int(r["leagueid"]): r for r in rows}  # type: ignore[union-attr]

    def heroes(self) -> dict[int, str]:
        """hero_id -> localized name."""
        rows = self._get("/heroes")
        return {int(r["id"]): r["localized_name"] for r in rows}  # type: ignore[union-attr]

    def league_matches(self, league_id: int) -> list[MatchResult]:
        rows = self._get(f"/leagues/{league_id}/matches")
        return [_match_from_row(r, league_id=league_id) for r in rows]  # type: ignore[union-attr]

    def match_detail(self, match_id: int) -> dict:
        # A parsed replay never changes, so it is kept for a year; an unparsed
        # answer expires in an hour so the next run picks the replay up once
        # OpenDota has processed it. Without the split, the 6h default made every
        # rerun refetch the entire corpus at 1.25s per match.
        return self._get(f"/matches/{match_id}", ttl=_match_ttl)  # type: ignore[arg-type,return-value]

    def player_games_from_match(self, match_id: int) -> list[PlayerGame]:
        m = self.match_detail(match_id)
        if not m or "players" not in m:
            return []
        start = datetime.fromtimestamp(int(m["start_time"]), tz=timezone.utc)
        duration = int(m.get("duration") or 0)
        radiant_win = bool(m.get("radiant_win"))

        # Match-level conditions for the coach Title suffixes. Computed once here
        # rather than per player, and left as None when the replay is unparsed so
        # an absent condition is never mistaken for a failed one.
        fb_times = [
            o.get("time")
            for o in (m.get("objectives") or [])
            if o.get("type") == "CHAT_MESSAGE_FIRSTBLOOD" and o.get("time") is not None
        ]
        first_blood_time = min(fb_times) if fb_times else None
        tormentor_death: bool | None = None
        if any(p.get("killed_by") is not None for p in m["players"]):
            tormentor_death = any(
                "npc_dota_miniboss" in (p.get("killed_by") or {}) for p in m["players"]
            )

        games: list[PlayerGame] = []
        for p in m["players"]:
            acc = p.get("account_id")
            if acc is None:
                continue
            is_radiant = p.get("isRadiant")
            if is_radiant is None:
                is_radiant = int(p.get("player_slot", 0)) < 128
            stats: dict[str, float] = {}
            for src, dst in FIELD_MAP.items():
                v = p.get(src)
                if v is not None:
                    stats[dst] = float(v)
            lh, dn = p.get("last_hits"), p.get("denies")
            if lh is not None:
                stats["last_hits_denies"] = float(lh) + float(dn or 0)
            # Smokes are not a top-level field; they live in the item-usage
            # counters. `item_uses` beats `purchase` here -- buying a smoke and
            # never popping it should not count.
            uses = p.get("item_uses") or {}
            if "smoke_of_deceit" in uses:
                stats["smokes_used"] = float(uses["smoke_of_deceit"])
            elif p.get("purchase"):
                stats["smokes_used"] = float(
                    (p.get("purchase") or {}).get("smoke_of_deceit", 0)
                )
            # Tormentor. Not a top-level field, but the unit-kill counters carry
            # it: the Tormentor is `npc_dota_miniboss`. The objectives log has
            # CHAT_MESSAGE_MINIBOSS_KILL too, which credits a whole team (and
            # sometimes slot -1), so the per-player counter is the only usable
            # attribution.
            #
            # Both counters below are sparse dicts: a player who killed no
            # Tormentor has no key at all. That is a measured ZERO, not a missing
            # measurement, and the difference is not cosmetic -- averaging only
            # over games where the key exists conditions the mean on "given they
            # killed one", which for Tormentors would overstate it roughly
            # sixfold. So emit an explicit 0 whenever the replay was parsed at
            # all, and stay silent when it was not.
            killed = p.get("killed")
            if killed is not None:
                stats["tormentor_kills"] = float(killed.get("npc_dota_miniboss", 0))
            # Madstones. `item_uses.madstone_bundle` counts bundles consumed,
            # which is a LOWER BOUND on madstones collected if a bundle carries
            # more than one. It is the only madstone signal OpenDota exposes, so
            # this emblem is scored optimistically-low rather than as zero.
            if p.get("item_uses") is not None:
                stats["madstone_collected"] = float(uses.get("madstone_bundle", 0))
            # Watchers. `ability_uses.ability_lamp_use` is the capture: a Watcher
            # is a "lamp" in Valve's own naming, which is the whole reason an
            # earlier search of these payloads for "watcher" came back empty and
            # the stat spent a tournament marked unmeasurable.
            #
            # NOT `ability_capture`, which sits beside it in the same dict and
            # looks like the obvious choice. That one is the OUTPOST: dotaconstants
            # gives it `target_team: Enemy` and `base_capture_time: 6`, and it
            # fires once or twice a match against this field's 27 to 44. Taking it
            # would have understated the stat by an order of magnitude and still
            # produced a plausible number.
            #
            # Same sparse-dict rule as the Tormentor above, and it matters more
            # here because most players take none: an absent KEY on a parsed
            # replay is a measured zero, while an absent MAP is an unparsed replay
            # and no measurement at all.
            abilities = p.get("ability_uses")
            if abilities is not None:
                stats["watchers_taken"] = float(abilities.get("ability_lamp_use", 0))
            if p.get("neutral_kills") is not None:
                stats["neutral_kills"] = float(p["neutral_kills"])
            if p.get("observer_kills") is not None:
                stats["observer_kills"] = float(p["observer_kills"])
            games.append(
                PlayerGame(
                    account_id=int(acc),
                    match_id=int(match_id),
                    start_time=start,
                    won=bool(is_radiant) == radiant_win,
                    duration_seconds=duration,
                    stats=stats,
                    hero_id=p.get("hero_id"),
                    first_blood_time=first_blood_time,
                    tormentor_death=tormentor_death,
                )
            )
        return games

    def player_games(
        self, account_id: int, since: datetime, limit: int = 60
    ) -> list[PlayerGame]:
        """Fallback path. Prefer harvesting by match -- this loses parsed stats."""
        rows = self._get(
            f"/players/{account_id}/matches",
            limit=limit,
            significant=1,
        )
        out = []
        for r in rows:  # type: ignore[union-attr]
            st = datetime.fromtimestamp(int(r["start_time"]), tz=timezone.utc)
            if st < since:
                continue
            is_radiant = int(r.get("player_slot", 0)) < 128
            stats = {
                dst: float(r[src])
                for src, dst in FIELD_MAP.items()
                if r.get(src) is not None
            }
            out.append(
                PlayerGame(
                    account_id=account_id,
                    match_id=int(r["match_id"]),
                    start_time=st,
                    won=is_radiant == bool(r.get("radiant_win")),
                    duration_seconds=int(r.get("duration") or 0),
                    stats=stats,
                )
            )
        return out


PARSED_TTL = 365 * 24 * 3600
UNPARSED_TTL = 3600


def _match_ttl(payload: object) -> int:
    """A parsed match is permanent evidence; an unparsed one is provisional."""
    if not isinstance(payload, dict):
        return UNPARSED_TTL
    if payload.get("version") is None:
        return UNPARSED_TTL
    return PARSED_TTL


def _match_from_row(r: dict, league_id: int | None = None) -> MatchResult:
    return MatchResult(
        match_id=int(r["match_id"]),
        start_time=datetime.fromtimestamp(int(r["start_time"]), tz=timezone.utc),
        radiant_team_id=r.get("radiant_team_id"),
        dire_team_id=r.get("dire_team_id"),
        radiant_name=r.get("radiant_name"),
        dire_name=r.get("dire_name"),
        radiant_win=bool(r.get("radiant_win")),
        league_id=r.get("leagueid", league_id),
        league_name=r.get("league_name"),
        duration_seconds=r.get("duration"),
    )


def cached_pro_matches(league_id: int | None = None) -> list[MatchResult]:
    """Every /proMatches row already on disk, deduped, newest first.

    An offline replay of past fetches. `recent_pro_matches` walks the endpoint
    with a six-hour TTL, so re-running it days later refetches thousands of rows
    to rebuild a corpus that is already sitting in the cache. When the question
    is about matches that have already been played -- a finished group stage --
    the cache is the whole answer, so read it directly and stay off the network.
    """
    seen: dict[int, MatchResult] = {}
    for _, rows in cache.scan("opendota", "/proMatches"):
        for r in rows or []:
            if league_id is not None and r.get("leagueid") != league_id:
                continue
            seen.setdefault(int(r["match_id"]), _match_from_row(r))
    return sorted(seen.values(), key=lambda m: m.start_time, reverse=True)


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


__all__ = ["OpenDota", "cached_pro_matches", "utcnow"]
