"""Monte Carlo simulation of the TI 2026 Main Event bracket.

Eight teams, double elimination, every series Bo3 except a Bo5 Grand Final
(Aug 20-23, Oriental Sports Center). The seeding is not simulated -- it is
already drawn, so the round-one pairings are read from config/tournament.yaml.

    UB R1   A, B, C, D
    UB R2   E = winner A vs winner B      F = winner C vs winner D
    UB F    G = winner E vs winner F
    LB R1   loser A vs loser B            loser C vs loser D
    LB R2   loser F vs winner LB R1 #1    loser E vs winner LB R1 #2
    LB R3   the two LB R2 winners
    LB F    loser G vs winner LB R3
    GF      winner G vs winner LB F       (Bo5)

Why this exists at all: fantasy resets per period, and the Main Event period
scores `best series`, where a series scores its top two games. The bracket
decides both how many series a team plays (2 if it loses twice immediately, up
to 6 through the lower bracket) and how long they are -- and a Bo5 is worth more
than a Bo3 under a top-two rule, because the top two of five draws beats the top
two of three. Unlike the group-stage Swiss, where a guaranteed 4-6 series
compressed the spread to a fraction of a percent, here survival genuinely moves
the projection, so it has to be modelled rather than assumed away.

The output mirrors `swiss.SwissOutcome` closely enough that
`fantasy.expected_best_series` consumes it unchanged.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np


# Every match in the tree, labelled as the client labels the ones it names. The
# in-client bracket prediction is one pick per node, and the picks must stay
# consistent: predicting a team to win G is only legal if you also predicted it
# through E or F to get there.
NODES = ("A", "B", "C", "D", "E", "F", "G", "LB1a", "LB1b", "LB2a", "LB2b", "LB3", "LBF", "GF")

# node -> the dates the client prints beside it, for reporting only.
NODE_DAY = {
    "A": "Aug 20", "B": "Aug 20", "C": "Aug 20", "D": "Aug 20",
    "E": "Aug 21", "F": "Aug 21", "G": "Aug 22",
    "LB1a": "Aug 21", "LB1b": "Aug 21",
    "LB2a": "Aug 22", "LB2b": "Aug 22", "LB3": "Aug 22",
    "LBF": "Aug 23", "GF": "Aug 23",
}


@dataclass
class BracketOutcome:
    teams: list[str]
    n_sims: int
    # Per team, sampled shapes of the period: games-per-series for one simulated
    # run, e.g. (3, 2, 3). Same contract as SwissOutcome.series_samples.
    series_samples: dict[str, list[tuple[int, ...]]] = field(default_factory=dict)
    # Aligned with series_samples, one flag per series: did it go to the last
    # possible game (3 of a Bo3, 5 of a Bo5)? The Clutch coach Title pays only
    # there, and a 3-game Bo5 sweep is not a decider even though a 3-game Bo3 is,
    # so the flag cannot be recovered from the game count alone.
    decider_samples: dict[str, list[tuple[bool, ...]]] = field(default_factory=dict)
    # team -> opponent -> expected series against them. Feeds the opponent-strength
    # restatement: the Main Event field is stronger than the 16-team average every
    # stat line was normalised to.
    opponent_series: dict[str, dict[str, float]] = field(default_factory=dict)
    expected_series: dict[str, float] = field(default_factory=dict)
    expected_games: dict[str, float] = field(default_factory=dict)
    champion_prob: dict[str, float] = field(default_factory=dict)
    grand_final_prob: dict[str, float] = field(default_factory=dict)
    top4_prob: dict[str, float] = field(default_factory=dict)
    # node label -> team -> P(that team wins that match). The in-client bracket
    # prediction is one pick per node, so these marginals are what a filled bracket
    # is scored against.
    node_win_prob: dict[str, dict[str, float]] = field(default_factory=dict)
    # node label -> team -> P(that team plays in that match), for reporting who is
    # even likely to reach a slot.
    node_reach_prob: dict[str, dict[str, float]] = field(default_factory=dict)
    # (n_sims, len(NODES)) of team indices into `teams`: who won each match in each
    # simulation. Marginals answer "how many picks will I get right"; these joint
    # samples are what answers "what are the odds the whole bracket is right", which
    # the marginals cannot, because the picks are not independent.
    node_winners: "np.ndarray | None" = None


# Losing here ends your run. Losing anywhere else in the upper bracket only drops
# you into the lower one, which is why two of your fantasy picks meeting in the
# upper bracket costs far less than it looks like it should.
ELIMINATION_NODES = ("LB1a", "LB1b", "LB2a", "LB2b", "LB3", "LBF", "GF")


def reconstruct_participants(
    pairings: list[tuple[str, str]], teams: list[str], node_winners: np.ndarray
) -> dict[str, np.ndarray]:
    """node -> (n_sims, 2) team indices of who played that match, per simulation.

    The tree is deterministic once every match's winner is known, so the full
    participation history is recoverable from the winners alone. That is what lets
    questions like "did these two of my picks meet, and did the loser survive it" be
    answered exactly, rather than approximated from marginals.

    The loser of a two-team match is recovered as `a + b - winner`, which holds
    because exactly one of the two indices is the winner.
    """
    at = {n: i for i, n in enumerate(NODES)}
    idx = {t: i for i, t in enumerate(teams)}
    n = node_winners.shape[0]

    def const(team: str) -> np.ndarray:
        return np.full(n, idx[team], dtype=np.int64)

    part: dict[str, np.ndarray] = {}
    win: dict[str, np.ndarray] = {}
    lose: dict[str, np.ndarray] = {}

    def record(node: str, a: np.ndarray, b: np.ndarray) -> None:
        part[node] = np.stack([a, b], axis=1)
        w = node_winners[:, at[node]].astype(np.int64)
        win[node] = w
        lose[node] = a + b - w

    for (x, y), node in zip(pairings, "ABCD"):
        record(node, const(x), const(y))
    record("E", win["A"], win["B"])
    record("F", win["C"], win["D"])
    record("G", win["E"], win["F"])
    record("LB1a", lose["A"], lose["B"])
    record("LB1b", lose["C"], lose["D"])
    record("LB2a", lose["F"], win["LB1a"])
    record("LB2b", lose["E"], win["LB1b"])
    record("LB3", win["LB2a"], win["LB2b"])
    record("LBF", lose["G"], win["LB3"])
    record("GF", win["G"], win["LBF"])
    return part


def play_series(pa: float, rng: np.random.Generator, best_of: int = 3) -> tuple[bool, int]:
    """One series played game by game. Returns (first team won, games played)."""
    need = best_of // 2 + 1
    a = b = 0
    while a < need and b < need:
        if rng.random() < pa:
            a += 1
        else:
            b += 1
    return a > b, a + b


def simulate(
    pairings: list[tuple[str, str]],
    win_prob,
    *,
    n_sims: int = 20000,
    seed: int = 20260820,
    best_of: int = 3,
    final_best_of: int = 5,
    keep_samples: int = 4000,
) -> BracketOutcome:
    """`win_prob(a, b)` -> P(a wins one game vs b). `pairings` = UB round 1."""
    if len(pairings) != 4:
        raise ValueError(f"Main Event bracket needs 4 round-one series, got {len(pairings)}")
    teams = [t for pair in pairings for t in pair]
    if len(set(teams)) != 8:
        raise ValueError(f"expected 8 distinct teams, got {sorted(set(teams))}")

    rng = np.random.default_rng(seed)
    idx = {t: i for i, t in enumerate(teams)}
    P = np.array([[win_prob(a, b) if a != b else 0.5 for b in teams] for a in teams])

    samples: dict[str, list[tuple[int, ...]]] = {t: [] for t in teams}
    deciders: dict[str, list[tuple[bool, ...]]] = {t: [] for t in teams}
    faced: dict[str, dict[str, int]] = {t: defaultdict(int) for t in teams}
    node_wins: dict[str, dict[str, int]] = {n: defaultdict(int) for n in NODES}
    node_reach: dict[str, dict[str, int]] = {n: defaultdict(int) for n in NODES}
    node_at = {n: i for i, n in enumerate(NODES)}
    winners = np.empty((n_sims, len(NODES)), dtype=np.int16)
    series_total = dict.fromkeys(teams, 0)
    games_total = dict.fromkeys(teams, 0)
    champion = dict.fromkeys(teams, 0)
    finalist = dict.fromkeys(teams, 0)
    top4 = dict.fromkeys(teams, 0)
    keep = min(n_sims, keep_samples)

    for sim in range(n_sims):
        shape: dict[str, list[int]] = defaultdict(list)
        went_distance: dict[str, list[bool]] = defaultdict(list)

        def series(a: str, b: str, node: str, bo: int = best_of) -> tuple[str, str]:
            """Play a and b; return (winner, loser) and record everything about it."""
            a_won, g = play_series(P[idx[a], idx[b]], rng, bo)
            for t, opp in ((a, b), (b, a)):
                shape[t].append(g)
                went_distance[t].append(g == bo)
                faced[t][opp] += 1
                node_reach[node][t] += 1
            win, lose = (a, b) if a_won else (b, a)
            node_wins[node][win] += 1
            winners[sim, node_at[node]] = idx[win]
            return win, lose

        # Upper bracket.
        r1 = [series(a, b, node) for (a, b), node in zip(pairings, "ABCD")]
        e_w, e_l = series(r1[0][0], r1[1][0], "E")
        f_w, f_l = series(r1[2][0], r1[3][0], "F")
        g_w, g_l = series(e_w, f_w, "G")

        # Lower bracket. Halves cross: the UB R2 loser from one half meets the
        # LB survivor from the other, which is what the drawn bracket shows.
        lb1_a, _ = series(r1[0][1], r1[1][1], "LB1a")
        lb1_b, _ = series(r1[2][1], r1[3][1], "LB1b")
        lb2_a, _ = series(f_l, lb1_a, "LB2a")
        lb2_b, _ = series(e_l, lb1_b, "LB2b")
        lb3_w, lb3_l = series(lb2_a, lb2_b, "LB3")
        lbf_w, lbf_l = series(g_l, lb3_w, "LBF")

        champ, runner_up = series(g_w, lbf_w, "GF", final_best_of)

        champion[champ] += 1
        finalist[champ] += 1
        finalist[runner_up] += 1
        # 1st and 2nd from the Grand Final, 3rd is the LB Final loser, 4th the
        # LB R3 loser.
        for t in (champ, runner_up, lbf_l, lb3_l):
            top4[t] += 1

        for t in teams:
            series_total[t] += len(shape[t])
            games_total[t] += sum(shape[t])
            if sim < keep:
                samples[t].append(tuple(shape[t]))
                deciders[t].append(tuple(went_distance[t]))

    return BracketOutcome(
        teams=teams,
        n_sims=n_sims,
        series_samples=samples,
        decider_samples=deciders,
        opponent_series={
            t: {o: c / n_sims for o, c in faced[t].items()} for t in teams
        },
        expected_series={t: series_total[t] / n_sims for t in teams},
        expected_games={t: games_total[t] / n_sims for t in teams},
        champion_prob={t: champion[t] / n_sims for t in teams},
        grand_final_prob={t: finalist[t] / n_sims for t in teams},
        top4_prob={t: top4[t] / n_sims for t in teams},
        node_win_prob={
            n: {t: c / n_sims for t, c in node_wins[n].items()} for n in NODES
        },
        node_reach_prob={
            n: {t: c / n_sims for t, c in node_reach[n].items()} for n in NODES
        },
        node_winners=winners,
    )
