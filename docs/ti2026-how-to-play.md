# TI 2026 Fantasy — HOW TO PLAY, transcribed from the client

Source: Dota 2 client → Compendium → Fantasy → **HOW TO PLAY**, captured 2026-08-02.
This is the authoritative reference. Do not re-screenshot it — correct this file if
Valve changes the numbers.

Everything here has been cross-checked against `config/scoring.yaml`. **All values
match.** `verified_against_client: true` in that file is accurate.

---

## Scoring chain

> Once matches for a period begin, a snapshot of your roster is saved and used for
> scoring. For each role, each player's score is calculated individually in every game
> they participate in. Players receive points only for the stats present on their War
> Banner, amplified if any of the conditions of your coach Titles are met. We then
> average the score of all players for a role and use that to decide the final score
> for a game. The top two scoring games within a series are used to get the role's
> final score for the match. If a role participates in more than one series in a
> period, the best scoring series will be used.

Formally:

```
per game    = sum of the player's banner stats  x emblem multipliers
                                                x coach Title multipliers (conditional)
per role    = AVERAGE across the players in that role (2 for core/support, 1 for mid)
per series  = sum of the TOP TWO games in the series
per period  = the BEST series
```

Three consequences the model is built around:

- The objective is `E[max]`, not `mean x games`. **Variance is an asset.**
- A roster **snapshot** is taken at period start — later roster edits do not apply.
- Coach Titles multiply the *per-game* score, so their value is
  `bonus x P(the best game satisfies the condition)`, not `bonus x P(condition)`.

---

## Emblem stats — which stat can appear on which colour

> Which fantasy stat an emblem could be is controlled by the emblem's color.
> **Rerolling the stat of an emblem will guarantee a new stat** and there are
> **no duplicate stats on a War Banner.**

| Colour | Stats |
|---|---|
| **RED** | Kills, Deaths, Creep Score, GPM, Madstone Collected, Tower Kills |
| **BLUE** | Wards Placed, Camps Stacked, Runes Grabbed, Watchers Taken, Smokes Used, Lotuses Grabbed |
| **GREEN** | Roshan Kills, Teamfight Participation, Stuns, Tormentor Kills, First Blood, Courier Kills |

Two mechanical facts worth pinning:

1. **Emblem stats ARE rerollable**, and a reroll is guaranteed to change the stat.
   So a dead emblem (Courier Kills on a core, Lotuses on anyone) is always fixable —
   the "best banner" question is a real choice, not a hand you are dealt.
2. **No duplicate stats on one banner.** A banner may carry more than one emblem of
   the same *colour* (observed in the client: a Core banner with two reds), but never
   the same stat twice.

---

## Base points per stat

| Stat | Colour | Value |
|---|---|---|
| Kills | red | +107.00 per kill |
| Deaths | red | **1,950.00 starting points, −195.00 per death** |
| Creep Score | red | +3.00 per last hit or deny |
| GPM | red | player's GPM × 2.00 |
| Madstone Collected | red | +13.00 per Madstone collected |
| Tower Kills | red | +352.00 per Tower last hit |
| Wards Placed | blue | +117.00 per observer ward placed |
| Camps Stacked | blue | +234.00 per camp stacked |
| Runes Grabbed | blue | +141.00 per rune bottled or taken |
| Watchers Taken | blue | +147.00 per captured watcher |
| Lotuses Grabbed | blue | +176.00 per lotus taken |
| Smokes Used | blue | +293.00 per Smoke of Deceit used |
| Roshan Kills | green | +1,172.00 per Roshan kill |
| Teamfight Participation | green | max 2,124.00 points for participating in team fights |
| Stuns | green | +10.00 per second of stun |
| Tormentor Kills | green | +879.00 per Tormentor kill |
| Courier Kills | green | +703.00 per Courier kill |
| First Blood | green | 1,934.00 points if the player gets first blood |

Note the scale spread: Creep Score pays 3 per unit, Roshan 1,172. Raw rates are
meaningless until multiplied through — a carry's 580 last hits is worth 1,740 points,
their 0.8 Roshan kills is worth 940. Rate alone ranks those the other way round.

`Deaths` is the odd one: a near-constant ~1,950 minus a small number. High floor,
no ceiling. Under an `E[max]` objective that is a real cost, so it does not always
win red despite usually having the highest mean.

---

## Emblem quality

> Higher qualities amplify the benefit you receive from different stats. Qualities
> with a larger boost are more rare when crafting.

| Tier | Boost to the emblem's base fantasy stat score |
|---|---|
| Tier I | +10% |
| Tier II | +30% |
| Tier III | +60% |
| Tier IV | +100% |
| Tier V | +150% |

---

## Emblem traits

