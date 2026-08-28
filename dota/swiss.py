"""Monte Carlo simulation of the TI 2026 Swiss group stage.

Format (16 teams, all Bo3, teams stop once they hit 4 wins or 4 losses):

    R1  8-8
    R2  2-0:4   1-1:8   0-2:4
    R3  3-0:2   2-1:6   1-2:6   0-3:2
    R4  4-0:1   3-1:4   2-2:6   1-3:4   0-4:1
    R5  4-1:2   3-2:5   2-3:5   1-4:2

which lands on exactly the six buckets the in-client prediction grid asks for:
1x 4-0, 2x 4-1, 5x elimination-round winner, 5x elimination-round loser,
2x 1-4, 1x 0-4. The five 3-2 teams meet the five 2-3 teams in the elimination
round; winners advance, losers are out.

The simulator returns two things the rest of the project needs:
  * P(team lands in bucket)  -> drives the Predictions assignment
  * E[games played]          -> drives Fantasy, because in a drop-out Swiss the
                                spread between a deep run and an early exit is
                                large and dominates per-game scoring rate.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

BUCKETS = ("undefeated", "four_one", "elim_winner", "elim_loser", "one_four", "winless")


@dataclass
class SwissOutcome:
    teams: list[str]
    n_sims: int
    bucket_prob: dict[str, dict[str, float]]
    expected_games: dict[str, float]
    games_hist: dict[str, dict[int, float]]
    advance_prob: dict[str, float]
    expected_wins: dict[str, float]
    # Per team, sampled shapes of the phase: each entry is the games-per-series
    # for one simulated run, e.g. (2, 3, 2, 3, 2). Fantasy needs this rather
    # than a total, because scoring sums the top TWO games *within a series*
    # and then takes the best series -- a structure a game count cannot express.
    series_samples: dict[str, list[tuple[int, ...]]] = field(default_factory=dict)
    _bucket_counts: dict[str, dict[str, int]] = field(default_factory=dict, repr=False)

    def prob(self, team: str, bucket: str) -> float:
        return self.bucket_prob.get(team, {}).get(bucket, 0.0)

    def prob_matrix(self, teams: list[str], buckets: list[str]) -> np.ndarray:
        return np.array([[self.prob(t, b) for b in buckets] for t in teams])


def _pair_group(
    group: list[str],
    played: dict[str, set[str]],
    rng: np.random.Generator,
    max_tries: int = 40,
) -> list[tuple[str, str]]:
    """Pair teams inside one score group, avoiding rematches where possible."""
    for _ in range(max_tries):
        order = list(group)
        rng.shuffle(order)
        pairs, used, ok = [], set(), True
        for a in order:
            if a in used:
                continue
            used.add(a)
            opponent = next(
                (b for b in order if b not in used and b not in played[a]), None
            )
            if opponent is None:
                ok = False
                break
            used.add(opponent)
            pairs.append((a, opponent))
        if ok and len(used) == len(group):
            return pairs
    # Rematch-free pairing not found; fall back to any pairing rather than stall.
    order = list(group)
    rng.shuffle(order)
    return [(order[i], order[i + 1]) for i in range(0, len(order) - 1, 2)]


def _build_rounds(
    standings: dict[str, tuple[int, int]],
    rng: np.random.Generator,
    played: dict[str, set[str]],
) -> list[tuple[str, str]]:
    """Pair every still-active team, grouping by identical W-L record.

    Odd groups are handled by floating one team down into the next group, which
    is what real Swiss pairing does.
    """
    active = [t for t, (w, l) in standings.items() if w < 4 and l < 4]
    by_record: dict[tuple[int, int], list[str]] = defaultdict(list)
    for t in active:
        by_record[standings[t]].append(t)

    pairs: list[tuple[str, str]] = []
    floater: str | None = None
    # Best records first, so a float always drops to a weaker group.
    for record in sorted(by_record, key=lambda r: (-r[0], r[1])):
        group = by_record[record]
        if floater is not None:
            group = [floater] + group
            floater = None
        if len(group) % 2 == 1:
            floater = group.pop(rng.integers(len(group)))
        pairs.extend(_pair_group(group, played, rng))
    return pairs


def _play_series(pa: float, rng: np.random.Generator) -> tuple[bool, int]:
    """Bo3 played out game by game. Returns (first team won, games played)."""
    a = b = 0
    while a < 2 and b < 2:
        if rng.random() < pa:
            a += 1
        else:
            b += 1
    return a > b, a + b


def simulate(
    teams: list[str],
    win_prob,
    n_sims: int = 20000,
    seed: int = 20260813,
    elimination_pairing: str = "seeded",
) -> SwissOutcome:
    """`win_prob(a, b)` -> P(a wins one game vs b).

    elimination_pairing:
      "seeded" - best 3-2 plays worst 2-3 (rating order), the usual bracket rule
      "random" - uniform random 3-2 vs 2-3 pairing
    """
    rng = np.random.default_rng(seed)
    n = len(teams)
    if n != 16:
        raise ValueError(f"Swiss stage is defined for 16 teams, got {n}")

    # Precompute the per-game win probability matrix once.
    idx = {t: i for i, t in enumerate(teams)}
    P = np.array([[win_prob(a, b) if a != b else 0.5 for b in teams] for a in teams])

    bucket_counts: dict[str, dict[str, int]] = {t: dict.fromkeys(BUCKETS, 0) for t in teams}
    games_total = dict.fromkeys(teams, 0)
    wins_total = dict.fromkeys(teams, 0)
    games_hist: dict[str, dict[int, int]] = {t: defaultdict(int) for t in teams}
    advance_total = dict.fromkeys(teams, 0)
    series_samples: dict[str, list[tuple[int, ...]]] = {t: [] for t in teams}
    keep_samples = min(n_sims, 4000)

    for sim in range(n_sims):
        standings = {t: (0, 0) for t in teams}
        played: dict[str, set[str]] = {t: set() for t in teams}
        games = dict.fromkeys(teams, 0)
        series: dict[str, list[int]] = {t: [] for t in teams}

        for _round in range(5):
            pairs = _build_rounds(standings, rng, played)
            if not pairs:
                break
            for a, b in pairs:
                a_won, g = _play_series(P[idx[a], idx[b]], rng)
                games[a] += g
                games[b] += g
                series[a].append(g)
                series[b].append(g)
                played[a].add(b)
                played[b].add(a)
                aw, al = standings[a]
                bw, bl = standings[b]
                standings[a] = (aw + 1, al) if a_won else (aw, al + 1)
                standings[b] = (bw, bl + 1) if a_won else (bw + 1, bl)

        # Classify final records.
        winners_32 = [t for t in teams if standings[t] == (3, 2)]
        losers_23 = [t for t in teams if standings[t] == (2, 3)]

        for t in teams:
            w, l = standings[t]
            if (w, l) == (4, 0):
                bucket_counts[t]["undefeated"] += 1
                advance_total[t] += 1
            elif (w, l) == (4, 1):
                bucket_counts[t]["four_one"] += 1
                advance_total[t] += 1
            elif (w, l) == (1, 4):
                bucket_counts[t]["one_four"] += 1
            elif (w, l) == (0, 4):
                bucket_counts[t]["winless"] += 1
            wins_total[t] += w

        # Elimination round: five 3-2 teams vs five 2-3 teams, one Bo3 each.
        if len(winners_32) == len(losers_23) and winners_32:
            if elimination_pairing == "seeded":
                hi = sorted(winners_32, key=lambda t: -P[idx[t]].mean())
                lo = sorted(losers_23, key=lambda t: P[idx[t]].mean())
            else:
                hi, lo = list(winners_32), list(losers_23)
                rng.shuffle(hi)
                rng.shuffle(lo)
            for a, b in zip(hi, lo):
                a_won, g = _play_series(P[idx[a], idx[b]], rng)
                games[a] += g
                games[b] += g
                series[a].append(g)
                series[b].append(g)
                win, lose = (a, b) if a_won else (b, a)
                bucket_counts[win]["elim_winner"] += 1
                bucket_counts[lose]["elim_loser"] += 1
                advance_total[win] += 1
        else:
            # Degenerate split (should not happen in a clean 16-team run);
            # record the 3-2/2-3 teams without an elimination result.
            for t in winners_32:
                bucket_counts[t]["elim_winner"] += 1
            for t in losers_23:
                bucket_counts[t]["elim_loser"] += 1

        for t in teams:
            games_total[t] += games[t]
            games_hist[t][games[t]] += 1
            if sim < keep_samples:
                series_samples[t].append(tuple(series[t]))

    return SwissOutcome(
        teams=list(teams),
        n_sims=n_sims,
        bucket_prob={
            t: {b: bucket_counts[t][b] / n_sims for b in BUCKETS} for t in teams
        },
        expected_games={t: games_total[t] / n_sims for t in teams},
        games_hist={
            t: {g: c / n_sims for g, c in sorted(games_hist[t].items())} for t in teams
        },
        advance_prob={t: advance_total[t] / n_sims for t in teams},
        expected_wins={t: wins_total[t] / n_sims for t in teams},
        series_samples=series_samples,
        _bucket_counts=bucket_counts,
    )
