"""Pick players for banners you have already rolled.

    python -m scripts.fixed_banner

Until the rolls are spent, the question is "which duo has the best achievable
banner". Afterwards it inverts completely: the three emblems are frozen, they
are the *only* stats that score, and the one remaining choice is which team
stands behind them. A duo that topped the ideal-banner ranking can rank badly
here, because the ideal ranking assumed emblems fitted to that duo's strengths
and these emblems are fitted to nobody's.

Reads the rolled banners from `config/banners.yaml` and every team's
factor-corrected stat lines from the main pipeline, then scores all 16 teams in
each slot through the fixed emblems.
"""
from __future__ import annotations

import argparse

import numpy as np
import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota import emblems as emblems_mod
from dota import pipeline
from dota.banner import BannerPlan, EmblemChoice
from dota.config import CONFIG_DIR, Config, Scoring
from dota.fantasy import expected_best_series, role_game_scores, weighted_stat_means
from dota.optimize import enumerate_fantasy_rosters
from dota.pipeline import SLOT_ROLES

console = Console()


def load_banners(path=None, scoring: Scoring | None = None) -> dict[str, dict[str, float]]:
    """slot -> {stat: multiplier}, from either banners.yaml form.

    The file now lists emblems with their tier, trait and on-banner position, since
    two traits are positional and order is a free choice. This flattens that back
    to the {stat: multiplier} mapping the scoring path wants, preferring the
    percentage the client actually displays and deriving it from tier + trait +
    neighbours only when the transcription omits it. The two are checked against
    each other in tests/test_emblems.py.
    """
    path = path or CONFIG_DIR / "banners.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, dict[str, float]] = {}
    for slot in ("core", "mid", "support"):
        block = raw.get(slot) or {}
        rows = block.get("emblems") if isinstance(block, dict) else None
        if rows:
            banner = [
                emblems_mod.Emblem(
                    stat=str(r["stat"]),
                    tier=str(r["tier"]),
                    trait=str(r["trait"]),
                    displayed=None if r.get("displayed") is None else float(r["displayed"]),
                )
                for r in rows
            ]
            derived = (
                emblems_mod.multipliers(banner, scoring)
                if scoring is not None
                else [None] * len(banner)
            )
            spec: dict[str, float] = {}
            for e, d in zip(banner, derived):
                mult = e.displayed if e.displayed is not None else d
                if mult is None:
                    raise SystemExit(
                        f"config/banners.yaml: {slot}/{e.stat} has no displayed "
                        f"percentage and no Scoring was supplied to derive one"
                    )
                spec[e.stat] = float(mult)
            out[slot] = spec
        else:
            # Legacy flat form: {stat: multiplier}.
            out[slot] = {
                str(k): float(v)
                for k, v in (block or {}).items()
                if not isinstance(v, (dict, list))
            }
    return out


def fixed_plan(
    key: str, spec: dict[str, float], scoring: Scoring, means: dict[str, float]
) -> BannerPlan:
    """A BannerPlan carrying exactly the rolled emblems and their multipliers."""
    from dota.banner import STAT_SOURCE

    plan = BannerPlan(player_key=key)
    for i, (stat_key, mult) in enumerate(spec.items()):
        stat = scoring.stats.get(stat_key)
        if stat is None:
            raise SystemExit(f"config/banners.yaml: unknown stat {stat_key!r}")
        value = means.get(STAT_SOURCE.get(stat_key, ""), 0.0)
        # Slot by index, not colour: the client allows repeated colours and this
        # dict is only a container once the emblems are fixed.
        plan.choices[f"{i}:{stat_key}"] = EmblemChoice(
            color=stat.color,
            stat=stat,
            per_game_value=value,
            base_points=stat.points(value),
            multiplier=mult,
        )
    return plan


