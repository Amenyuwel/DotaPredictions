"""Read Valve's per-hero `Adjectives` tags out of the Dota 2 client and write
`config/hero_adjectives.yaml`.

    python -m scripts.extract_hero_adjectives
    python -m scripts.extract_hero_adjectives --dota "D:/SteamLibrary/.../dota 2 beta"

Why this exists: the coach-title PREFIXES key on hero appearance -- Cerulean on
blue heroes, Royal on purple, Heroic on caped or masked ones. Valve publishes no
such mapping, OpenDota does not expose one, and no community site has it either.
But the client ships it: every hero in `scripts/npc/npc_heroes.txt` carries an
`Adjectives` block, and the fantasy prefixes read straight off those flags.

The file lives inside `pak01_dir.vpk`, so this module contains a small Source 2
VPK reader. Nothing is modified -- the archive is opened read-only.

Re-run after a Dota 2 patch that adds a hero.
"""
from __future__ import annotations

import argparse
import os
import re
import struct
import sys
from pathlib import Path

import yaml

from dota.config import CONFIG_DIR

DEFAULT_DOTA_DIRS = (
    r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta",
    r"D:\SteamLibrary\steamapps\common\dota 2 beta",
    r"E:\SteamLibrary\steamapps\common\dota 2 beta",
)

# Which `Adjectives` flags each CHANGE TITLES prefix reads. Transcribed from the
# client's own wording; the flag names are Valve's.
PREFIX_TAGS = {
    "Cerulean": ["Blue"],
    "Royal": ["Purple"],
    "Heroic": ["Cape", "Mask", "Masked"],
    "Golden": ["Yellow", "Brown"],
    "Elemental": ["Aquatic", "Fiery", "Icy"],
    "Otherworldly": ["Undead", "Demon", "Spirit"],
    "Crimson": ["Red"],
    "Emerald": ["Green"],
    "Bestial": ["Horns", "Wings"],
    "Hirsute": ["Bearded", "Fuzzy"],
}


# -- minimal Source 2 VPK reader -------------------------------------------
def _cstr(buf: bytes, pos: int) -> tuple[str, int]:
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("utf-8", "replace"), end + 1


def read_tree(dir_vpk: Path) -> dict[str, tuple[int, int, int, bytes]]:
    with open(dir_vpk, "rb") as fh:
        sig, ver, tree_size = struct.unpack("<III", fh.read(12))
        if sig != 0x55AA1234:
            raise SystemExit(f"{dir_vpk} is not a VPK (magic {sig:#x})")
        if ver == 2:
            fh.read(16)
        tree = fh.read(tree_size)

    entries: dict[str, tuple[int, int, int, bytes]] = {}
    pos = 0
    while True:
        ext, pos = _cstr(tree, pos)
        if not ext:
            break
        while True:
            folder, pos = _cstr(tree, pos)
            if not folder:
                break
            while True:
                name, pos = _cstr(tree, pos)
                if not name:
                    break
                _crc, preload, arch, offset, length = struct.unpack_from(
                    "<IHHII", tree, pos
                )
                pos += 18  # 16 fields + 2 terminator
                pre = tree[pos:pos + preload]
                pos += preload
                path = f"{folder}/{name}.{ext}" if folder != " " else f"{name}.{ext}"
                entries[path] = (arch, offset, length, pre)
    return entries


def extract(dir_vpk: Path, entries: dict, name: str) -> bytes:
    arch, offset, length, pre = entries[name]
    if arch == 0x7FFF:
        with open(dir_vpk, "rb") as fh:
            _sig, ver, tree_size = struct.unpack("<III", fh.read(12))
            base = 12 + (16 if ver == 2 else 0) + tree_size
            fh.seek(base + offset)
            return pre + fh.read(length)
    side = dir_vpk.with_name(dir_vpk.name.replace("_dir.vpk", f"_{arch:03d}.vpk"))
    with open(side, "rb") as fh:
        fh.seek(offset)
        return pre + fh.read(length)


