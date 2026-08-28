# TI 2026 Main Event — the bracket, on this TI's games only

Re-run of the bracket prediction under two changes you asked for: **evidence
from this tournament only** (TI 2026's own 109 games, Aug 13–16 — no six-month
history, no qualifiers, no other leagues), and **every possible outcome
projected** rather than sampled. Fourteen matches, two ways each, is
2^14 = **16,384 possible outcomes**, all of them enumerated with their exact
probability. Nothing below is a simulation estimate.

Reproduce with `python -m scripts.bracket_outcomes` (add `--all-history` for the
six-month comparison column).

---

## First, a bug this run found

**The team in slot A is Iron Wing, and the config had them as 1win.** Same five
players — Pure, bzm, 33, Ari, Whitemon — but a different org id, and every game
they played in Shanghai carries the Iron Wing one. So all 16 of those games were
landing on a team the model had never heard of, and it rated slot A off *no
evidence at all*. They are now named Iron Wing throughout, their TI record
counts, and the "1w" id their qualifier season was played on is folded in behind
it. That moves them from the weakest team in the field to the third strongest.

That correction is worth more than everything else on this page. It also changes
the six-month answer, so the comparison below is the corrected version of both.

---

## Who wins, on this event's games only

| Team | This TI (10–6 etc.) | **Wins TI** | Six-month model | Change |
|---|---|---|---|---|
| PARIVISION | 8–2 | **28.3%** | 29.7% | −1.4 |
| Nigma Galaxy | 8–2 | **20.4%** | 6.1% | **+14.3** |
| Iron Wing *(ex-Iron Wing)* | 10–6 | **13.6%** | 4.0% | **+9.6** |
| Team Liquid | 9–5 | **13.1%** | 7.4% | +5.7 |
| Team Falcons | 10–7 | **8.2%** | 18.0% | **−9.8** |
| Team Spirit | 8–6 | **7.9%** | 8.2% | −0.3 |
| Team Yandex | 9–8 | **4.6%** | 13.1% | **−8.5** |
| BetBoom Team | 7–7 | **3.9%** | 13.5% | **−9.6** |

Records are games, not series. The two columns use the *same* enumeration — the
only difference is what the ratings were fitted on, so every gap is evidence,
not method.

**What restricting to this TI actually does:** it throws away the reason Falcons,
BetBoom and Yandex were rated highly (a strong season) and keeps only how they
played in Shanghai, where all three needed the elimination round. It does the
opposite for Nigma and Iron Wing. PARIVISION are the pick either way — they are the
one team both views agree on.

### The entire evidence base

This is all of it — every game the eight played in Shanghai, in games won–lost
per opponent. It is short enough to read, which is the point: judge the numbers
above against it directly.

| Team | Games | Results at TI 2026 |
|---|---|---|
| PARIVISION | 8–2 | BetBoom 2–0, Falcons 2–1, Resilience 2–1, Spirit 2–0 |
| Nigma Galaxy | 8–2 | **Iron Wing 0–2**, LGD 2–0, OG 2–0, Spirit 2–0, Vici 2–0 |
| Iron Wing | 10–6 | **Nigma 2–0**, **Falcons 2–1**, Yandex 2–1, GamerLegion 2–0, BetBoom 1–2, Liquid 1–2 |
| Team Liquid | 9–5 | Iron Wing 2–1, Spirit 1–2, Yandex 2–1, Aurora 2–1, Vici 2–0 |
| Team Falcons | 10–7 | PARIVISION 1–2, Iron Wing 1–2, BetBoom 2–1, GamerLegion 2–1, LGD 2–1, Vici 2–0 |
| Team Spirit | 8–6 | PARIVISION 0–2, Nigma 0–2, Liquid 2–1, Resilience 2–1, Aurora 2–0, Xtreme 2–0 |
| Team Yandex | 9–8 | Iron Wing 1–2, Liquid 1–2, Aurora 1–2, LGD 2–1, Resilience 2–1, L1GA 2–0 |
| BetBoom Team | 7–7 | PARIVISION 0–2, Falcons 1–2, Iron Wing 2–1, Aurora 2–2, OG 2–0 |