def main() -> int:
    ap = argparse.ArgumentParser(description="Score teams against rolled banners")
    ap.add_argument("--sims", type=int, default=50000)
    ap.add_argument("--detail-matches", type=int, default=833)
    ap.add_argument("--history-days", type=int, default=180)
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()
    load_dotenv()

    cfg = Config()
    banners = load_banners()
    a = pipeline.analyse(
        cfg,
        n_sims=args.sims,
        history_days=args.history_days,
        detail_matches=args.detail_matches,
        top_rosters=1,
        verbose=True,
    )
    games, gw = a.adjusted_games, a.game_weight
    rng = np.random.default_rng(20260813)

    slots: dict[str, object] = {}
    per_slot_rows: dict[str, list] = {}

    for slot, roles in SLOT_ROLES.items():
        spec = banners[slot]
        rows = []
        for team in cfg.roster.teams:
            players = [team.by_role(r) for r in roles]
            combined: dict[str, float] = {}
            for p in players:
                m, _ = weighted_stat_means(
                    games.get(p.account_id or -1, []), game_weight=gw
                )
                for k, v in m.items():
                    combined.setdefault(k, 0.0)
                    combined[k] += v / len(players)

            plan = fixed_plan(f"{slot}/{team.name}", spec, cfg.scoring, combined)
            per_player = {p.key: plan for p in players}
            scored = role_game_scores(players, games, per_player, cfg.scoring)
            if not scored:
                continue
            vals = [s for s, _, _ in scored]
            wts = [gw.get(mid, 1.0) for _, _, mid in scored] if gw else None
            proj = expected_best_series(
                vals,
                a.outcome.series_samples.get(team.name, []),
                rng=np.random.default_rng(20260813),
                weights=wts,
            )
            contrib = {
                c.stat.key: c.stat.points(c.per_game_value) * c.multiplier
                for c in plan.choices.values()
            }
            rows.append((team.name, players, proj, float(np.mean(vals)), len(vals), contrib))

        rows.sort(key=lambda r: -r[2])
        per_slot_rows[slot] = rows
        for name, _players, proj, mean, n, _c in rows:
            slots[f"{slot}/{name}"] = _Shim(slot, name, proj)

        label = {"core": "CORE", "mid": "MID", "support": "SUPPORT"}[slot]
        spec_str = ", ".join(f"{k} x{v:.2f}" for k, v in spec.items())
        t = Table(title=f"{label} banner ({spec_str}) - every team scored")
        t.add_column("#", justify="right")
        t.add_column("Team")
        t.add_column("Players")
        t.add_column("Per game", justify="right")
        t.add_column("Best series", justify="right")
        t.add_column("Sample", justify="right")
        t.add_column("Where the points come from")
        for i, (name, players, proj, mean, n, contrib) in enumerate(rows[: args.top], 1):
            share = ", ".join(
                f"{k.replace('_', ' ')} {v:,.0f}"
                for k, v in sorted(contrib.items(), key=lambda kv: -kv[1])
            )
            t.add_row(
                str(i),
                escape(name),
                escape(" + ".join(p.nick for p in players)),
                f"{mean:,.0f}",
                f"[bold]{proj:,.0f}[/bold]",
                f"{n}m",
                escape(share),
            )
        console.print(t)

    best = enumerate_fantasy_rosters(
        cfg.roster, slots, distinct_teams=cfg.tournament.fantasy_distinct_teams,
        top_n=args.top,
    )
    t = Table(title="Best rosters for YOUR rolled banners")
    t.add_column("#", justify="right")
    t.add_column("Supports")
    t.add_column("Cores")
    t.add_column("Mid")
    t.add_column("Projected", justify="right")
    for i, r in enumerate(best, 1):
        t.add_row(
            str(i),
            escape(r.support_team),
            escape(r.core_team),
            escape(f"{r.mid_player} ({r.mid_team})"),
            f"{r.projected_total:,.0f}",
        )
    console.print(t)
    return 0


class _Shim:
    """Minimal stand-in so enumerate_fantasy_rosters can consume these."""

    def __init__(self, slot: str, team: str, projected: float):
        self.slot = slot
        self.team = team
        self.projected = projected


if __name__ == "__main__":
    raise SystemExit(main())