> Traits amplify the stat bonus of emblems, sometimes dependent on certain
> conditions. Rerolling a trait will guarantee a different trait for that emblem.

| Trait | Effect |
|---|---|
| **Fractal** | +60% to the stat bonus **if all emblem qualities on the War Banner are different** |
| **Benevolent** | Provides a **20% bonus to the stat value of adjacent emblems** (nothing to itself) |
| **Vampiric** | +50% to this emblem's stat value, **−10% to adjacent emblems** |
| **Unique** | +30% to the stat bonus **if this is the only Unique emblem on the banner** |
| **Friendly** | +50% to the stat bonus **if there are at least 3 Friendly emblems on the banner** |

Displayed emblem percentage = `100 + quality% + trait%`.

Benevolent and Vampiric are **positional** — they act on adjacent emblems, so emblem
order on the banner matters for those two and only those two. The model does not
currently optimise emblem ordering.

---

## Coach Titles

A prefix and a suffix, each a conditional % on the per-game score. Free to change,
no roll tokens. One pair applies to the whole roster. Measured firing rates live in
`config/scoring.yaml → coach.titles`.

The dialog offers **8 prefixes and 8 suffixes**, drawn from a much larger pool in the
game files (18 and 21 respectively) — so a reroll can surface titles you have not
seen. Full pools below.

### Prefixes — how they actually resolve

Prefixes key on hero **appearance**. Valve publishes no such mapping, OpenDota does
not expose one, and no community site has it — but **the client ships it**. Every
hero in `scripts/npc/npc_heroes.txt` (inside `pak01_dir.vpk`) carries an
`Adjectives` block:

```
"Adjectives"
{
    "Wings" "0"   "Horns" "0"   "Legs" "2"    "Steed" "0"   "Nose" "1"
    "Fuzzy" "0"   "Bearded" "0" "Female" "0"  "BadTeeth" "0"
    "Cape" "0"    "NicePecs" "0" "Potbelly" "0" "Parent" "0"
    "Arachnophobic" "0" "Undead" "0" "Aquatic" "0" "Demon" "0"
    "Spirit" "0"  "Flying" "0"  "Cute" "0"    "Fiery" "0"   "Icy" "0"
    "Blue" "0"    "Red" "0"     "Green" "0"
}
```

Plus `Purple`, `Yellow`, `Brown` and `Mask`, which appear on individual heroes but
not in the default block. Extract with:

```bash
python -m scripts.extract_hero_adjectives     # -> config/hero_adjectives.yaml
```

| Prefix | Bonus | Reads flag(s) | Heroes |
|---|---|---|---|
| **Cerulean** | +11% | `Blue` | 29 |
| **Royal** | +10% | `Purple` | 20 |
| **Heroic** | +9% | `Cape` \| `Mask` | 31 |
| **Golden** | +8% | `Yellow` \| `Brown` | 25 |
| **Elemental** | +8% | `Aquatic` \| `Fiery` \| `Icy` | 26 |
| **Otherworldly** | +7% | `Undead` \| `Demon` \| `Spirit` | 26 |
| **Crimson** | +6% | `Red` | 30 |
| **Emerald** | +6% | `Green` | 23 |
| Bestial | — | `Horns` \| `Wings` | 24 |
| Hirsute | — | `Bearded` \| `Fuzzy` | 36 |

Three things that make this counter-intuitive, and that guesswork gets wrong:

1. **Heroes carry several tags at once.** Sven is `Blue` *and* `Red`. Muerta is
   `Blue` *and* `Green`. Abaddon is `Blue` *and* `Purple`. Jakiro is `Blue` *and*
   `Red`. Categories overlap and do not sum to the hero pool.
2. **The tags are Valve's aesthetic judgement, not yours.** Slardar is `Purple`,
   not blue. Rubick is `Green` + `Yellow`, not blue. Invoker carries no colour tag
   at all. Tusk is not `Blue`. Guessing from memory of hero art is unreliable —
   read the file.
3. **`Masked` is a typo.** Templar Assassin alone carries `Masked` where every other
   masked hero carries `Mask`. If the game reads only `Mask`, TA does not pay Heroic.

### Full prefix pool (18)

Crimson `red` · Cerulean `blue` · Emerald `green` · Royal `purple` · Golden
`yellow/brown` · Elemental `aquatic/fiery/icy` · Otherworldly `undead/demon/spirit`
· Heroic `caped/masked` · Bestial `horns/wings` · Hirsute `bearded/fuzzy` · Canny
`Intelligence hero` · Brawny `Strength hero` · Dashing `Agility hero` · Balanced
`Universal hero` · Virtuoso `hero they are Master/Grandmaster with` · Glamorous
`player has an Arcana equipped` · Coveted `hero chosen last` · Sacrificial `hero
chosen first`.

