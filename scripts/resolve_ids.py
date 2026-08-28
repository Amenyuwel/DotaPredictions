"""Map config/teams.yaml onto OpenDota IDs, roster-scoped.

    python -m scripts.resolve_ids

Writes data/resolved_ids.json. Everything unresolved or fuzzy is printed --
pin those in config/overrides.yaml and rerun. Do not skip this: a silently
wrong account_id produces confident, wrong projections.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from dota.config import CONFIG_DIR, DATA_DIR, Roster
from dota.resolve import problems, resolve, to_json
from dota.sources import OpenDota

console = Console()

COLOURS = {
    "exact": "green",
    "override": "cyan",
    "alias": "yellow",
    "fuzzy": "magenta",
    "unresolved": "red",
}


def load_overrides() -> dict:
    path = Path(CONFIG_DIR) / "overrides.yaml"
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def main() -> int:
    load_dotenv()
    roster = Roster.load()
    matches = resolve(roster, OpenDota(), load_overrides())

    for m in matches:
        title = f"{escape(m.config_name)}"
        if m.opendota_name and m.opendota_name != m.config_name:
            title += f"  [dim](OpenDota: {escape(m.opendota_name)})[/dim]"
        title += f"  team_id={m.team_id}"
        t = Table(title=title, title_justify="left", show_edge=False, pad_edge=False)
        t.add_column("Role")
        t.add_column("Config nick")
        t.add_column("OpenDota")
        t.add_column("account_id", justify="right")
        t.add_column("How")
        for p in m.players:
            colour = COLOURS.get(p.confidence, "white")
            t.add_row(
                p.role,
                escape(p.nick),
                escape(p.opendota_name or "-"),
                str(p.account_id or "-"),
                f"[{colour}]{p.confidence}[/{colour}]"
                + (f" [dim]{escape(p.note)}[/dim]" if p.note else ""),
            )
        console.print(t)
        if m.note:
            console.print(f"  [yellow]note:[/yellow] {escape(m.note)}")
        console.print()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "resolved_ids.json"
    path.write_text(json.dumps(to_json(matches), indent=2), encoding="utf-8")
    console.print(f"wrote {path}")

    blocking, notes = problems(matches)
    if notes:
        console.print("\n[dim]notes:[/dim]")
        for n in notes:
            console.print(f"  [dim]- {escape(n)}[/dim]")
    if blocking:
        console.print(
            f"\n[bold red]{len(blocking)} blocking issue(s)[/bold red] - pin them "
            "in config/overrides.yaml, then rerun:"
        )
        for i in blocking:
            console.print(f"  - {escape(i)}")
        return 1
    total = sum(len(m.players) for m in matches)
    console.print(
        f"\n[bold green]all {len(matches)} teams and {total} players "
        f"resolved[/bold green]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
