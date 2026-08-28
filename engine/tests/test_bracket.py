"""Structural checks on the Main Event bracket. Run: python -m tests.test_bracket"""
from __future__ import annotations

import numpy as np

from dota import bracket

PAIRS = [("A1", "A2"), ("B1", "B2"), ("C1", "C2"), ("D1", "D2")]
TEAMS = [t for p in PAIRS for t in p]


def _even(a, b):
    return 0.5


def test_placements_are_consistent():
    """One champion, two finalists and four top-four teams per simulation. If
    this fails the bracket wiring is wrong and every projection built on the
    series shapes is meaningless."""
    o = bracket.simulate(PAIRS, _even, n_sims=2000, seed=11)
    assert abs(sum(o.champion_prob.values()) - 1.0) < 1e-9
    assert abs(sum(o.grand_final_prob.values()) - 2.0) < 1e-9
    assert abs(sum(o.top4_prob.values()) - 4.0) < 1e-9
    print("ok  1 champion, 2 finalists, 4 top-four per simulation")


def test_series_count_range():
    """Two series is the floor (lose UB R1 then LB R1), six the ceiling (lose UB
    R1 and run the whole lower bracket to the Grand Final)."""
    o = bracket.simulate(PAIRS, _even, n_sims=2000, seed=12)
    all_lengths = {len(s) for shapes in o.series_samples.values() for s in shapes}
    assert min(all_lengths) == 2, min(all_lengths)
    assert max(all_lengths) == 6, max(all_lengths)
    # 14 series over 8 teams = 28 team-series, so 3.5 each on average.
    total = sum(o.expected_series.values())
    assert abs(total - 28.0) < 1e-6, total
    print("ok  series per team spans 2-6 and sums to 28 team-series")


def test_grand_final_is_bo5():
    """A five-game series can only be the Grand Final, and only the two finalists
    can ever record one."""
    o = bracket.simulate(PAIRS, _even, n_sims=2000, seed=13)
    for team, shapes in o.series_samples.items():
        for s in shapes:
            assert all(g <= 3 for g in s[:-1]), (team, s)
            assert s[-1] <= 5, (team, s)
            if len(s) > 0 and s[-1] in (4, 5):
                assert len(s) in (4, 5, 6), (team, s)
    print("ok  only the last series of a run can exceed 3 games")


def test_stronger_teams_win_more():
    strength = {t: i * 0.4 for i, t in enumerate(TEAMS)}

    def wp(a, b):
        return 1.0 / (1.0 + np.exp(-(strength[a] - strength[b])))

    o = bracket.simulate(PAIRS, wp, n_sims=3000, seed=14)
    order = sorted(TEAMS, key=lambda t: -o.champion_prob[t])
    assert order[0] == TEAMS[-1], order
    assert o.champion_prob[TEAMS[-1]] > o.champion_prob[TEAMS[0]]
    # A stronger team plays MORE series here -- the opposite of the Swiss, where
    # reaching 4-0 early skipped the elimination round.
    assert o.expected_series[TEAMS[-1]] > o.expected_series[TEAMS[0]]
    print("ok  strength orders champion probability and series played")


def test_node_probabilities_are_coherent():
    """Every match has exactly one winner per simulation, and only the two teams
    that reached it can win it."""
    o = bracket.simulate(PAIRS, _even, n_sims=2000, seed=15)
    for node, dist in o.node_win_prob.items():
        assert abs(sum(dist.values()) - 1.0) < 1e-9, (node, sum(dist.values()))
        reach = o.node_reach_prob[node]
        assert abs(sum(reach.values()) - 2.0) < 1e-9, (node, sum(reach.values()))
        for team, p in dist.items():
            assert p <= reach[team] + 1e-9, (node, team, p, reach[team])
    assert o.node_winners is not None and o.node_winners.shape == (2000, 14)
    print("ok  node win/reach probabilities are coherent with the tree")


