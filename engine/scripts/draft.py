"""Does the draft change the picks? Measured, per hero and per opponent.

    python -m scripts.draft
    python -m scripts.draft --core PARIVISION --mid "Team Liquid" --support "Team Spirit"

A hero reaches the game only if the opponent declines to ban it and declines to take it
first. Everything else in this project treats a hero pool as a fixed historical
property, which quietly assumes that filter away. Two places it matters:

1. **Coach Title prefixes** key on hero appearance, so a contested pool means a prefix
   that pays less than its measured rate suggests.
2. **Stat lines** are bootstrapped from past games, each on a specific hero. Games on
   heroes this bracket will not allow should count for less.

This prices both against each player's expected opponents in the drawn bracket, then
reports what the correction was actually worth - which is the only way to find out
whether modelling the draft was necessary or merely satisfying.
"""
from __future__ import annotations

import argparse

import numpy as np
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import bracket, draft as draft_mod, pipeline
from dota.config import Config
from dota.fantasy import expected_best_series, recency_weights, weighted_stat_means
from dota.pipeline import SLOT_ROLES
from dota.sources import OpenDota
from dota.titles import Titles
from scripts.fixed_banner import fixed_plan, load_banners
from scripts.main_event import Fit, event_minutes, expected_opponent_rating, team_games
from scripts.titles import base_components

