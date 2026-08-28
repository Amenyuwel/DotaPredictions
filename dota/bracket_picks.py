"""Filling in the Main Event bracket prediction.

The client asks for a winner at every match in the tree, and the picks propagate:
you cannot predict a team to win the Upper Bracket Final unless you also predicted
it through the round that gets it there. So the answer is not "take the favourite at
each of the fourteen matches" -- that set of picks is usually **not a legal bracket**,
because the favourite of a lower-bracket match is often a team you already predicted
to avoid the lower bracket entirely.

What *is* true, and what makes this tractable: expected correct picks is a sum over
matches, and expectation is linear, so

    E[correct] = SUM over nodes of P(the team I picked wins that node)

with each probability taken from the simulation's **marginal** for that node. The
coupling is entirely in the legality constraint, so the job is to maximise that sum
over legal fillings. Fourteen binary choices is 16,384 brackets, which is small
enough to enumerate exhaustively and be certain of the optimum rather than trust a
heuristic.

One thing the marginals cannot answer: the odds of getting the *whole* bracket right.
Picks are strongly correlated -- one upset breaks several at once -- so that has to be
counted directly from the joint simulation samples, which `perfect_probability` does.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

import numpy as np

from .bracket import NODES


@dataclass
class Filling:
    """One legal set of bracket picks."""

    picks: dict[str, str]
    expected_correct: float
    # Filled in for the few fillings worth costing out in detail.
    perfect_prob: float | None = None
    correct_hist: dict[int, float] = field(default_factory=dict)

    @property
    def champion(self) -> str:
        return self.picks["GF"]

    def matches(self, node: str) -> str:
        return self.picks[node]


def enumerate_fillings(pairings: list[tuple[str, str]]) -> list[dict[str, str]]:
    """Every legal filling of the tree, given the drawn round-one pairings.

    The lower bracket is not free: who plays there is decided by the upper-bracket
    picks, which is exactly why picking each match's favourite independently tends to
    produce something illegal.
    """
    out: list[dict[str, str]] = []
    (a0, a1), (b0, b1), (c0, c1), (d0, d1) = pairings
    for wa, wb, wc, wd in product((a0, a1), (b0, b1), (c0, c1), (d0, d1)):
        la = a1 if wa == a0 else a0
        lb = b1 if wb == b0 else b0
        lc = c1 if wc == c0 else c0
        ld = d1 if wd == d0 else d0
        for we in (wa, wb):
            le = wb if we == wa else wa
            for wf in (wc, wd):
                lf = wd if wf == wc else wc
                for wg in (we, wf):
                    lg = wf if wg == we else we
                    for w_lb1a in (la, lb):
                        for w_lb1b in (lc, ld):
                            # Halves cross, as the drawn bracket shows.
                            for w_lb2a in (lf, w_lb1a):
                                for w_lb2b in (le, w_lb1b):
                                    for w_lb3 in (w_lb2a, w_lb2b):
                                        for w_lbf in (lg, w_lb3):
                                            for w_gf in (wg, w_lbf):
                                                out.append(
                                                    {
                                                        "A": wa, "B": wb,
                                                        "C": wc, "D": wd,
                                                        "E": we, "F": wf, "G": wg,
                                                        "LB1a": w_lb1a,
                                                        "LB1b": w_lb1b,
                                                        "LB2a": w_lb2a,
                                                        "LB2b": w_lb2b,
                                                        "LB3": w_lb3,
                                                        "LBF": w_lbf,
                                                        "GF": w_gf,
                                                    }
                                                )
    return out


def expected_correct(picks: dict[str, str], node_win_prob: dict[str, dict[str, float]]) -> float:
    return sum(node_win_prob.get(n, {}).get(picks[n], 0.0) for n in NODES)


def best_fillings(
    pairings: list[tuple[str, str]],
    node_win_prob: dict[str, dict[str, float]],
    *,
    top_n: int = 5,
) -> list[Filling]:
    """Legal fillings ranked by expected correct picks."""
    scored = [
        Filling(picks=p, expected_correct=expected_correct(p, node_win_prob))
        for p in enumerate_fillings(pairings)
    ]
    scored.sort(key=lambda f: -f.expected_correct)
    return scored[:top_n]


def greedy_ceiling(node_win_prob: dict[str, dict[str, float]]) -> tuple[float, dict[str, str]]:
    """Sum of each node's most likely winner, ignoring legality.

    Not an achievable score -- it is the ceiling a per-node greedy pick would claim,
    and the gap to the best legal bracket is the cost of the constraint. Reported so
    "just take every favourite" can be checked rather than assumed.
    """
    picks = {
        n: max(node_win_prob[n], key=node_win_prob[n].get)
        for n in NODES
        if node_win_prob.get(n)
    }
    return sum(node_win_prob[n][t] for n, t in picks.items()), picks


def is_legal(picks: dict[str, str], pairings: list[tuple[str, str]]) -> bool:
    return any(picks == f for f in enumerate_fillings(pairings))


def perfect_probability(
    picks: dict[str, str], teams: list[str], node_winners: np.ndarray
) -> tuple[float, dict[int, float]]:
    """P(every pick correct) and the distribution of how many land.

    Counted from the joint simulation rather than multiplied out of the marginals:
    the picks are heavily correlated, and one early upset takes several of them down
    together.
    """
    index = {t: i for i, t in enumerate(teams)}
    want = np.array([index[picks[n]] for n in NODES], dtype=np.int16)
    hits = (node_winners == want).sum(axis=1)
    n = node_winners.shape[0]
    hist = {int(k): float((hits == k).sum()) / n for k in np.unique(hits)}
    return float((hits == len(NODES)).mean()), hist


__all__ = [
    "Filling",
    "best_fillings",
    "enumerate_fillings",
    "expected_correct",
    "greedy_ceiling",
    "is_legal",
    "perfect_probability",
]
