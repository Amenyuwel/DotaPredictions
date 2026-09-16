"""STRATZ GraphQL adapter.

Needs a free token from https://stratz.com/api -- put it in .env as:
    STRATZ_API_TOKEN=ey...

Why bother when OpenDota already has parsed pro stats: STRATZ returns every
player line for many matches in ONE request, so refreshing the corpus during
the tournament costs a handful of calls instead of hundreds. It is the faster
path, not a different truth. Without a token this adapter reports itself
unavailable and everything falls back to OpenDota.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import requests

from .. import cache
from .base import PlayerGame

ENDPOINT = "https://api.stratz.com/graphql"

# Kept deliberately small: STRATZ's schema moves, and a fat query that 400s is
# worse than a thin one that always works. Add fields (ward placement, stun
# seconds, teamfight participation) only after confirming their current names
# in the playground at https://api.stratz.com/graphql, and extend FIELD_MAP to
# match. Anything STRATZ does not supply still comes from OpenDota.
QUERY_MATCH = """
query($ids: [Long!]!) {
  matches(ids: $ids) {
    id
    startDateTime
    durationSeconds
    didRadiantWin
    leagueId
    radiantTeamId
    direTeamId
    players {
      steamAccountId
      isRadiant
      kills
      deaths
      numLastHits
      numDenies
      goldPerMinute
      experiencePerMinute
      stats { campStack }
    }
  }
}
"""

FIELD_MAP = {
    "kills": "kills",
    "deaths": "deaths",
    "goldPerMinute": "gold_per_min",
    "experiencePerMinute": "xp_per_min",
}


class Stratz:
    name = "stratz"

    def __init__(self, ttl: int = 6 * 3600):
        self.token = os.environ.get("STRATZ_API_TOKEN")
        self.ttl = ttl
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "STRATZ_API",
                "Content-Type": "application/json",
            }
        )
        if self.token:
            self._session.headers["Authorization"] = f"Bearer {self.token}"

    def available(self) -> bool:
        return bool(self.token)

    def _query(self, query: str, variables: dict) -> dict:
        if not self.available():
            raise RuntimeError("STRATZ_API_TOKEN not set")

        def fetch():
            resp = self._session.post(
                ENDPOINT, json={"query": query, "variables": variables}, timeout=60
            )
            resp.raise_for_status()
            body = resp.json()
            if "errors" in body:
                raise RuntimeError(f"STRATZ query failed: {body['errors']}")
            return body["data"]

        key = query + repr(sorted(variables.items()))
        return cache.get_or_fetch("stratz", key, fetch, ttl_seconds=self.ttl)

    def player_games_for_matches(self, match_ids: list[int]) -> list[PlayerGame]:
        """Bulk fetch. This is the whole reason STRATZ is wired in."""
        out: list[PlayerGame] = []
        for i in range(0, len(match_ids), 25):  # STRATZ caps batch size
            chunk = [int(m) for m in match_ids[i : i + 25]]
            data = self._query(QUERY_MATCH, {"ids": chunk})
            for m in data.get("matches") or []:
                if not m:
                    continue
                start = datetime.fromtimestamp(int(m["startDateTime"]), tz=timezone.utc)
                duration = int(m.get("durationSeconds") or 0)
                radiant_win = bool(m.get("didRadiantWin"))
                for p in m.get("players") or []:
                    acc = p.get("steamAccountId")
                    if acc is None:
                        continue
                    stats = {
                        dst: float(p[src])
                        for src, dst in FIELD_MAP.items()
                        if p.get(src) is not None
                    }
                    lh, dn = p.get("numLastHits"), p.get("numDenies")
                    if lh is not None:
                        stats["last_hits_denies"] = float(lh) + float(dn or 0)
                    ps = p.get("stats") or {}
                    if ps.get("campStack") is not None:
                        stats["camps_stacked"] = float(ps["campStack"])
                    out.append(
                        PlayerGame(
                            account_id=int(acc),
                            match_id=int(m["id"]),
                            start_time=start,
                            won=bool(p.get("isRadiant")) == radiant_win,
                            duration_seconds=duration,
                            stats=stats,
                        )
                    )
        return out

    # Team and player resolution and the Elo input come from OpenDota, which is
    # keyless. There used to be four stubs here returning None and [] to satisfy
    # a wider `Source` protocol; they are gone with it. A stub that answers
    # "nothing found" to a question this source was never going to answer is
    # worse than a missing method -- the missing method is an AttributeError at
    # the call site, and the stub is an empty corpus nobody questions.


__all__ = ["Stratz"]