def test_bracket_picks_optimum_is_legal_and_bounded():
    """The per-node greedy pick is an upper bound that is usually unreachable; the
    best legal filling must sit at or below it, and must itself be legal."""
    from dota import bracket_picks

    strength = {t: i * 0.35 for i, t in enumerate(TEAMS)}

    def wp(a, b):
        return 1.0 / (1.0 + np.exp(-(strength[a] - strength[b])))

    o = bracket.simulate(PAIRS, wp, n_sims=4000, seed=16)
    fillings = bracket_picks.enumerate_fillings(PAIRS)
    assert len(fillings) == 2**14, len(fillings)
    assert len({tuple(sorted(f.items())) for f in fillings}) == 2**14, "duplicates"

    best = bracket_picks.best_fillings(PAIRS, o.node_win_prob, top_n=3)
    ceiling, greedy = bracket_picks.greedy_ceiling(o.node_win_prob)
    assert best[0].expected_correct <= ceiling + 1e-9, (best[0].expected_correct, ceiling)
    assert bracket_picks.is_legal(best[0].picks, PAIRS)
    assert best[0].expected_correct >= best[1].expected_correct >= best[2].expected_correct

    # A filling only ever predicts a team to win a match it also reaches.
    for node, team in best[0].picks.items():
        assert o.node_reach_prob[node].get(team, 0.0) > 0.0, (node, team)

    perfect, hist = bracket_picks.perfect_probability(
        best[0].picks, o.teams, o.node_winners
    )
    assert 0.0 <= perfect <= 1.0
    assert abs(sum(hist.values()) - 1.0) < 1e-9
    # Marginals cannot give this: independence would overstate it badly.
    independent = 1.0
    for node, team in best[0].picks.items():
        independent *= o.node_win_prob[node][team]
    assert perfect > independent, (perfect, independent)
    print(
        f"ok  best legal filling {best[0].expected_correct:.2f} <= greedy ceiling "
        f"{ceiling:.2f}; perfect {perfect:.3%} vs {independent:.3%} if independent"
    )


def test_participants_reconstruct_from_winners():
    """The tree is deterministic given every winner, so participation must be
    recoverable exactly. Everything about two picks colliding rests on this."""
    o = bracket.simulate(PAIRS, _even, n_sims=1500, seed=17)
    part = bracket.reconstruct_participants(PAIRS, o.teams, o.node_winners)
    at = {n: i for i, n in enumerate(bracket.NODES)}
    idx = {t: i for i, t in enumerate(o.teams)}

    for node, pair in part.items():
        a, b = pair[:, 0], pair[:, 1]
        w = o.node_winners[:, at[node]]
        assert ((w == a) | (w == b)).all(), f"{node}: winner did not play the match"
        assert (a != b).all(), f"{node}: a team played itself"

    # Round one is fixed by the draw.
    for (x, y), node in zip(PAIRS, "ABCD"):
        assert (part[node][:, 0] == idx[x]).all()
        assert (part[node][:, 1] == idx[y]).all()

    # The upper bracket feeds the lower one: LB R1 is exactly the R1 losers, and a
    # team beaten in the upper bracket must still appear later.
    for node, (n1, n2) in (("LB1a", ("A", "B")), ("LB1b", ("C", "D"))):
        for k, src in enumerate((n1, n2)):
            src_pair = part[src]
            src_loser = src_pair[:, 0] + src_pair[:, 1] - o.node_winners[:, at[src]]
            assert (part[node][:, k] == src_loser).all(), f"{node} vs {src}"

    # Anyone who loses the upper-bracket final plays the lower-bracket final.
    g_loser = part["G"][:, 0] + part["G"][:, 1] - o.node_winners[:, at["G"]]
    assert (part["LBF"][:, 0] == g_loser).all()
    # And only the lower bracket plus the Grand Final actually eliminate.
    assert set(bracket.ELIMINATION_NODES) <= set(bracket.NODES)
    assert not set(bracket.ELIMINATION_NODES) & {"A", "B", "C", "D", "E", "F", "G"}
    print("ok  participation reconstructs from winners; UB losses feed the LB")


def test_rejects_wrong_shape():
    for bad in ([("A", "B")], [("A", "B"), ("A", "C"), ("D", "E"), ("F", "G")]):
        try:
            bracket.simulate(bad, _even, n_sims=10)
        except ValueError:
            continue
        raise AssertionError(f"accepted a malformed bracket: {bad}")
    print("ok  malformed brackets are rejected")


if __name__ == "__main__":
    test_placements_are_consistent()
    test_series_count_range()
    test_grand_final_is_bo5()
    test_stronger_teams_win_more()
    test_node_probabilities_are_coherent()
    test_bracket_picks_optimum_is_legal_and_bounded()
    test_participants_reconstruct_from_winners()
    test_rejects_wrong_shape()
    print("\nall bracket tests passed")