Two things jump out, and both are worth holding against the model:

- **Iron Wing's 10–6 is the best-quality record in the field.** They beat Nigma 2–0
  and Falcons 2–1; their only losses are to Liquid and BetBoom, both 1–2.
- **Nigma's 8–2 is the softest.** Four of their five series were against LGD,
  OG, Vici and Spirit, and the one strong opponent they met beat them 2–0. The
  model cannot fully see that — it prices opponents through the same 109 games,
  and those games say Vici and OG were bad. Treat Nigma's 20.4% as the number
  most likely to be flattering.

### Where each team finishes

| Team | 1st | 2nd | 3rd | 4th | 5–6th | 7–8th |
|---|---|---|---|---|---|---|
| PARIVISION | 28.3% | 17.5% | 13.5% | 10.7% | 18.0% | 12.0% |
| Nigma Galaxy | 20.4% | 16.8% | 13.9% | 11.9% | 21.2% | 15.8% |
| Iron Wing | 13.6% | 13.9% | 13.9% | 13.5% | 25.2% | 19.9% |
| Team Liquid | 13.1% | 14.8% | 14.4% | 12.7% | 24.8% | 20.2% |
| Team Falcons | 8.2% | 11.1% | 12.1% | 13.1% | 27.0% | 28.5% |
| Team Spirit | 7.9% | 10.6% | 12.2% | 13.8% | 27.9% | 27.5% |
| Team Yandex | 4.6% | 8.4% | 10.8% | 12.2% | 28.4% | 35.5% |
| BetBoom Team | 3.9% | 6.9% | 9.2% | 12.1% | 27.5% | 40.5% |

Rows sum to 100%. 5–6th and 7–8th are genuine ties — the bracket eliminates two
teams at once there.

---

## Your bracket against the model's

| Match | Day | Model | P | **Your pick** | P |
|---|---|---|---|---|---|
| UB R1 — A | Aug 20 | Iron Wing | 55.3% | ✗ Team Spirit | 44.7% |
| UB R1 — B | Aug 20 | PARIVISION | 69.1% | ✓ PARIVISION | 69.1% |
| UB R1 — C | Aug 20 | Team Liquid | 59.6% | ✓ Team Liquid | 59.6% |
| UB R1 — D | Aug 20 | Nigma Galaxy | 59.3% | ✗ Team Falcons | 40.7% |
| UB R2 — E | Aug 21 | PARIVISION | 41.8% | ✓ PARIVISION | 41.8% |
| UB R2 — F | Aug 21 | Nigma Galaxy | 35.2% | ✗ Team Liquid | 28.8% |
| UB Final — G | Aug 22 | PARIVISION | 24.9% | ✓ PARIVISION | 24.9% |
| LB R1 (losers A/B) | Aug 21 | BetBoom | 28.6% | ✗ Iron Wing | 24.8% |
| LB R1 (losers C/D) | Aug 21 | Team Falcons | 30.8% | ✗ Nigma Galaxy | 24.9% |
| LB R2 (loser F) | Aug 22 | Team Liquid | 16.1% | ✗ Iron Wing | 13.1% |
| LB R2 (loser E) | Aug 22 | Iron Wing | 15.3% | ✗ Team Spirit | 12.2% |
| LB R3 | Aug 22 | Iron Wing | 14.9% | ✗ Team Spirit | 11.6% |
| LB Final | Aug 23 | Nigma Galaxy | 18.3% | ✗ Team Liquid | 14.0% |
| **Grand Final** | Aug 23 | **PARIVISION** | 28.3% | ✓ **PARIVISION** | 28.3% |

|  | Model | Yours |
|---|---|---|
| Expected correct | **4.98 / 14** | **4.38 / 14** |
| At least 5 right | 55% | 44% |
| At least 7 right | 26% | 19% |
| At least 9 right | 9% | 6% |
| Perfect | 0.029% (1 in 3,455) | 0.020% (1 in 5,044) |
| Rank among all 16,384 outcomes | — | **#474** |

For scale: a bracket filled in blind — knowing nothing about any team — is worth
**3.75**. Yours is worth 4.38, the model's 4.98. The whole game is played inside
about one and a quarter picks.

