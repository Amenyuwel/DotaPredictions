import { useMemo, useState } from "react"
import { ChevronRight, Pencil, Plus, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog"
import { EditDialog, EditField } from "@/components/admin/edit-dialog"
import { UndoDialog, type ChangeRow } from "@/components/admin/undo-dialog"
import {
  EditedMark,
  FilterField,
  RemovedChips,
  RowActions,
  SelectCell,
  TextCell,
  ValueCell,
} from "@/components/admin/cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMediaQuery } from "@/hooks/use-media-query"
import { mergeEntry, validateId } from "@/lib/admin-ui"
import { LANE_LABEL, LANE_ORDER, ROLE_LABEL, ROLE_ORDER } from "@/lib/labels"
import { cn } from "@/lib/utils"
import type { AdminConfig, ConfigOverlay, PlayerPatch } from "@/types/admin"
import type { FantasyRole, Lane, Player, Team } from "@/types/run"

/**
 * Teams and players.
 *
 * The honest boundary of this feature runs through here. Everything on the
 * scoring tab is a table the server reads on every request, so editing it takes
 * effect exactly and immediately. A roster is not: a player's per-game stat
 * lines come from the crawler, and nothing in this form can produce one.
 *
 * So what this edits is metadata -- who is on which team, in which slot, under
 * which name. Adding a player is legal and useful (a stand-in announced before
 * the next crawl), and the tool then says so everywhere rather than ranking
 * them: no sample matrix means no distribution to draw from, and a player
 * scored from nothing looks like a weak player rather than an unknown one.
 *
 * That boundary is stated where it bites: in the Add and Edit dialogs'
 * descriptions, and in the per-row "no data" badges, which are attached to the
 * player they describe. A banner at the top of this form said it once more, in
 * a warning frame around something that is not a warning.
 *
 * A list beside a detail pane, rather than sixteen expanding panels. Expanding
 * panels made the page grow with every team opened, so reading two of them
 * meant scrolling past the first; here the list is fixed height and scrolls
 * inside itself, and the page never grows at all. It also matches the job: a
 * roster edit is one team, because that is the unit that changes.
 *
 * Below 1024px there is no width for two panes, and stacking them put the whole
 * team list -- plus the rail, the draft controls and the caveat above it --
 * between the top of the page and the roster being edited. Scrolling past a
 * list to reach the thing it selects is the expanding-panel problem again in a
 * different shape. So the pane opens over the page instead of under it, the
 * same move the scoring tables make at their own breakpoint: one team, the
 * width it has, and a way back that is not a scroll.
 */

/** Built from `lib/labels`, not re-listed here. The lane order is board order
 * -- position 1 through 5 -- and the labels are the ones every other screen
 * shows; a second copy of either is a second spelling waiting to drift. */
const LANE_OPTIONS = LANE_ORDER.map((lane) => ({ value: lane, label: LANE_LABEL[lane] }))
const ROLE_OPTIONS = ROLE_ORDER.map((role) => ({ value: role, label: ROLE_LABEL[role] }))

type TeamPatch = NonNullable<ConfigOverlay["teams"]>[string]

/** A player's or team's name inside a heading. Headings are Space Grotesk, and
 * that face has no Cyrillic or Greek, so a nickname set in it would render in
 * two fonts at once; names stay in Inter wherever they appear (DESIGN.md). */
function Name({ children }: { children: string }) {
  return <span className="font-sans">{children}</span>
}

/**
 * "Also played under", parsed, or null when any part is not an id.
 *
 * Null rather than the parts that did parse. Dropping a mistyped id quietly
 * saved a list one shorter than the one typed, and a missing id is evidence
 * split in half with no error anywhere -- so a bad token refuses the save.
 */
function parseIds(value: string): number[] | null {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.every((part) => validateId(part) === null) ? parts.map(Number) : null
}

export function RosterEditor({
  config,
  doc,
  onChange,
  effective,
}: {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** From the server's own apply, or undefined while there are unsaved edits. */
  effective: { teams: Team[]; players: Player[] } | undefined
}) {
  const [addingTeam, setAddingTeam] = useState(false)
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [filter, setFilter] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pending, setPending] = useState<ConfirmRequest | null>(null)
  // Which player's dialog is open, by id: the row is read fresh on render,
  // so nothing stale can sit in the box.
  const [editingPlayer, setEditingPlayer] = useState<number | null>(null)
  const [editingTeam, setEditingTeam] = useState(false)
  const [undoingPlayer, setUndoingPlayer] = useState<number | null>(null)
  const [undoingTeam, setUndoingTeam] = useState(false)

  // Whether the two panes have a page wide enough to sit side by side. Below
  // this the detail pane opens in a dialog instead -- see the note above.
  //
  // 1024px, the width this component's own grid used to switch at, so there is
  // no band where the layout says there is room for two columns and this says
  // there is not. The scoring tables switch at 768px because that is where
  // THEIR layout changes; a shared breakpoint would be wrong for one of them.
  const wide = useMediaQuery("(min-width: 64rem)")
  const [detailOpen, setDetailOpen] = useState(false)

  const teams = effective?.teams ?? config.published.teams
  const players = effective?.players ?? config.published.players
  const publishedTeams = useMemo(
    () => new Map(config.published.teams.map((t) => [t.teamId, t])),
    [config.published.teams],
  )
  const publishedPlayers = useMemo(
    () => new Map(config.published.players.map((p) => [p.playerId, p])),
    [config.published.players],
  )
  const measured = useMemo(() => new Set(config.measuredPlayerIds), [config.measuredPlayerIds])
  const projected = useMemo(() => new Set(config.projectedTeamIds), [config.projectedTeamIds])

  const teamsRemoved = doc.teamsRemoved ?? []
  const playersRemoved = doc.playersRemoved ?? []

  const byTeam = useMemo(() => {
    const map = new Map<number, Player[]>()
    for (const player of players) {
      map.set(player.teamId, [...(map.get(player.teamId) ?? []), player])
    }
    return map
  }, [players])

  const isTouched = (team: Team) =>
    Boolean(doc.teams?.[String(team.teamId)]) ||
    (byTeam.get(team.teamId) ?? []).some((p) => doc.players?.[String(p.playerId)])

  /**
   * Teams this stage can actually answer for.
   *
   * A Main Event run carries all sixteen rosters and eight projections, so
   * half the list was teams knocked out weeks ago. Editing one changes
   * nothing anybody sees: an overlay is per stage, and a team with no
   * projection is absent from every picker on the public page.
   *
   * A team the draft has TOUCHED stays regardless. Hiding one would make an
   * edit that is still in the document unreachable -- impossible to see and
   * impossible to undo -- which is the one thing worse than a long list. That
   * also covers a team added here, which has no projection by definition.
   */
  const inStage = teams.filter((team) => projected.has(team.teamId) || isTouched(team))
  const hidden = teams.length - inStage.length

  // Matches a team by its own name or by any of its players', so looking for a
  // person finds the team they are on rather than nothing.
  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? inStage.filter(
        (team) =>
          team.name.toLowerCase().includes(needle) ||
          String(team.teamId).includes(needle) ||
          (byTeam.get(team.teamId) ?? []).some((p) => p.nick.toLowerCase().includes(needle)),
      )
    : inStage

  // Derived, not stored: a stored selection survives a filter that excludes it,
  // or a team the overlay removed, and the detail pane then describes something
  // the list no longer offers.
  const selected = shown.find((team) => team.teamId === selectedId) ?? shown[0] ?? null

  const dropKey = (bucket: "teams" | "players", id: number) => {
    const next = { ...(doc[bucket] ?? {}) } as Record<string, unknown>
    delete next[String(id)]
    onChange({ ...doc, [bucket]: Object.keys(next).length > 0 ? next : undefined })
  }

  const teamList = (
    <Card className="h-fit">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Teams</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAddingTeam(true)}>
            <Plus aria-hidden />
            Add team
          </Button>
        </div>
        <FilterField
          value={filter}
          onChange={setFilter}
          label="Filter by team or player"
          summary={
            shown.length === inStage.length
              ? `${inStage.length} teams`
              : `${shown.length} of ${inStage.length} teams`
          }
        />
      </CardHeader>

      <CardContent className="px-2">
        {/* Beside the detail pane it scrolls inside itself, so sixteen
            teams do not set the height of the page and the pane stays where
            it was. Above the dialog there is no pane to hold still and
            nothing else on the screen, so the cap would be a second
            scrollbar inside a page that is already scrolling. */}
        <ul className={cn("grid gap-0.5", wide && "max-h-[28rem] overflow-y-auto")}>
          {shown.map((team) => {
            const roster = byTeam.get(team.teamId) ?? []
            const noData = roster.filter((p) => !measured.has(p.playerId)).length
            const isSelected = selected?.teamId === team.teamId
            return (
              <li key={team.teamId}>
                <button
                  type="button"
                  aria-current={wide && isSelected ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(team.teamId)
                    if (!wide) setDetailOpen(true)
                  }}
                  className={cn(
                    "focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none active:translate-y-px pointer-coarse:min-h-11",
                    wide && isSelected ? "bg-muted font-medium" : "hover:bg-muted/50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{team.name}</span>
                  {isTouched(team) ? <EditedMark /> : null}
                  {/* Words for both counts, not a `title`: a screen reader read
                      this row as "Team Spirit 2 5" and a phone cannot hover. */}
                  {noData > 0 ? (
                    <Badge variant="outline">
                      {noData}
                      <span className="sr-only"> with no data,</span>
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {roster.length}
                    <span className="sr-only"> players</span>
                  </span>
                  {wide ? null : (
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}

          {shown.length === 0 ? (
            <li className="text-muted-foreground px-2 py-6 text-center text-sm">
              Nothing matches “{filter}”.
            </li>
          ) : null}
        </ul>

        {/* Said rather than left to be noticed. A list that quietly drops
            half its rows is one a reader checks against another source. */}
        {hidden > 0 ? (
          <p className="text-muted-foreground mt-2 px-1 text-xs">
            {hidden === 1 ? "1 team not in this stage is hidden." : `${hidden} teams not in this stage are hidden.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )

  const detail = (
    selected ? (
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="mr-auto font-sans">{selected.name}</CardTitle>
            <code className="text-muted-foreground text-xs">{selected.teamId}</code>
            {!publishedTeams.has(selected.teamId) ? (
              <Badge variant="secondary">new</Badge>
            ) : null}
            {!projected.has(selected.teamId) ? (
              <Badge variant="outline" title="No projection in this stage">
                no projection
              </Badge>
            ) : null}
          </div>

          {/* Name only. The other field a team carries -- the ids it also
              played under -- is not printed here: it is the crawler's business
              rather than the reader's, and "none" on every row of a field
              nobody was asking about is noise above the roster they opened the
              panel for. It is still edited in Edit team, which shows the
              current value, and a change to it still appears in the change list
              and in the publish diff, so nothing about it is hidden from the
              person who changes it. */}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground text-xs">Name</dt>
              <dd>
                <ValueCell
                  value={doc.teams?.[String(selected.teamId)]?.name ?? selected.name}
                  changed={doc.teams?.[String(selected.teamId)]?.name !== undefined}
                />
              </dd>
            </div>
          </dl>

        </CardHeader>

        <CardContent className="grid gap-3 px-0">
          <Table aria-label={`${selected.name} roster`}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Player</TableHead>
                <TableHead>Account id</TableHead>
                <TableHead>Lane</TableHead>
                <TableHead>Fantasy slot</TableHead>
                <TableHead className="w-0 pr-6 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(byTeam.get(selected.teamId) ?? []).map((player) => {
                const entry = doc.players?.[String(player.playerId)]
                return (
                  <TableRow
                    key={player.playerId}
                    className={entry ? "bg-primary/5" : undefined}
                  >
                    <TableCell className="pl-6">
                      <ValueCell
                        value={entry?.nick ?? player.nick}
                        changed={entry?.nick !== undefined}
                      />
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <code className="text-muted-foreground text-xs">
                          {player.playerId}
                        </code>
                        {/* Outline, as the stats table marks an unmeasured stat:
                            the same fact in two variants read as two facts. */}
                        {!measured.has(player.playerId) ? (
                          <Badge variant="outline" title="No sample matrix in this run">
                            no data
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <ValueCell
                        value={LANE_LABEL[entry?.lane ?? player.lane]}
                        changed={entry?.lane !== undefined}
                      />
                    </TableCell>

                    <TableCell>
                      <ValueCell
                        value={ROLE_LABEL[entry?.fantasyRole ?? player.fantasyRole]}
                        changed={entry?.fantasyRole !== undefined}
                      />
                    </TableCell>

                    <TableCell className="pr-6">
                      <RowActions
                        what={player.nick}
                        changed={Boolean(entry)}
                        onEdit={() => setEditingPlayer(player.playerId)}
                        onUndo={() => setUndoingPlayer(player.playerId)}
                        onRemove={() =>
                          setPending({
                            title: (
                              <>
                                Remove <Name>{player.nick}</Name>?
                              </>
                            ),
                            detail: `They leave ${selected.name} for this stage's overlay.`,
                            confirmText: player.nick,
                            confirmLabel: "Remove player",
                            reversible: true,
                            onConfirm: () =>
                              onChange({
                                ...doc,
                                playersRemoved: [
                                  ...playersRemoved,
                                  String(player.playerId),
                                ],
                              }),
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                )
              })}

              {(byTeam.get(selected.teamId) ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                    No players on this team.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center gap-2 px-6">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => setEditingTeam(true)}
            >
              <Pencil aria-hidden />
              Edit team
            </Button>
            {doc.teams?.[String(selected.teamId)] ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => setUndoingTeam(true)}
              >
                <Undo2 aria-hidden />
                Undo
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setAddingPlayer(true)}
            >
              <Plus aria-hidden />
              Add player
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive ml-auto text-xs"
              onClick={() =>
                setPending({
                  title: (
                    <>
                      Remove <Name>{selected.name}</Name>?
                    </>
                  ),
                  detail: `Its ${(byTeam.get(selected.teamId) ?? []).length} players go with it — a player on no team cannot be ranked at all.`,
                  confirmText: selected.name,
                  confirmLabel: "Remove team",
                  reversible: true,
                  onConfirm: () => {
                    onChange({
                      ...doc,
                      teamsRemoved: [...teamsRemoved, String(selected.teamId)],
                    })
                    // The pane now describes a team that is gone. On the wide
                    // layout the selection falls to the next team on its own;
                    // a dialog has to be told, or it stays open over a list it
                    // no longer points into.
                    setDetailOpen(false)
                  },
                })
              }
            >
              <Trash2 aria-hidden />
              Remove team
            </Button>
          </div>
        </CardContent>
      </Card>
    ) : (
      <Card>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          No team selected.
        </CardContent>
      </Card>
    )
  )

  return (
    <div className="grid gap-4">
      {wide ? (
        <div className="grid grid-cols-[minmax(0,18rem)_1fr] gap-4">
          {teamList}
          {detail}
        </div>
      ) : (
        <>
          {teamList}

          <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
            {/* The same shell the scoring tables open in: the card is already a
                surface with a heading and its own actions, so the dialog gives
                up its padding, background, ring and cross, and "Done" below the
                roster is the way out -- which is where a thumb already is after
                scrolling one. Two rows, so that button is its own row rather
                than the last thing at the end of the table's scroll. */}
            <DialogContent
              showCloseButton={false}
              className="grid max-h-[85dvh] max-w-[calc(100%-1rem)] grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden bg-transparent p-0 ring-0 sm:max-w-3xl"
            >
              {/* The card states the team's name a line below. Kept for the
                  accessible name, which a dialog is required to have. */}
              <DialogTitle className="sr-only">{selected?.name ?? "Team"}</DialogTitle>

              <div className="min-h-0 overflow-y-auto">{detail}</div>

              <DialogClose render={<Button variant="outline" className="w-full" />}>
                Done
              </DialogClose>
            </DialogContent>
          </Dialog>
        </>
      )}

      <RemovedChips
        label="Removed"
        entries={[
          ...teamsRemoved.map((id) => ({
            key: `team:${id}`,
            label: `${publishedTeams.get(Number(id))?.name ?? id} (team)`,
          })),
          ...playersRemoved.map((id) => ({
            key: `player:${id}`,
            label: publishedPlayers.get(Number(id))?.nick ?? id,
          })),
        ]}
        onRestore={(key) => {
          const [kind, id] = key.split(":")
          if (kind === "team") {
            onChange({ ...doc, teamsRemoved: teamsRemoved.filter((k) => k !== id) })
          } else {
            onChange({ ...doc, playersRemoved: playersRemoved.filter((k) => k !== id) })
          }
        }}
      />

      <AddDialog
        open={addingTeam}
        onOpenChange={setAddingTeam}
        title="Add a team"
        description="A team with no projection in this stage is absent from the pickers until the next crawl."
        fields={[
          {
            name: "teamId",
            label: "OpenDota team id",
            placeholder: "7119388",
            hint: "From the team's OpenDota URL.",
            numeric: true,
            validate: validateId,
          },
          { name: "name", label: "Team name", placeholder: "Team Spirit" },
        ]}
        submitLabel="Add team"
        onSubmit={({ teamId, name }) => {
          onChange({ ...doc, teams: { ...(doc.teams ?? {}), [teamId]: { name } } })
          setSelectedId(Number(teamId))
          // Where the pane is a dialog, selecting a team is not enough to show
          // it: a team added and then not opened is one the form implies is
          // ready to fill in and leaves nowhere in sight.
          if (!wide) setDetailOpen(true)
        }}
      />

      <AddDialog
        open={addingPlayer}
        onOpenChange={setAddingPlayer}
        title={
          selected ? (
            <>
              Add a player to <Name>{selected.name}</Name>
            </>
          ) : (
            "Add a player"
          )
        }
        description="They will have no sample matrix, so they are shown as having no data and cannot be ranked until the next crawl."
        fields={[
          {
            name: "playerId",
            label: "OpenDota account id",
            placeholder: "111620041",
            hint: "From the player's OpenDota URL.",
            numeric: true,
            validate: validateId,
          },
          { name: "nick", label: "Nickname", placeholder: "SumaiL" },
          // Chosen here, in the open. They used to be fixed at Carry and Core
          // with a comment calling that a starting point to correct -- but the
          // row that appears only displays them, so a support stand-in went
          // live as a core unless somebody thought to open a second dialog.
          { name: "lane", label: "Lane", options: LANE_OPTIONS },
          { name: "fantasyRole", label: "Fantasy slot", options: ROLE_OPTIONS },
        ]}
        submitLabel="Add player"
        onSubmit={({ playerId, nick, lane, fantasyRole }) => {
          if (!selected) return
          onChange({
            ...doc,
            players: {
              ...(doc.players ?? {}),
              // Every field named: a player the run does not carry has nothing
              // to merge onto, and the server refuses a partial one rather than
              // filling in a lane nobody chose.
              [playerId]: {
                nick,
                teamId: selected.teamId,
                fantasyRole: fantasyRole as FantasyRole,
                lane: lane as Lane,
              },
            },
          })
        }}
      />

      {editingPlayer !== null && players.some((p) => p.playerId === editingPlayer) ? (
        <PlayerEditDialog
          player={players.find((p) => p.playerId === editingPlayer)!}
          published={publishedPlayers.get(editingPlayer)}
          onClose={() => setEditingPlayer(null)}
          onSave={(changes) => {
            // The dialog's three fields are replaced, not merged over. Merging
            // kept a field the reader had just set back to its published value,
            // so the override could never be cleared and an untouched save left
            // an empty entry that marked the row changed. Anything else the
            // entry carries -- an added player's team -- is kept.
            const key = String(editingPlayer)
            const rest = { ...(doc.players?.[key] ?? {}) }
            delete rest.nick
            delete rest.lane
            delete rest.fantasyRole
            onChange({
              ...doc,
              players: mergeEntry(
                doc.players,
                key,
                { ...rest, ...changes },
                publishedPlayers.has(editingPlayer),
              ),
            })
          }}
        />
      ) : null}

      {editingTeam && selected ? (
        <EditDialog
          open
          onOpenChange={(open) => !open && setEditingTeam(false)}
          title={
            <>
              Edit <Name>{selected.name}</Name>
            </>
          }
          description="Labels only — a roster's measurements come from the crawler."
          value={{
            name: selected.name,
            alsoTeamIds: selected.alsoTeamIds.join(", "),
          }}
          validate={(next) =>
            !next.name.trim()
              ? "Enter a team name."
              : parseIds(next.alsoTeamIds) === null
                ? "Also played under takes OpenDota team ids, digits only, separated by commas."
                : null
          }
          onSave={(next) => {
            // Diffed against the published team, as every other editor here
            // does. This wrote both fields on every save, so saving the dialog
            // untouched minted an override that agreed with the run.
            const key = String(selected.teamId)
            const base = publishedTeams.get(selected.teamId)
            const ids = parseIds(next.alsoTeamIds) ?? []
            const name = next.name.trim()
            const changes: TeamPatch = { ...(doc.teams?.[key] ?? {}) }
            delete changes.name
            delete changes.alsoTeamIds
            if (!base || name !== base.name) changes.name = name
            if (!base || ids.join(",") !== base.alsoTeamIds.join(",")) changes.alsoTeamIds = ids
            onChange({ ...doc, teams: mergeEntry(doc.teams, key, changes, base !== undefined) })
          }}
        >
          {(draft, set) => (
            <>
              <EditField label="Name" was={publishedTeams.get(selected.teamId)?.name}>
                <TextCell value={draft.name} onCommit={(v) => set("name", v)} />
              </EditField>

              <EditField
                label="Also played under"
                was={publishedTeams.get(selected.teamId)?.alsoTeamIds.join(", ") || "none"}
                hint="One org on two ids splits its evidence in half. Takes effect at the next crawl."
              >
                <TextCell
                  value={draft.alsoTeamIds}
                  placeholder="10182357, 9824702"
                  onCommit={(v) => set("alsoTeamIds", v)}
                />
              </EditField>
            </>
          )}
        </EditDialog>
      ) : null}

      {undoingPlayer !== null && doc.players?.[String(undoingPlayer)] ? (
        <UndoDialog
          open
          onOpenChange={(open) => !open && setUndoingPlayer(null)}
          title={
            <>
              Changes to <Name>{publishedPlayers.get(undoingPlayer)?.nick ?? "this player"}</Name>
            </>
          }
          rows={playerChangeRows(
            doc.players[String(undoingPlayer)],
            publishedPlayers.get(undoingPlayer),
          )}
          onUndo={() => dropKey("players", undoingPlayer)}
        />
      ) : null}

      {undoingTeam && selected && doc.teams?.[String(selected.teamId)] ? (
        <UndoDialog
          open
          onOpenChange={(open) => !open && setUndoingTeam(false)}
          title={
            <>
              Changes to <Name>{publishedTeams.get(selected.teamId)?.name ?? "this team"}</Name>
            </>
          }
          rows={teamChangeRows(
            doc.teams[String(selected.teamId)],
            publishedTeams.get(selected.teamId),
          )}
          onUndo={() => dropKey("teams", selected.teamId)}
        />
      ) : null}

      <ConfirmDialog request={pending} onClose={() => setPending(null)} />
    </div>
  )
}

/**
 * One player's labels.
 *
 * Its own component rather than another block inside the roster's render: the
 * roster is already a list beside a detail pane beside three dialogs, and a
 * fourth form inlined there is a file nobody can hold in their head.
 *
 * Only the fields that differ from the published run are handed back, so an
 * overlay never carries an entry that AGREES with the run -- a standing
 * instruction to hold a value if it ever changes, which is the silent revert
 * this design exists to avoid.
 */
function PlayerEditDialog({
  player,
  published,
  onClose,
  onSave,
}: {
  player: Player
  published: Player | undefined
  onClose: () => void
  onSave: (changes: PlayerPatch) => void
}) {
  return (
    <EditDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        <>
          Edit <Name>{player.nick}</Name>
        </>
      }
      description="Labels only — per-game stat lines come from the crawler."
      value={{ nick: player.nick, lane: player.lane, fantasyRole: player.fantasyRole }}
      onSave={(next) => {
        const changes: PlayerPatch = {}
        if (!published || next.nick !== published.nick) changes.nick = next.nick
        if (!published || next.lane !== published.lane) changes.lane = next.lane
        if (!published || next.fantasyRole !== published.fantasyRole) {
          changes.fantasyRole = next.fantasyRole
        }
        onSave(changes)
      }}
    >
      {(draft, set) => (
        <>
          <EditField label="Nickname" was={published?.nick}>
            <TextCell value={draft.nick} onCommit={(v) => set("nick", v)} />
          </EditField>

          <EditField
            label="Lane"
            was={published && LANE_LABEL[published.lane]}
            hint="The in-game position."
          >
            <SelectCell
              label="Lane"
              value={draft.lane}
              options={LANE_OPTIONS}
              width="w-full"
              onChange={(v) => set("lane", v as Lane)}
            />
          </EditField>

          <EditField
            label="Fantasy slot"
            was={published && ROLE_LABEL[published.fantasyRole]}
            hint="Core and support are duos; mid is one player."
          >
            <SelectCell
              label="Fantasy slot"
              value={draft.fantasyRole}
              options={ROLE_OPTIONS}
              width="w-full"
              onChange={(v) => set("fantasyRole", v as FantasyRole)}
            />
          </EditField>
        </>
      )}
    </EditDialog>
  )
}

/**
 * The fields an override actually moves, paired with what the run says.
 *
 * Built from the OVERLAY entry rather than by diffing two whole rows: the entry
 * already holds exactly the fields that differ, and diffing again would be a
 * second opinion on the same question.
 */
function playerChangeRows(entry: PlayerPatch, base: Player | undefined): ChangeRow[] {
  const rows: ChangeRow[] = []
  if (entry.nick !== undefined) rows.push({ label: "Nickname", was: base?.nick, now: entry.nick })
  if (entry.lane !== undefined) {
    rows.push({
      label: "Lane",
      was: base && LANE_LABEL[base.lane],
      now: LANE_LABEL[entry.lane],
    })
  }
  if (entry.fantasyRole !== undefined) {
    rows.push({
      label: "Fantasy slot",
      was: base && ROLE_LABEL[base.fantasyRole],
      now: ROLE_LABEL[entry.fantasyRole],
    })
  }
  return rows
}

function teamChangeRows(
  entry: NonNullable<ConfigOverlay["teams"]>[string],
  base: Team | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = []
  if (entry.name !== undefined) rows.push({ label: "Name", was: base?.name, now: entry.name })
  if (entry.alsoTeamIds !== undefined) {
    rows.push({
      label: "Also played under",
      was: base ? base.alsoTeamIds.join(", ") || "none" : undefined,
      now: entry.alsoTeamIds.join(", ") || "none",
    })
  }
  return rows
}
