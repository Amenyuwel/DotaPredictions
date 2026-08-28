"""Turn probabilities into actual picks.

Predictions: assigning 16 teams to the 16 grid slots is a linear assignment
problem. Because the Swiss format guarantees each bucket gets exactly its
stated number of teams, and expectation is linear, maximising the sum of
marginal probabilities over a valid assignment maximises the expected number of
correct picks exactly. No heuristic needed -- this is the optimum.

Greedily filling each bucket with its most likely teams is NOT the same thing
and is routinely worse: it can hand the same team to two buckets and then have
to break the tie badly.

Fantasy: the legal roster space (support duo x core duo x mid) is small enough
to enumerate exhaustively, so we do, and rank.
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass
from itertools import count, product

import numpy as np
from scipy.optimize import linear_sum_assignment

# Sentinel for a forbidden cell. Finite, because linear_sum_assignment refuses
# a matrix containing inf, and large enough that the solver only ever picks one
# when the sub-problem is genuinely infeasible -- which we then detect.
_FORBIDDEN = -1e9

from .config import Bucket, Roster
from .fantasy import SlotProjection
from .swiss import SwissOutcome


@dataclass
class PredictionPick:
    bucket_id: str
    bucket_label: str
    team: str
    probability: float


@dataclass
class PredictionPlan:
    picks: list[PredictionPick]
    expected_correct: float
    n_slots: int

    def by_bucket(self) -> dict[str, list[PredictionPick]]:
        out: dict[str, list[PredictionPick]] = {}
        for p in self.picks:
            out.setdefault(p.bucket_id, []).append(p)
        return out

    @property
    def key(self) -> frozenset[tuple[str, str]]:
        """Identity of a grid: which team sits in which bucket.

        Slots inside a bucket are interchangeable -- the five Elimination Round
        Winner rows are the same question asked five times -- so two plans that
        differ only in row order are the same answer and must compare equal.
        """
        return frozenset((p.bucket_id, p.team) for p in self.picks)

    def diff_vs(self, other: "PredictionPlan") -> list[tuple[str, str, str]]:
        """(bucket label, team `other` has here, team we have here).

        Reported as bucket-level swaps because that is the only difference that
        exists; reprinting all sixteen rows to show two changes hides them.
        """
        mine = {(p.bucket_id, p.team): p for p in self.picks}
        theirs = {(p.bucket_id, p.team): p for p in other.picks}
        gained = [mine[k] for k in mine.keys() - theirs.keys()]
        lost = [theirs[k] for k in theirs.keys() - mine.keys()]

        out: list[tuple[str, str, str]] = []
        for pick in sorted(gained, key=lambda p: -p.probability):
            # Pair each new team with the team it displaced in the same bucket.
            match = next((l for l in lost if l.bucket_id == pick.bucket_id), None)
            if match is not None:
                lost.remove(match)
            out.append(
                (pick.bucket_label, match.team if match else "-", pick.team)
            )
        for pick in sorted(lost, key=lambda p: -p.probability):
            out.append((pick.bucket_label, pick.team, "-"))
        return out


def optimal_predictions(
    outcome: SwissOutcome, buckets: list[Bucket], teams: list[str]
) -> PredictionPlan:
    slots: list[Bucket] = []
    for b in buckets:
        slots.extend([b] * b.count)
    if len(slots) != len(teams):
        raise ValueError(f"{len(slots)} slots vs {len(teams)} teams")

    # rows = teams, cols = slots; value = expected points from that pairing
    value = np.array(
        [[outcome.prob(t, s.id) * s.points for s in slots] for t in teams]
    )
    rows, cols = linear_sum_assignment(-value)

    picks = [
        PredictionPick(
            bucket_id=slots[c].id,
            bucket_label=slots[c].label,
            team=teams[r],
            probability=outcome.prob(teams[r], slots[c].id),
        )
        for r, c in zip(rows, cols)
    ]
    order = {b.id: i for i, b in enumerate(buckets)}
    picks.sort(key=lambda p: (order[p.bucket_id], -p.probability))
    return PredictionPlan(
        picks=picks,
        expected_correct=float(value[rows, cols].sum()),
        n_slots=len(slots),
    )


def _bucket_values(
    outcome: SwissOutcome, buckets: list[Bucket], teams: list[str]
) -> np.ndarray:
    """Expected points for every (team, bucket) pairing."""
    return np.array(
        [[outcome.prob(t, b.id) * b.points for b in buckets] for t in teams]
    )


def _plan_from_pairs(
    pairs: tuple[tuple[int, int], ...],
    outcome: SwissOutcome,
    buckets: list[Bucket],
    teams: list[str],
    n_slots: int,
    value: np.ndarray,
) -> PredictionPlan:
    picks = [
        PredictionPick(
            bucket_id=buckets[b].id,
            bucket_label=buckets[b].label,
            team=teams[t],
            probability=outcome.prob(teams[t], buckets[b].id),
        )
        for t, b in pairs
    ]
    order = {b.id: i for i, b in enumerate(buckets)}
    picks.sort(key=lambda p: (order[p.bucket_id], -p.probability))
    return PredictionPlan(
        picks=picks,
        expected_correct=float(sum(value[t, b] for t, b in pairs)),
        n_slots=n_slots,
    )


def _solve_constrained(
    value: np.ndarray,
    col_bucket: np.ndarray,
    forced: tuple[tuple[int, int], ...],
    forbidden: frozenset[tuple[int, int]],
) -> tuple[tuple[tuple[int, int], ...], float] | None:
    """Best assignment honouring `forced` and `forbidden`, or None if infeasible.

    Constraints are expressed as (team index, BUCKET index) rather than (team,
    slot column). That distinction is the whole reason this function exists --
    see `k_best_predictions`.
    """
    n_teams = value.shape[0]
    expanded = value[:, col_bucket].copy()
    for t, b in forbidden:
        expanded[t, col_bucket == b] = _FORBIDDEN

    rows = list(range(n_teams))
    cols = list(range(len(col_bucket)))
    for t, b in forced:
        # Any column of the right bucket will do; they are interchangeable.
        col = next((c for c in cols if col_bucket[c] == b), None)
        if col is None or t not in rows:
            return None  # forced past the bucket's capacity
        rows.remove(t)
        cols.remove(col)

    pairs = list(forced)
    if rows:
        sub = expanded[np.ix_(rows, cols)]
        ri, ci = linear_sum_assignment(-sub)
        pairs.extend(
            (rows[a], int(col_bucket[cols[b]])) for a, b in zip(ri, ci)
        )

    # A forbidden cell in the result means no legal assignment existed and the
    # solver took the sentinel because it had nothing else.
    if any(p in forbidden for p in pairs):
        return None
    total = float(sum(value[t, b] for t, b in pairs))
    return tuple(sorted(pairs)), total


def k_best_predictions(
    outcome: SwissOutcome,
    buckets: list[Bucket],
    teams: list[str],
    k: int = 5,
    max_nodes: int = 2000,
) -> list[PredictionPlan]:
    """The k highest-scoring grids, best first, via Murty's algorithm.

    Murty partitions the solution space around the current best: force the
    first i pairs, forbid the (i+1)th, solve each piece, keep them in a heap.
    Popping the heap yields solutions in descending order of value.

    **Constraints are applied at bucket level, not slot level, and that is not a
    detail.** The grid has five identical Elimination Round Winner rows. Forbid
    a team from one of those columns and the solver simply moves it to the next
    one for the same score, so a slot-level Murty enumerates
    1!x2!x5!x5!x2!x1! = 57,600 orderings of grid #1 before it ever reaches a
    genuinely different answer. Constraining on (team, bucket) collapses that
    entire equivalence class to one node, so every solution popped here is a
    real alternative.
    """
    slots = sum(b.count for b in buckets)
    if slots != len(teams):
        raise ValueError(f"{slots} slots vs {len(teams)} teams")
    if k < 1:
        return []

    value = _bucket_values(outcome, buckets, teams)
    col_bucket = np.array(
        [i for i, b in enumerate(buckets) for _ in range(b.count)], dtype=int
    )

    root = _solve_constrained(value, col_bucket, (), frozenset())
    if root is None:
        return []

    tie = count()  # keeps heapq from comparing the payloads on equal scores
    heap: list[tuple[float, int, tuple, tuple, frozenset]] = [
        (-root[1], next(tie), root[0], (), frozenset())
    ]

    plans: list[PredictionPlan] = []
    seen: set[frozenset[tuple[str, str]]] = set()
    nodes = 0

    while heap and len(plans) < k and nodes < max_nodes:
        nodes += 1
        _, _, sol, forced, forbidden = heapq.heappop(heap)

        plan = _plan_from_pairs(sol, outcome, buckets, teams, slots, value)
        if plan.key not in seen:
            seen.add(plan.key)
            plans.append(plan)

        free = [p for p in sol if p not in forced]
        for i, pair in enumerate(free):
            child = _solve_constrained(
                value,
                col_bucket,
                tuple(forced) + tuple(free[:i]),
                forbidden | {pair},
            )
            if child is None:
                continue
            heapq.heappush(
                heap,
                (
                    -child[1],
                    next(tie),
                    child[0],
                    tuple(forced) + tuple(free[:i]),
                    forbidden | {pair},
                ),
            )

    return plans


def prediction_alternatives(
    outcome: SwissOutcome, buckets: list[Bucket], teams: list[str], top_n: int = 3
) -> dict[str, list[tuple[str, float]]]:
    """Per bucket, the teams with the highest marginal probability.

    This is the "who else was close" view. It is deliberately NOT the plan --
    read it alongside `optimal_predictions`, not instead of it.
    """
    out: dict[str, list[tuple[str, float]]] = {}
    for b in buckets:
        ranked = sorted(((t, outcome.prob(t, b.id)) for t in teams), key=lambda r: -r[1])
        out[b.id] = ranked[:top_n]
    return out


@dataclass
class FantasyRoster:
    support_team: str
    core_team: str
    mid_player: str
    mid_team: str
    projected_total: float
    breakdown: dict[str, float]

    def describe(self) -> str:
        return (
            f"supports={self.support_team} | cores={self.core_team} | "
            f"mid={self.mid_player} ({self.mid_team})"
        )


def enumerate_fantasy_rosters(
    roster: Roster,
    slots: dict[str, "SlotProjection"],
    *,
    distinct_teams: bool = False,
    top_n: int = 15,
) -> list[FantasyRoster]:
    """Exhaustive search over the duo-based roster space (16 x 16 x 16 = 4096).

    Slots are scored independently and summed. That is exact here: the client
    scores each role separately and adds them, so there is no cross-slot
    interaction to model.
    """
    teams = roster.names
    results: list[FantasyRoster] = []

    for sup_t, core_t, mid_t in product(teams, teams, teams):
        if distinct_teams and len({sup_t, core_t, mid_t}) < 3:
            continue
        sup = slots.get(f"support/{sup_t}")
        core = slots.get(f"core/{core_t}")
        mid = slots.get(f"mid/{mid_t}")
        if not (sup and core and mid):
            continue
        total = sup.projected + core.projected + mid.projected
        results.append(
            FantasyRoster(
                support_team=sup_t,
                core_team=core_t,
                mid_player=roster.get(mid_t).by_role("mid").nick,
                mid_team=mid_t,
                projected_total=total,
                breakdown={
                    "supports": sup.projected,
                    "cores": core.projected,
                    "mid": mid.projected,
                },
            )
        )

    results.sort(key=lambda r: -r.projected_total)
    return results[:top_n]