**Your champion pick is the model's champion pick.** That is the part worth
caring about, and it survives the change of evidence.

### The two picks I'd change, and what they cost

Every difference below round one is downstream plumbing — a lower-bracket pick
only lands if a specific team loses *first* and then wins. The two that are
independently wrong under this evidence:

- **UB R1 — A: Iron Wing over Team Spirit** (55.3% vs 44.7%). The naming fix.
  Iron Wing beat Nigma and Falcons here; Spirit were swept by both PARIVISION and
  Nigma. This is the change I'd actually make.
- **UB R1 — D: Nigma over Falcons** (59.3% vs 40.7%). Weaker recommendation.
  Nigma advanced directly and Falcons went through the elimination round, but
  Nigma's record is the soft one and Falcons' losses were to PARIVISION and Iron Wing.
  If you keep any of your round-one calls, keep this one.

If you'd rather not rebuild the whole thing:

| Keep | Best achievable | vs your 4.38 |
|---|---|---|
| Everything (model's bracket) | 4.98 | +0.59 |
| Keep A = Team Spirit | 4.85 | +0.46 |
| Keep D = Team Falcons | 4.62 | +0.24 |
| Keep both A and D | 4.51 | +0.13 |

Even holding both of your round-one calls, re-plumbing the lower bracket
(BetBoom over Iron Wing in LB R1, then Nigma through LB R2/R3/Final) is worth +0.13.

**The bracket I'd actually submit** — the model's, but keeping Falcons in D
because the evidence for Nigma there is the weakest thing on this page. Worth
4.62 expected picks against your 4.38:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| **Iron Wing** | PARIVISION | Liquid | Falcons | PARIVISION | Liquid | PARIVISION |

| LB1a | LB1b | LB2a | LB2b | LB3 | LB Final | Grand Final |
|---|---|---|---|---|---|---|
| **Spirit** | Nigma | **Spirit** | **Nigma** | **Nigma** | **Nigma** | PARIVISION |

Six changes from what you have (bold above): A, LB1a, LB2a, LB2b, LB3 and the
LB Final. Everything else stays exactly as you filled it in. It also happens to
carry *better* perfect-bracket odds than the max-expected-picks bracket does
(0.031% against 0.029%) — giving up a third of a pick in expectation buys back
the more coherent single story.

---

## Head-to-head: no, and here is what it would do

Every number above comes from one strength rating per team. Two teams are
compared *through their common opponents*, never through their own record against
each other. That assumption matters more here than usual: **16 of the 28 pairs in
this bracket never met at this TI**, including Falcons vs Nigma, the exact match
they play on day one.

The direct record exists outside this event. Falcons beat Nigma **2–0 on July
31st** at 1win Essence II, three weeks before TI — the only time they have met in
six months. That is real evidence the model above is not using.

So it was tested. `scripts.validate_h2h --offline` walks forward through the
corpus, fits on the past, predicts games it has never seen, and scores them:

| Head-to-head weight | Log-loss | vs rating alone | Correct |
|---|---|---|---|
| **off (rating only)** | **0.6665** | — | **59.8%** |
| 40 pseudo-games (barely on) | 0.6680 | +0.0015 worse | 59.2% |
| 10 pseudo-games | 0.6737 | +0.0072 worse | 58.0% |
| 5 pseudo-games | 0.6825 | +0.0159 worse | 57.1% |
| head-to-head only | 1.9236 | +1.2570 worse | 57.4% |

333 unseen games, 219 of them between pairs that had a prior record. **Every
weight makes the prediction worse, and the more you lean on the record the worse
it gets.** Small records are mostly luck: 2–0 in a single meeting is what a 55%
team does to a 45% team about a third of the time.

That said, here is the bracket with head-to-head switched on
(`--h2h-k`), because the effect is not subtle and it lands squarely on your two
round-one calls:

| | Rating only | Mild (k=20) | Heavy (k=5) |
|---|---|---|---|
| Falcons beat Nigma (D) | 40.7% | 47.5% | **62.6%** |
| Spirit beat Iron Wing (A) | 44.7% | 46.7% | **52.4%** |
| PARIVISION win TI | 28.3% | 34.2% | 43.9% |
| Falcons win TI | 8.2% | 11.6% | 18.7% |
| Nigma win TI | 20.4% | 14.5% | 5.8% |

**Lean on head-to-head and both of your round-one picks become the model's
picks.** Your instinct and the direct records agree with each other. What they
disagree with is the out-of-sample test, which says this particular kind of
evidence — one or two games, months old — costs accuracy on average.

Where that leaves the recommendation: keeping Falcons in D is already what this
report advises, and it is now supported twice. The A pick is the one to think
about. Spirit's claim there rests on a single game in May; Iron Wing's claim
rests on sixteen games this month. I would still switch it.

---

## All 16,384 outcomes

- **The single most likely outcome happens 0.035% of the time.** That is the
  ceiling on a perfect bracket, and it is 1 in 2,826.
- The top 15 outcomes together carry **0.5%** of the probability. The median
  outcome is worth 0.0043%.
- **Yours happens 0.020% of the time** (#474 of 16,384) — genuinely near the top
  of the distribution; there are 15,910 outcomes less likely than the one you
  drew up.

The most likely single outcome, in full:

| | |
|---|---|
| Upper R1 | Iron Wing, PARIVISION, Liquid, Nigma |
| Upper R2 | PARIVISION, Liquid |
| Upper Final | PARIVISION |
| Lower R1 | Team Spirit, Team Falcons |
| Lower R2 | Nigma, Iron Wing |
| Lower R3 → Final | Nigma, Nigma |
| **Grand Final** | **PARIVISION over Nigma Galaxy** |

Note it is *not* the max-expected-picks bracket: that one scores 4.98 expected
correct but only 0.029% perfect. Chasing "most picks right" and chasing "whole
bracket right" are different objectives, and they disagree here. Unless the
scoring pays for a perfect bracket, take the 4.98.

---

## How much of this is the shrinkage knob

109 games across 16 teams is about 14 games per team. With that little evidence
the prior — how hard a team with a short record is pulled toward average — moves
the answer:

| Team | prior 1 | prior 2 | **prior 3** | prior 5 | prior 8 |
|---|---|---|---|---|---|
| PARIVISION | 42.3% | 33.2% | **28.3%** | 23.2% | 19.7% |
| Nigma Galaxy | 21.3% | 21.1% | **20.4%** | 19.0% | 17.5% |
| Iron Wing | 11.5% | 13.1% | **13.6%** | 13.9% | 13.7% |
| Team Liquid | 11.3% | 12.6% | **13.1%** | 13.4% | 13.4% |
| Team Falcons | 4.6% | 6.9% | **8.2%** | 9.7% | 10.7% |
| Team Spirit | 5.5% | 7.0% | **7.9%** | 9.1% | 10.0% |
| Team Yandex | 1.7% | 3.3% | **4.6%** | 6.4% | 8.0% |
| BetBoom | 1.7% | 2.9% | **3.9%** | 5.4% | 7.0% |

PARIVISION's number ranges from 20% to 42% depending on a knob no data pins
down. The *ordering* is stable across the whole range, and so are the round-one
calls — which is why the recommendation is the ordering, not the percentage.

---

## What this run does not know

- **109 games is a thin base.** Ratings are Bradley-Terry with an L2 prior; the
  numbers above are the shrunk ones, and the sensitivity table is the honest
  error bar.
- **Group-stage form is not Main Event form.** Bo3 with nothing eliminated is
  not Bo3 with everything eliminated, and the teams that scraped through the
  elimination round have the most obvious reason to be underrated here.
- **Restricting to one league throws away real information.** The six-month
  model is not wrong, it is answering a different question. The two disagree
  most about Falcons, BetBoom and Yandex — if you think a season means more than
  four days, weight toward that column.
- **No matchup styles, no stand-ins, no patch shift.** Each team is one number.
- **Series are modelled as independent games.** No momentum, no draft
  adaptation between games of a series.
- Fantasy roster, banners and coach titles are unchanged by this run — see
  [ti2026-main-event-picks.md](ti2026-main-event-picks.md).
