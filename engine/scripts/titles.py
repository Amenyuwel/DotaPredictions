"""Pick the coach Title pair for a roster whose banners are already spent.

    python -m scripts.titles
    python -m scripts.titles --core PARIVISION --mid "Iron Wing" --support "Team Spirit"

Titles are the only free lever left once the roll tokens are gone: one prefix and
one suffix, changeable at no cost, each a conditional percentage on a player's
**per-game** score. That makes them worth optimising properly rather than picking
by the largest printed number, for two reasons:

* **The best prefix is a property of the roster, not of the game.** Prefixes key on
  hero appearance, so their value is the share of *these players'* games on a hero
  carrying the tag. That share swings from 1% to 36% across the field, which moves a
  prefix's worth by an order of magnitude. The biggest bonus on the list is
  routinely the wrong pick.
* **Two suffixes are traps.** `the Underdog` pays on losses and `the Decisive` on
  short games -- conditions correlated with the score itself. Under an E[max]
  objective, a bonus that fires on your worst games is close to worthless, and no
  `bonus x rate` calculation can see that. Both are applied per game here, so the
  correlation is priced instead of assumed away.

Every rate below is measured on this roster's own sampled games, not taken from the
static table in `config/scoring.yaml`.
"""
from __future__ import annotations

import argparse

import numpy as np
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, pipeline
from dota.banner import banner_score_for_game
from dota.config import Config, Player
from dota.fantasy import expected_best_series, recency_weights
from dota.pipeline import SLOT_ROLES
from dota.sources.base import PlayerGame
from dota.titles import DECIDER_SUFFIX, SUFFIX_CONDITIONS, Titles
from scripts.fixed_banner import fixed_plan, load_banners
from scripts.main_event import (
    Fit,
    apply_rerolls,
    event_minutes,
    expected_opponent_rating,
    team_games,
)
from dota.fantasy import weighted_stat_means

console = Console()
SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}


def base_components(
    players: list[Player],
    pg: dict[int, list[PlayerGame]],
    plan,
    scoring,
) -> list[tuple[int, object, list[tuple[Player, PlayerGame, float]]]]:
    """Per-match banner scores, before any Title multiplier.

    Computed once so a grid of 80 Title pairs costs 80 cheap re-weightings instead
    of 80 full re-scorings of every stat line.
    """
    by_match: dict[int, dict[str, PlayerGame]] = {}
    for p in players:
        for g in pg.get(p.account_id or -1, []):
            by_match.setdefault(g.match_id, {})[p.key] = g
    rows = []
    for match_id, seen in by_match.items():
        if len(seen) != len(players):
            continue
        comps = [
            (p, seen[p.key], banner_score_for_game(plan, seen[p.key].stats, scoring))
            for p in players
        ]
        rows.append((match_id, next(iter(seen.values())).start_time, comps))
    rows.sort(key=lambda r: r[1])
    return rows


