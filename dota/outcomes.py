"""Every possible Main Event outcome, enumerated exactly.

`bracket.simulate` answers the same questions by Monte Carlo, which is the right
tool when the state space is large (the 16-team Swiss stage) or when what is
wanted is a *sample* of period shapes -- games per series, deciders -- that feeds
the fantasy projection. Neither applies here. The Main Event tree is fourteen
binary matches, so there are exactly

    2 ** 14 = 16,384

distinct outcomes, one per legal filling of the bracket. That is small enough to
write the whole distribution down: every outcome with its exact probability, no
sampling error anywhere, and every marginal, placement and pick-scoring question
answered by summation rather than by counting simulations.

What that buys over the simulation:

  * A perfect-bracket probability of 1-in-4,000 is measured, not estimated from
    60,000 draws where the event is expected to occur fifteen times.
  * "How likely is this exact outcome" becomes answerable at all -- most of the
    16,384 are individually rarer than one in ten thousand.
  * Placements 5th-8th fall out for free, and they are the ones a small sample
    prices worst.

A series is priced from a per-game probability under the usual independence
assumption (`ratings.series_prob`); the enumeration inherits that and nothing
else.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .bracket import NODES

# node -> (how to find its two participants from earlier results, series length key).
# `W`/`L` read the winner/loser of an already-played node; a bare string is a
# round-one seed, filled from the drawn pairings.
_TREE: tuple[tuple[str, tuple[str, str], tuple[str, str]], ...] = (
    ("A", ("seed", "0"), ("seed", "1")),
    ("B", ("seed", "2"), ("seed", "3")),
    ("C", ("seed", "4"), ("seed", "5")),
    ("D", ("seed", "6"), ("seed", "7")),
    ("E", ("W", "A"), ("W", "B")),
    ("F", ("W", "C"), ("W", "D")),
    ("G", ("W", "E"), ("W", "F")),
    ("LB1a", ("L", "A"), ("L", "B")),
    ("LB1b", ("L", "C"), ("L", "D")),
    ("LB2a", ("L", "F"), ("W", "LB1a")),
    ("LB2b", ("L", "E"), ("W", "LB1b")),
    ("LB3", ("W", "LB2a"), ("W", "LB2b")),
    ("LBF", ("L", "G"), ("W", "LB3")),
    ("GF", ("W", "G"), ("W", "LBF")),
)

# Where each place in the final standings is decided. 5th-6th and 7th-8th are
# not separated by the bracket itself -- both losers of a round go out together --
# so they are reported as ties, which is how Valve pays them.
PLACES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("1st", ("W:GF",)),
    ("2nd", ("L:GF",)),
    ("3rd", ("L:LBF",)),
    ("4th", ("L:LB3",)),
    ("5-6th", ("L:LB2a", "L:LB2b")),
    ("7-8th", ("L:LB1a", "L:LB1b")),
)


@dataclass
class OutcomeSpace:
    """The complete distribution over Main Event outcomes."""

    teams: list[str]
    # (n_outcomes, 14) team indices: who won each node, one row per outcome.
    winners: np.ndarray
    # Aligned probabilities. Sums to 1 up to floating point.
    probs: np.ndarray
    node_win_prob: dict[str, dict[str, float]] = field(default_factory=dict)
    node_reach_prob: dict[str, dict[str, float]] = field(default_factory=dict)
    champion_prob: dict[str, float] = field(default_factory=dict)
    grand_final_prob: dict[str, float] = field(default_factory=dict)
    top4_prob: dict[str, float] = field(default_factory=dict)
    # team -> place label -> probability of finishing there.
    place_prob: dict[str, dict[str, float]] = field(default_factory=dict)

    @property
    def n_outcomes(self) -> int:
        return int(self.winners.shape[0])

    def picks_of(self, row: int) -> dict[str, str]:
        return {n: self.teams[self.winners[row, i]] for i, n in enumerate(NODES)}

    def ranked(self, top_n: int | None = None) -> list[tuple[float, dict[str, str]]]:
        """Outcomes by probability, most likely first."""
        order = np.argsort(-self.probs)
        if top_n is not None:
            order = order[:top_n]
        return [(float(self.probs[i]), self.picks_of(int(i))) for i in order]

    def hits(self, picks: dict[str, str]) -> np.ndarray:
        """Per outcome, how many of `picks` that outcome would score correct."""
        index = {t: i for i, t in enumerate(self.teams)}
        want = np.array([index[picks[n]] for n in NODES], dtype=self.winners.dtype)
        return (self.winners == want).sum(axis=1)

    def score(self, picks: dict[str, str]) -> "PickScore":
        """Exact scoring of one filled bracket against the whole distribution."""
        h = self.hits(picks)
        dist = {
            int(k): float(self.probs[h == k].sum()) for k in range(len(NODES) + 1)
        }
        return PickScore(
            picks=dict(picks),
            per_node={
                n: self.node_win_prob.get(n, {}).get(picks[n], 0.0) for n in NODES
            },
            expected_correct=float((h * self.probs).sum()),
            perfect_prob=dist[len(NODES)],
            distribution={k: v for k, v in dist.items() if v > 0.0},
        )


@dataclass
class PickScore:
    picks: dict[str, str]
    per_node: dict[str, float]
    expected_correct: float
    perfect_prob: float
    distribution: dict[int, float]

    @property
    def champion(self) -> str:
        return self.picks["GF"]

    def at_least(self, k: int) -> float:
        return sum(v for n, v in self.distribution.items() if n >= k)


def enumerate_outcomes(
    pairings: list[tuple[str, str]],
    series_win_prob: Callable[[str, str, int], float],
    *,
    best_of: int = 3,
    final_best_of: int = 5,
) -> OutcomeSpace:
    """All 2^14 outcomes with exact probabilities.

    `series_win_prob(a, b, bo)` -> P(a wins a Bo-`bo` series against b).
    """
    if len(pairings) != 4:
        raise ValueError(f"Main Event bracket needs 4 round-one series, got {len(pairings)}")
    teams = [t for pair in pairings for t in pair]
    if len(set(teams)) != 8:
        raise ValueError(f"expected 8 distinct teams, got {sorted(set(teams))}")
    index = {t: i for i, t in enumerate(teams)}

    n_nodes = len(NODES)
    winners = np.empty((2**n_nodes, n_nodes), dtype=np.int8)
    losers = np.empty((2**n_nodes, n_nodes), dtype=np.int8)
    probs = np.empty(2**n_nodes, dtype=np.float64)
    row = 0

    def participants(depth: int, w: list[int], l: list[int]) -> tuple[int, int]:
        out = []
        for kind, ref in _TREE[depth][1:]:
            if kind == "seed":
                out.append(index[teams[int(ref)]])
            else:
                src = NODES.index(ref)
                out.append(w[src] if kind == "W" else l[src])
        return out[0], out[1]

    def walk(depth: int, p: float, w: list[int], l: list[int]) -> None:
        nonlocal row
        if depth == n_nodes:
            winners[row] = w
            losers[row] = l
            probs[row] = p
            row += 1
            return
        a, b = participants(depth, w, l)
        bo = final_best_of if NODES[depth] == "GF" else best_of
        pa = series_win_prob(teams[a], teams[b], bo)
        for winner, loser, q in ((a, b, pa), (b, a, 1.0 - pa)):
            w[depth], l[depth] = winner, loser
            walk(depth + 1, p * q, w, l)
        w[depth] = l[depth] = -1

    walk(0, 1.0, [-1] * n_nodes, [-1] * n_nodes)

    space = OutcomeSpace(teams=teams, winners=winners, probs=probs)
    at = {n: i for i, n in enumerate(NODES)}

    for node in NODES:
        col_w = winners[:, at[node]]
        col_l = losers[:, at[node]]
        space.node_win_prob[node] = {}
        space.node_reach_prob[node] = {}
        for t, i in index.items():
            pw = float(probs[col_w == i].sum())
            pl = float(probs[col_l == i].sum())
            if pw > 0.0:
                space.node_win_prob[node][t] = pw
            if pw + pl > 0.0:
                space.node_reach_prob[node][t] = pw + pl

    for t in teams:
        space.place_prob[t] = {}
        for label, slots in PLACES:
            p = 0.0
            for slot in slots:
                kind, node = slot.split(":")
                col = winners if kind == "W" else losers
                p += float(probs[col[:, at[node]] == index[t]].sum())
            space.place_prob[t][label] = p
        space.champion_prob[t] = space.place_prob[t]["1st"]
        space.grand_final_prob[t] = (
            space.place_prob[t]["1st"] + space.place_prob[t]["2nd"]
        )
        space.top4_prob[t] = sum(
            space.place_prob[t][k] for k in ("1st", "2nd", "3rd", "4th")
        )

    return space


def best_bracket(space: OutcomeSpace) -> PickScore:
    """The legal filling with the highest expected number of correct picks.

    Maximised over the enumeration itself: every row of `winners` *is* a legal
    filling, so the argmax over rows of `E[correct | pick that row]` is the exact
    optimum with no search heuristic involved.
    """
    marginal = np.zeros((len(NODES), len(space.teams)))
    for i, node in enumerate(NODES):
        for t, p in space.node_win_prob.get(node, {}).items():
            marginal[i, space.teams.index(t)] = p
    # Row r's score is sum_node marginal[node, winner[r, node]]; take them all at
    # once rather than scoring 16,384 brackets one by one.
    expected = marginal[np.arange(len(NODES))[None, :], space.winners].sum(axis=1)
    return space.score(space.picks_of(int(np.argmax(expected))))


__all__ = [
    "OutcomeSpace",
    "PickScore",
    "PLACES",
    "best_bracket",
    "enumerate_outcomes",
]