console = Console()
SLOT_LABEL = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Draft availability layer")
    ap.add_argument("--core", default="PARIVISION")
    ap.add_argument("--mid", default="Team Liquid")
    ap.add_argument("--support", default="Team Spirit")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--period-sims", type=int, default=20000)
    ap.add_argument("--group-sims", type=int, default=2000)
    ap.add_argument("--detail-matches", type=int, default=900)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--half-life", type=float, default=60.0)
    ap.add_argument("--event-only", action="store_true", help="fit the draft on TI games only")
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    me = cfg.tournament.main_event
    if me is None:
        raise SystemExit("config/tournament.yaml has no main_event block")
    roster = {"core": args.core, "mid": args.mid, "support": args.support}
    banners = load_banners(scoring=cfg.scoring)
    titles = Titles.load(cfg.scoring, cfg.scoring.coach_equipped)

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

    console.print("[bold]reading pick/ban data from the cached replays ...[/bold]")
    heroes = OpenDota().heroes()
    drafts = draft_mod.load_drafts(OpenDota(), a.corpus.match_ids_used)
    event_ids = {
        m.match_id
        for m in a.corpus.matches
        if (m.league_name or "") == cfg.tournament.name
    }
    model = draft_mod.DraftModel.build(
        a.corpus.matches, drafts, only_match_ids=event_ids if args.event_only else None
    )
    event_model = draft_mod.DraftModel.build(a.corpus.matches, drafts, only_match_ids=event_ids)
    console.print(
        f"[bold]draft corpus:[/bold] {model.matches_seen:,} matches, "
        f"{model.actions:,} pick/ban actions"
        + (" (TI only)" if args.event_only else "")
        + f"; TI alone: {event_model.matches_seen} matches"
    )

    # -- what the event's ban phase looks like -----------------------------
    t = Table(title="Most banned at TI 2026 (share of the event's matches)")
    t.add_column("Hero")
    t.add_column("Banned", justify="right")
    t.add_column("Picked", justify="right")
    t.add_column("Contested", justify="right")
    for hero_id, rate in event_model.most_banned(args.top):
        t.add_row(
            escape(heroes.get(hero_id, str(hero_id))),
            f"{rate:.0%}",
            f"{event_model.picked.get(hero_id, 0) / max(event_model.matches_seen, 1):.0%}",
            f"{event_model.contested.get(hero_id, 0) / max(event_model.matches_seen, 1):.0%}",
        )
    console.print(t)

    # -- per slot: pool availability and the effect on the projection -------
    grand = {"before": 0.0, "after": 0.0}
    for slot, name in roster.items():
        team = cfg.roster.get(name)
        players = [team.by_role(r) for r in SLOT_ROLES[slot]]
        opponents = b.opponent_series.get(name, {})
        pg = team_games(
            cfg,
            a.adjusted_games,
            players,
            fit=fit,
            minutes_to=minutes_to,
            rating_to=expected_opponent_rating(b, a.ratings, name),
        )
        means: dict[str, float] = {}
        for p in players:
            m, _ = weighted_stat_means(pg[p.account_id or -1], game_weight=a.game_weight)
            for k, v in m.items():
                means[k] = means.get(k, 0.0) + v / len(players)
        plan = fixed_plan(f"{slot}/{name}", banners[slot], cfg.scoring, means)
        rows = base_components(players, pg, plan, cfg.scoring)
        if not rows:
            raise SystemExit(f"no joint games sampled for {slot}/{name}")

        flat = titles.flat_suffix_multiplier
        scored = [
            (
                sum(base * titles.game_multiplier(p, g) for p, g, base in comps)
                / len(comps)
                * flat,
                when,
                match_id,
            )
            for match_id, when, comps in rows
        ]
        base_w = recency_weights(scored, game_weight=a.game_weight, half_life_days=args.half_life)
        # One availability per match: the mean over the slot's players in it, since a
        # duo's role score is their average and either hero can be contested.
        avail_by_match = {
            match_id: float(
                np.mean(
                    [
                        model.availability(int(g.hero_id), opponents)
                        if g.hero_id is not None
                        else 1.0
                        for _p, g, _s in comps
                    ]
                )
            )
            for match_id, _when, comps in rows
        }
        draft_w = [w * avail_by_match[mid] for (w, (_s, _t, mid)) in zip(base_w, scored)]

        vals = [s for s, _, _ in scored]
        shapes = b.series_samples.get(name, [])
        deciders = b.decider_samples.get(name, [])
        proj = {}
        for label, weights in (("before", base_w), ("after", draft_w)):
            proj[label] = expected_best_series(
                vals,
                shapes,
                rng=np.random.default_rng(20260820),
                n_sims=args.period_sims,
                weights=weights,
                decider_samples=deciders,
                decider_bonus=titles.decider_bonus,
            )
        grand["before"] += proj["before"]
        grand["after"] += proj["after"]

        # Which of this slot's heroes are most at risk.
        by_hero: dict[int, list[float]] = {}
        for _match_id, _when, comps in rows:
            for _p, g, _s in comps:
                if g.hero_id is not None:
                    by_hero.setdefault(int(g.hero_id), []).append(1.0)
        risky = sorted(
            (
                (hero_id, len(v), model.availability(hero_id, opponents))
                for hero_id, v in by_hero.items()
            ),
            key=lambda r: (r[2], -r[1]),
        )[:6]
        t = Table(
            title=f"{SLOT_LABEL[slot]} - {name}: projection "
            f"{proj['before']:,.0f} -> {proj['after']:,.0f} "
            f"({proj['after'] / proj['before'] - 1:+.2%}) with draft availability"
        )
        t.add_column("Most contested heroes in this pool")
        t.add_column("Games", justify="right")
        t.add_column("P(available)", justify="right")
        for hero_id, n, av in risky:
            t.add_row(escape(heroes.get(hero_id, str(hero_id))), str(n), f"{av:.0%}")
        console.print(t)

    console.print(
        f"[bold]roster {grand['before']:,.0f} -> {grand['after']:,.0f} "
        f"({grand['after'] / grand['before'] - 1:+.2%})[/bold] once each past game is "
        f"weighted by whether this bracket would allow that hero."
    )

    # -- prefixes, with and without the draft filter -----------------------
    pool: dict[str, list] = {}
    weights_plain: dict[str, list[float]] = {}
    weights_draft: dict[str, list[float]] = {}
    for slot, name in roster.items():
        team = cfg.roster.get(name)
        players = [team.by_role(r) for r in SLOT_ROLES[slot]]
        opponents = b.opponent_series.get(name, {})
        games = [g for p in players for g in a.adjusted_games.get(p.account_id or -1, [])]
        latest = max(g.start_time for g in games)
        w = [
            0.5 ** (max((latest - g.start_time).total_seconds() / 86400.0, 0.0) / args.half_life)
            * a.game_weight.get(g.match_id, 1.0)
            for g in games
        ]
        pool[slot] = games
        weights_plain[slot] = w
        weights_draft[slot] = [
            wi * (model.availability(int(g.hero_id), opponents) if g.hero_id else 1.0)
            for g, wi in zip(games, w)
        ]

    all_games = [g for slot in roster for g in pool[slot]]
    all_plain = [w for slot in roster for w in weights_plain[slot]]
    all_draft = [w for slot in roster for w in weights_draft[slot]]
    t = Table(title="PREFIX firing rates, before and after the draft filter")
    t.add_column("Prefix")
    t.add_column("Bonus", justify="right")
    t.add_column("Rate", justify="right")
    t.add_column("Draft-adjusted", justify="right")
    t.add_column("Change", justify="right")
    prefixes = (cfg.scoring.coach_titles or {}).get("prefixes") or {}
    prefix_rows = []
    for pname, row in prefixes.items():
        probe = Titles.load(cfg.scoring, {"prefix": pname, "suffix": None})
        r0 = probe.prefix_rate(all_games, all_plain)
        r1 = probe.prefix_rate(all_games, all_draft)
        prefix_rows.append((pname, row.get("bonus"), r0, r1))
    prefix_rows.sort(key=lambda r: -(r[3] * (r[1] or 0.0)))
    for pname, bonus, r0, r1 in prefix_rows:
        t.add_row(
            escape(pname),
            "?" if bonus is None else f"+{float(bonus):.0%}",
            f"{r0:.1%}",
            f"{r1:.1%}",
            f"{(r1 - r0) * 100:+.1f} pt",
        )
    console.print(t)
    console.print(
        "[dim]Availability is a filter on the hero pool, not a model of the draft as a "
        "game: no first-pick advantage, no counter-picking, and no account of what a "
        "team does once its preferred hero is gone. It also overlaps the patch layer's "
        "hero viability, which asks whether a hero is good rather than whether you get "
        "it.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
