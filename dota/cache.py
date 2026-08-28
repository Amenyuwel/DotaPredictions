"""Disk cache for API responses. Keeps reruns cheap and keeps us off rate limits."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Callable, Iterator

from .config import CACHE_DIR


def _path(namespace: str, key: str) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    return CACHE_DIR / namespace / f"{digest}.json"


def get_or_fetch(
    namespace: str,
    key: str,
    fetch: Callable[[], Any],
    ttl_seconds: int | Callable[[Any], int] = 6 * 3600,
) -> Any:
    """Fetch through the disk cache.

    `ttl_seconds` may be a callable taking the payload and returning its TTL.
    That is what lets a parsed match detail be kept for a year while the same
    endpoint's unparsed answer expires in an hour: the two are the same request
    but not the same evidence, and freezing an unparsed reply would silently
    drop stuns, wards and teamfight participation from every projection.
    """

    def ttl_of(payload: Any) -> int:
        return ttl_seconds(payload) if callable(ttl_seconds) else ttl_seconds

    p = _path(namespace, key)
    if p.exists():
        try:
            blob = json.loads(p.read_text(encoding="utf-8"))
            if time.time() - blob["fetched_at"] < ttl_of(blob["payload"]):
                return blob["payload"]
        except (json.JSONDecodeError, KeyError):
            pass  # corrupt entry, refetch

    payload = fetch()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"fetched_at": time.time(), "key": key, "payload": payload}),
        encoding="utf-8",
    )
    return payload


def scan(namespace: str, prefix: str = "") -> Iterator[tuple[str, Any]]:
    """Replay already-cached payloads whose request key starts with `prefix`.

    TTL is deliberately ignored: this is not a fetch that happens to hit the
    cache, it is a read of what a past fetch already stored, so a run can be
    reproduced offline and identically. Anything not on disk is simply absent --
    callers get a smaller corpus, never a network call.
    """
    target = CACHE_DIR / namespace
    if not target.exists():
        return
    for f in sorted(target.glob("*.json")):
        try:
            blob = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        key = blob.get("key")
        if isinstance(key, str) and key.startswith(prefix):
            yield key, blob.get("payload")


def clear(namespace: str | None = None) -> int:
    target = CACHE_DIR / namespace if namespace else CACHE_DIR
    if not target.exists():
        return 0
    n = 0
    for f in target.rglob("*.json"):
        f.unlink()
        n += 1
    return n
