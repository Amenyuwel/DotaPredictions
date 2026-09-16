"""Names vulture must not report, each with the reason it is not dead.

Run as an extra input, never as a suppression file nobody reads:

    python -m vulture dota scripts tests vulture-allowlist.py --min-confidence 60

Vulture works by finding names that are never READ. That is the right question
for a helper nobody calls, and the wrong one for a field whose job is to exist
-- a config key the YAML must supply, or a value carried on a result so a later
report can reach it. Those are the only entries below.

Nothing here is a name that is merely inconvenient to delete. If something stops
being true, delete the line and let the tool speak: an allowlist that grows
whenever the tool is annoying is a tool that has been turned off slowly.
"""

from dota.config import Tournament
from dota.swiss import SwissOutcome

# --------------------------------------------------------------------------
# Config-contract fields
# --------------------------------------------------------------------------
# Parsed from `tournament.yaml` in `Config.load` and never read again by Python.
# They are not dead: their presence is the schema. `config.py` indexes the YAML
# with `gs["rounds"]` and friends, so a tournament file missing one fails at
# load with a KeyError naming it -- which is the check. Deleting the field would
# delete the check and let a malformed tournament file load silently.
#
# A reader also needs them here to know what a `tournament.yaml` must contain;
# the dataclass IS the documentation for that file.
_tournament = Tournament(
    name="",
    lock_utc=None,
    rounds=0,
    n_teams=0,
    direct_advance=0,
    elimination_round_slots=0,
    banner_slots=0,
    reroll_tokens=None,
)
_tournament.rounds
_tournament.direct_advance
_tournament.elimination_round_slots

# --------------------------------------------------------------------------
# Reported-but-unread simulation output
# --------------------------------------------------------------------------
# `swiss.simulate` computes this and nothing consumes it today. Kept because it
# is the one summary of the Swiss stage that is not a probability -- how many
# wins a team averages -- and it costs one division over a loop that already
# ran. It is a candidate for deletion, not a false positive; delete this line
# first if it is going, so the tool is what tells you the field is unused.
SwissOutcome.expected_wins