def project(rows, titles: Titles, shapes, deciders, gw, half_life, n_sims, seed) -> float:
    """E[best series] for one slot under one Title pair."""
    flat = titles.flat_suffix_multiplier
    scored = []
    for match_id, when, comps in rows:
        s = sum(base * titles.game_multiplier(p, g) for p, g, base in comps) / len(comps)
        scored.append((s * flat, when, match_id))
    if not scored:
        return 0.0
    weights = recency_weights(scored, game_weight=gw, half_life_days=half_life)
    return expected_best_series(
        [s for s, _, _ in scored],
        shapes,
        rng=np.random.default_rng(seed),
        n_sims=n_sims,
        weights=weights,
        decider_samples=deciders,
        decider_bonus=titles.decider_bonus,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Coach Title optimiser")
    ap.add_argument("--core", default="PARIVISION")
    ap.add_argument("--mid", default="Iron Wing")
    ap.add_argument("--support", default="Team Spirit")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--period-sims", type=int, default=6000)
    ap.add_argument("--group-sims", type=int, default=2000)
    ap.add_argument("--detail-matches", type=int, default=900)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--half-life", type=float, default=60.0)
    ap.add_argument("--reroll", action="append", default=[])
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")
    roster = {"core": args.core, "mid": args.mid, "support": args.support}
    for slot, name in roster.items():
        if name not in me.teams:
            raise SystemExit(
                f"{name!r} is not in the Main Event field: {sorted(me.teams)}"
            )

    banners = load_banners()
    apply_rerolls(cfg, banners, args.reroll)

    a = pipeline.analyse(
        cfg,
        n_sims=args.group_sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        top_rosters=1,
        verbose=True,
    )
    fit = Fit.from_reports(a.factor_reports)
    minutes_to = event_minutes(a.corpus, cfg.tournament.name)
    b = bracket.simulate(
        me.pairings,
        a.ratings.win_prob,
        n_sims=args.sims,
        best_of=me.best_of,
        final_best_of=me.final_best_of,
    )

    # One restated, pre-scored corpus per slot.
    prepared = {}
    pool_games: dict[str, list[PlayerGame]] = {}
    pool_weights: dict[str, list[float]] = {}
    pool_at_event: dict[str, list[PlayerGame]] = {}
    # Games played at the event itself. A prefix keys on the hero, and a hero pool is
    # not stationary: the patch, the opposition and the ban phase all differ at a LAN
    # from the six months before it, so the event's own games are reported separately
    # even though they are a small sample.
    event_matches = {
        m.match_id
        for m in a.corpus.matches
        if (m.league_name or "") == cfg.tournament.name
    }
    for slot, name in roster.items():
        team = cfg.roster.get(name)
        players = [team.by_role(r) for r in SLOT_ROLES[slot]]
        opp = expected_opponent_rating(b, a.ratings, name)
        pg = team_games(
            cfg,
            a.adjusted_games,
            players,
            fit=fit,
            minutes_to=minutes_to,
            rating_to=opp,
        )
        combined: dict[str, float] = {}
        for p in players:
            m, _ = weighted_stat_means(pg[p.account_id or -1], game_weight=a.game_weight)
            for k, v in m.items():
                combined[k] = combined.get(k, 0.0) + v / len(players)
        plan = fixed_plan(f"{slot}/{name}", banners[slot], cfg.scoring, combined)
        rows = base_components(players, pg, plan, cfg.scoring)
        if not rows:
            raise SystemExit(f"no joint games sampled for {slot}/{name}")
        prepared[slot] = (
            rows,
            b.series_samples.get(name, []),
            b.decider_samples.get(name, []),
        )
        pool_games[slot] = [g for _p, g, _s in (c for _m, _w, comps in rows for c in comps)]
        # The same weights the projection draws with, so a reported firing rate
        # explains the gain printed beside it rather than contradicting it.
        latest = max(g.start_time for g in pool_games[slot])
        pool_weights[slot] = [
            0.5 ** (max((latest - g.start_time).total_seconds() / 86400.0, 0.0) / args.half_life)
            * a.game_weight.get(g.match_id, 1.0)
            for g in pool_games[slot]
        ]
        pool_at_event[slot] = [g for g in pool_games[slot] if g.match_id in event_matches]

    def total(prefix: str | None, suffix: str | None) -> tuple[float, dict[str, float]]:
        t = Titles.load(cfg.scoring, {"prefix": prefix, "suffix": suffix})
        per_slot = {
            slot: project(
                rows,
                t,
                shapes,
                deciders,
                a.game_weight,
                args.half_life,
                args.period_sims,
                20260820,
            )
            for slot, (rows, shapes, deciders) in prepared.items()
        }
        return sum(per_slot.values()), per_slot

    console.print(
        f"[bold]roster:[/bold] cores {escape(args.core)}, mid {escape(args.mid)}, "
        f"supports {escape(args.support)}"
    )
    baseline, _slots = total(None, None)
    console.print(f"[bold]no titles:[/bold] {baseline:,.0f}")

    titles_cfg = cfg.scoring.coach_titles or {}
    prefixes = titles_cfg.get("prefixes") or {}
    suffixes = titles_cfg.get("suffixes") or {}

    # -- prefixes, priced on this roster's own hero pool -------------------
    t = Table(
        title="PREFIXES on this roster - firing rates on THESE players' hero pools, "
        f"weighted as the projection weights them ({args.half_life:.0f}d half-life)"
    )
    t.add_column("Prefix")
    t.add_column("Bonus", justify="right")
    t.add_column("Tags")
    for slot in ("core", "mid", "support"):
        t.add_column(SLOT_LABEL[slot], justify="right")
    t.add_column("Roster", justify="right")
    t.add_column("At TI only", justify="right")
    t.add_column("Gain", justify="right")
    prefix_rows = []
    for name, row in prefixes.items():
        probe = Titles.load(cfg.scoring, {"prefix": name, "suffix": None})
        rates = {
            slot: probe.prefix_rate(pool_games[slot], pool_weights[slot])
            for slot in roster
        }
        all_games = [g for slot in roster for g in pool_games[slot]]
        all_weights = [w for slot in roster for w in pool_weights[slot]]
        overall = probe.prefix_rate(all_games, all_weights)
        at_event = [g for slot in roster for g in pool_at_event[slot]]
        event_rate = probe.prefix_rate(at_event) if at_event else None
        bonus = None if row.get("bonus") is None else float(row["bonus"])
        gain = 0.0 if bonus is None else total(name, None)[0] - baseline
        prefix_rows.append((name, bonus, probe, rates, overall, event_rate, gain))
    prefix_rows.sort(key=lambda r: -r[6])
    for name, bonus, probe, rates, overall, event_rate, gain in prefix_rows:
        t.add_row(
            escape(name),
            "?" if bonus is None else f"+{bonus:.0%}",
            escape("/".join(sorted(probe.prefix_tags))),
            *[f"{rates[s]:.0%}" for s in ("core", "mid", "support")],
            f"{overall:.0%}",
            "-" if event_rate is None else f"{event_rate:.0%}",
            "[dim]bonus unknown[/dim]" if bonus is None else f"[bold]{gain:+,.0f}[/bold]",
        )
    console.print(t)
    n_event = sum(len(v) for v in pool_at_event.values())
    console.print(
        f"[dim]'At TI only' is {n_event} player-games from this event, unweighted -- a "
        f"different patch, a different field and a live ban phase, but a small sample "
        f"(a rate near 15% carries about +-4 points of standard error at that size). "
        f"Where it disagrees with the weighted column, the prefix is not resolved.[/dim]"
    )

    # -- suffixes, measured rather than assumed ---------------------------
    t = Table(title="SUFFIXES (rate measured on this roster's games, not the config)")
    t.add_column("Suffix")
    t.add_column("Bonus", justify="right")
    t.add_column("How it is applied")
    t.add_column("Measured rate", justify="right")
    t.add_column("Config p", justify="right")
    t.add_column("Gain", justify="right")
    suffix_rows = []
    for name, row in suffixes.items():
        probe = Titles.load(cfg.scoring, {"prefix": None, "suffix": name})
        if name == DECIDER_SUFFIX:
            flags = [f for _s, _sh, dec in prepared.values() for f in dec]
            rate = (
                sum(sum(f) for f in flags) / max(sum(len(f) for f in flags), 1)
                if flags
                else None
            )
            how = "per game, on series deciders"
        elif name in SUFFIX_CONDITIONS:
            rate = probe.measured_suffix_rate(
                [g for slot in roster for g in pool_games[slot]]
            )
            how = "per game, condition measured"
        else:
            rate = None
            how = "flat bonus x config p (no data)"
        got, _ = total(None, name)
        suffix_rows.append(
            (name, float(row.get("bonus") or 0.0), how, rate, row.get("p"), got - baseline)
        )
    suffix_rows.sort(key=lambda r: -r[5])
    for name, bonus, how, rate, p_cfg, gain in suffix_rows:
        t.add_row(
            escape(name),
            f"+{bonus:.0%}",
            how,
            "-" if rate is None else f"{rate:.1%}",
            "-" if p_cfg is None else f"{float(p_cfg):.1%}",
            f"[bold]{gain:+,.0f}[/bold]",
        )
    console.print(t)

    # -- the grid ---------------------------------------------------------
    priced_prefixes = [r[0] for r in prefix_rows if r[1] is not None]
    combos = []
    for pname in priced_prefixes:
        for sname in suffixes:
            got, per_slot = total(pname, sname)
            combos.append((pname, sname, got, per_slot))
    combos.sort(key=lambda r: -r[2])

    equipped = cfg.scoring.coach_equipped or {}
    eq_pair = (equipped.get("prefix"), equipped.get("suffix"))
    t = Table(title=f"BEST PAIRS ({len(combos)} evaluated)")
    t.add_column("#", justify="right")
    t.add_column("Prefix")
    t.add_column("Suffix")
    t.add_column("Cores", justify="right")
    t.add_column("Mid", justify="right")
    t.add_column("Supports", justify="right")
    t.add_column("Total", justify="right")
    t.add_column("vs no titles", justify="right")
    best = combos[0][2]
    shown = list(range(min(args.top, len(combos))))
    eq_idx = next(
        (i for i, c in enumerate(combos) if (c[0], c[1]) == eq_pair), None
    )
    if eq_idx is not None and eq_idx not in shown:
        shown.append(eq_idx)
    for i in shown:
        pname, sname, got, per_slot = combos[i]
        mark = " [magenta](equipped)[/magenta]" if (pname, sname) == eq_pair else ""
        gap = "" if i == 0 else f"  ({got / best - 1:+.2%})"
        t.add_row(
            str(i + 1),
            escape(pname) + mark,
            escape(sname),
            f"{per_slot['core']:,.0f}",
            f"{per_slot['mid']:,.0f}",
            f"{per_slot['support']:,.0f}",
            f"[bold]{got:,.0f}[/bold]{gap}",
            f"{got / baseline - 1:+.1%}",
        )
    console.print(t)

    if eq_idx is not None:
        pname, sname, got, _ = combos[eq_idx]
        console.print(
            f"[bold]equipped {pname} / {sname}[/bold] ranks {eq_idx + 1} of "
            f"{len(combos)}, {got - best:+,.0f} ({got / best - 1:+.2%}) against the best pair."
        )
    console.print(
        "[dim]Prefix and suffix multipliers are assumed to multiply. Rates are "
        "measured on ~80-110 sampled games per slot, so a rate near 5% is itself "
        "uncertain; treat differences under a few hundred points as ties.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