# -- npc_heroes.txt --------------------------------------------------------
def parse_heroes(text: str) -> dict[str, dict]:
    """npc name -> {'id': int, 'tags': [str]}, from the Adjectives blocks."""
    out: dict[str, dict] = {}
    current: str | None = None
    in_adj = False
    depth = 0
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r'^"(npc_dota_hero_\w+)"', s)
        if m:
            current = m.group(1)
            out.setdefault(current, {"id": None, "tags": []})
            continue
        if current is None:
            continue
        m = re.match(r'^"HeroID"\s+"(\d+)"', s)
        if m:
            out[current]["id"] = int(m.group(1))
            continue
        if re.match(r'^"Adjectives"', s):
            in_adj, depth = True, 0
            continue
        if in_adj:
            if s.startswith("{"):
                depth += 1
            elif s.startswith("}"):
                depth -= 1
                if depth <= 0:
                    in_adj = False
            else:
                kv = re.match(r'^"(\w+)"\s+"(-?\d+)"', s)
                # Legs/Nose are counts, not flags; everything else is 0/1.
                if kv and int(kv.group(2)) > 0 and kv.group(1) not in ("Legs", "Nose"):
                    out[current]["tags"].append(kv.group(1))
    return {k: v for k, v in out.items() if v["id"] and v["tags"]}


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract Valve hero adjective tags")
    ap.add_argument("--dota", help="path to the 'dota 2 beta' folder")
    args = ap.parse_args()

    roots = [Path(args.dota)] if args.dota else [Path(p) for p in DEFAULT_DOTA_DIRS]
    dir_vpk = None
    for r in roots:
        cand = r / "game" / "dota" / "pak01_dir.vpk"
        if cand.exists():
            dir_vpk = cand
            break
    if dir_vpk is None:
        raise SystemExit(
            "Dota 2 install not found. Pass --dota <path to 'dota 2 beta'>.\n"
            "Looked in:\n  " + "\n  ".join(str(r) for r in roots)
        )

    print(f"[vpk] {dir_vpk}")
    entries = read_tree(dir_vpk)
    raw = extract(dir_vpk, entries, "scripts/npc/npc_heroes.txt")
    heroes = parse_heroes(raw.decode("utf-8", "replace"))
    print(f"[vpk] {len(heroes)} heroes with adjective tags")

    by_id = {
        v["id"]: {"npc": k.replace("npc_dota_hero_", ""), "tags": sorted(v["tags"])}
        for k, v in sorted(heroes.items())
    }
    counts: dict[str, int] = {}
    for v in by_id.values():
        for t in v["tags"]:
            counts[t] = counts.get(t, 0) + 1

    path = CONFIG_DIR / "hero_adjectives.yaml"
    header = (
        "# Valve's per-hero appearance tags, extracted from the Dota 2 client's\n"
        "# scripts/npc/npc_heroes.txt (inside pak01_dir.vpk) by\n"
        "# `python -m scripts.extract_hero_adjectives`. DO NOT HAND-EDIT.\n"
        "#\n"
        "# These are the ground truth behind the coach-title PREFIXES: Cerulean\n"
        "# pays on a blue hero, Royal on a purple one, Heroic on a caped or masked\n"
        "# one. The mapping is published nowhere else -- not on OpenDota, not on\n"
        "# any community site -- but the client ships it.\n"
        "#\n"
        "# Heroes carry more than one tag: Sven is Blue AND Red, Muerta is Blue AND\n"
        "# Green, Abaddon is Blue AND Purple. A prefix fires if ANY of its tags\n"
        "# match, so the categories overlap and do not sum to the hero pool.\n"
        "#\n"
        "# Re-run after any patch that adds a hero.\n"
    )
    blob = {
        "source": "npc_heroes.txt Adjectives block, Dota 2 client",
        "prefix_tags": PREFIX_TAGS,
        "tag_counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "heroes": by_id,
    }
    path.write_text(
        header + yaml.safe_dump(blob, sort_keys=False, width=100), encoding="utf-8"
    )
    print(f"[out] {path}")

    for label, tags in PREFIX_TAGS.items():
        n = sum(1 for v in by_id.values() if set(v["tags"]) & set(tags))
        print(f"   {label:14s} {'|'.join(tags):28s} {n:3d} heroes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