### Full suffix pool (21)

the Clutch `last possible match of a series` · the Underdog `player loses` · the
Lucky `match time ends with an 8` · the Decisive `game under 25 min` · the Patient
`first blood after 10 min` · the Flayed Twins Acolyte `first blood before the horn`
· the Tormented `any player dies to a Tormentor` · the Cruel `player killed in own
fountain` · the Gritty `team wins after being down 10,000 net worth` · the Nothl
Pilgrim `player has the most deaths` · the Pacifist `player ends with no kills` ·
of the Raven `any player gets a rampage` · the Even-Keeled `player tipped 5+ times`
· the Loquacious `player uses the most voice lines` · the Divine Thief `any player
steals a Rapier` · of the Ant `player has the lowest net worth` · of the Mule
`every inventory and backpack slot filled` · of the Octopus `4+ items with an
active` · of the Bull `buyback before 30 min` · the Accomplice `player has the most
assists` · the Virtuoso-style leftovers.

Note several suffixes reward *bad* games (most deaths, no kills, lowest net worth).
Under `E[max]` those are close to worthless: only your best game is recorded, and
your best game is not the one where you had no kills.

---

## Cross-check status vs `config/scoring.yaml`

| Section | Status |
|---|---|
| Base point values (18 stats) | ✅ all match |
| Stat → colour assignment | ✅ all match |
| Emblem quality tiers I–V | ✅ all match |
| Emblem traits (5) | ✅ all match |
| Scoring chain | ✅ matches |
| Stat rerolls guaranteed-new | ➕ new, not previously recorded |
| No duplicate stats per banner | ➕ new, not previously recorded |
| Hero → prefix category lists | ✅ **resolved** — `Adjectives` in `npc_heroes.txt`, extracted to `config/hero_adjectives.yaml` |
| Trait adjacency (Benevolent / Vampiric) | ✅ **modelled** — `dota/emblems.py`, and all 15 client percentages reproduce from tier + trait + neighbours |
| Coach Titles applied to projections | ✅ `dota/titles.py`, from `coach.equipped` |

### Reading a trait percentage in the client

The displayed number folds the emblem's own trait together with its neighbours',
which makes two readings look like bugs:

* **`FRACTAL −10%`** — Fractal is not firing (the banner has repeated qualities, so
  it pays 0), and an adjacent **Vampiric** is charging this emblem −10%.
* **`FRACTAL +20%`** — again Fractal paying nothing, plus an adjacent **Benevolent**
  paying +20%. `−20%` means Vampiric on *both* sides.

So `displayed = 100 + quality + own trait (if its condition holds) + Σ neighbours'
positional effects`. Because Vampiric and Benevolent are the only positional traits,
rearranging emblems changes the total at no cost — see `scripts/emblem_order.py`.

### Measured suffix rates, per game unless noted

Measured on ~426 sampled player-games of the locked roster; these supersede the
`p:` values in `config/scoring.yaml` where they disagree.

| Suffix | Rate | Note |
|---|---|---|
| the Clutch | 48.3% of *series* go the distance | positional, applied to the decider game |
| the Flayed Twins Acolyte | 9.9% | config said 0.0% — pre-horn first blood is a **negative** objectives timestamp |
| the Lucky | 9.7% | duration seconds ending in 8 |
| the Underdog | 34.8% | pays on losses, so nearly worthless under E[max] |
| the Tormented | 2.3% | from `killed_by["npc_dota_miniboss"]`; config had no value |
| the Decisive | 1.8% | sub-25-minute games also suppress the banner's cumulative stats |
| the Patient | 0.0% | first blood after 10 minutes effectively never happens |
| the Cruel | — | fountain kills are not in the match data at any depth |

### How the equipped Titles are applied (2026-08-17: Cerulean … the Clutch)

Both conditions are per *game*, so both are applied per game rather than as a rate
on the total:

* **Cerulean** fires on the games whose hero carries Valve's `Blue` flag, read from
  `config/hero_adjectives.yaml` by hero id. Blue share is a property of the player,
  not the field — 33% of Nisha's sampled games, 1% of Nigma's core duo — so
  averaging the rate would erase the only thing that makes this title a choice.
* **the Clutch** fires on the last possible game of a series, which the bracket
  simulation knows exactly (3 games of a Bo3, 5 of a Bo5). Because a series scores
  its **top two** games, an amplified decider is also more likely to be counted, so
  the title is worth more than `bonus × P(decider)`: measured **+3.6%** against the
  **+3.1%** that flat estimate gives.

Stacking is assumed multiplicative (`×1.11 × ×1.16` on a game meeting both). If the
client adds them instead, such games are ~1.4% overstated.
