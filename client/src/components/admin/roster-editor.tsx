import { useMemo, useState } from "react"
import { AlertTriangle, Pencil, Plus, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog"
import { EditDialog, EditField } from "@/components/admin/edit-dialog"
import { UndoDialog, type ChangeRow } from "@/components/admin/undo-dialog"
import {
  FilterField,
  RemovedChips,
  RowActions,
  SelectCell,
  TextCell,
  ValueCell,
} from "@/components/admin/cells"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { validateId } from "@/lib/admin-ui"
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
 * A list beside a detail pane, rather than sixteen expanding panels. Expanding
 * panels made the page grow with every team opened, so reading two of them
 * meant scrolling past the first; here the list is fixed height and scrolls
 * inside itself, and the page never grows at all. It also matches the job: a
 * roster edit is one team, because that is the unit that changes.
 */

/** Built from `lib/labels`, not re-listed here. The lane order is board order
 * -- position 1 through 5 -- and the labels are the ones every other screen
 * shows; a second copy of either is a second spelling waiting to drift. */
const LANE_OPTIONS = LANE_ORDER.map((lane) => ({ value: lane, label: LANE_LABEL[lane] }))
const ROLE_OPTIONS = ROLE_ORDER.map((role) => ({ value: role, label: ROLE_LABEL[role] }))

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

  return (
    <div className="grid gap-4">
      <Alert>
        <AlertTriangle aria-hidden />
        <AlertDescription>
          These are labels, not measurements. Per-game stat lines come from the crawler and
          nothing here can write one, so a player added now is carried through the tool as
          having no data and is absent from the pickers until the next{" "}
          <code>python -m scripts.publish</code>.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <Card className="h-fit">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Teams</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setAddingTeam(true)}>
                <Plus aria-hidden />
                Add
              </Button>
            </div>
            <FilterField
              value={filter}
              onChange={setFilter}
              label="Filter by team or player"
              summary={
                shown.length === inStage.length
                  ? `${inStage.length}`
                  : `${shown.length} of ${inStage.length}`
              }
            />
          </CardHeader>

          <CardContent className="px-2">
            {/* Scrolls inside itself, so sixteen teams do not set the height of
                the page and the detail pane stays where it was. */}
            <ul className="grid max-h-[28rem] gap-0.5 overflow-y-auto">
              {shown.map((team) => {
                const roster = byTeam.get(team.teamId) ?? []
                const noData = roster.filter((p) => !measured.has(p.playerId)).length
                const isSelected = selected?.teamId === team.teamId
                return (
                  <li key={team.teamId}>
                    <button
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setSelectedId(team.teamId)}
                      className={cn(
                        "focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none",
                        isSelected ? "bg-muted font-medium" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{team.name}</span>
                      {isTouched(team) ? (
                        <span
                          className="bg-primary size-1.5 shrink-0 rounded-full"
                          title="Edited in this draft"
                        />
                      ) : null}
                      {noData > 0 ? (
                        <Badge variant="destructive" title={`${noData} with no sample matrix`}>
                          {noData}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground shrink-0 text-2xs tabular-nums">
                        {roster.length}
                      </span>
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
              <p className="text-muted-foreground mt-2 px-1 text-2xs">
                {hidden} team{hidden === 1 ? "" : "s"} not in this stage are hidden. An
                overlay is per stage, and a team with no projection is absent from every
                picker anyway.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {selected ? (
          <Card>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="mr-auto">{selected.name}</CardTitle>
                <code className="text-muted-foreground text-2xs">{selected.teamId}</code>
                {!publishedTeams.has(selected.teamId) ? (
                  <Badge variant="secondary">new</Badge>
                ) : null}
                {!projected.has(selected.teamId) ? (
                  <Badge variant="outline" title="No projection in this stage">
                    no projection
                  </Badge>
                ) : null}
              </div>

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
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground text-xs">Also played under</dt>
                  <dd>
                    <ValueCell
                      value={
                        (
                          doc.teams?.[String(selected.teamId)]?.alsoTeamIds ??
                          selected.alsoTeamIds
                        ).join(", ") || "none"
                      }
                      changed={doc.teams?.[String(selected.teamId)]?.alsoTeamIds !== undefined}
                    />
                  </dd>
                </div>
              </dl>

            </CardHeader>

            <CardContent className="grid gap-3 px-0">
              <Table>
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
                            <code className="text-muted-foreground text-2xs">
                              {player.playerId}
                            </code>
                            {!measured.has(player.playerId) ? (
                              <Badge variant="destructive" title="No sample matrix in this run">
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
                                title: `Remove ${player.nick}?`,
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
                      title: `Remove ${selected.name}?`,
                      detail: `Its ${(byTeam.get(selected.teamId) ?? []).length} players go with it — a player on no team cannot be ranked at all.`,
                      confirmText: selected.name,
                      confirmLabel: "Remove team",
                      reversible: true,
                      onConfirm: () =>
                        onChange({
                          ...doc,
                          teamsRemoved: [...teamsRemoved, String(selected.teamId)],
                        }),
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
        )}
      </div>

      <RemovedChips
        label="Removed"
        entries={[
          ...teamsRemoved.map((id) => ({
            key: `team:${id}`,
            label: `team ${publishedTeams.get(Number(id))?.name ?? id}`,
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
        }}
      />

      <AddDialog
        open={addingPlayer}
        onOpenChange={setAddingPlayer}
        title={`Add a player to ${selected?.name ?? ""}`}
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
        ]}
        submitLabel="Add player"
        onSubmit={({ playerId, nick }) => {
          if (!selected) return
          onChange({
            ...doc,
            players: {
              ...(doc.players ?? {}),
              // Every field named: a player the run does not carry has nothing
              // to merge onto, and the server refuses a partial one rather than
              // filling in a lane nobody chose. Carry and core are a starting
              // point to correct, not a guess presented as a fact -- both
              // controls sit on the row that appears.
              [playerId]: { nick, teamId: selected.teamId, fantasyRole: "core", lane: "carry" },
            },
          })
        }}
      />

      {editingPlayer !== null && players.some((p) => p.playerId === editingPlayer) ? (
        <PlayerEditDialog
          player={players.find((p) => p.playerId === editingPlayer)!}
          published={publishedPlayers.get(editingPlayer)}
          onClose={() => setEditingPlayer(null)}
          onSave={(changes) =>
            onChange({
              ...doc,
              players: {
                ...(doc.players ?? {}),
                [String(editingPlayer)]: {
                  ...(doc.players?.[String(editingPlayer)] ?? {}),
                  ...changes,
                },
              },
            })
          }
        />
      ) : null}

      {editingTeam && selected ? (
        <EditDialog
          open
          onOpenChange={(open) => !open && setEditingTeam(false)}
          title={`Edit ${selected.name}`}
          description="Labels only — a roster's measurements come from the crawler."
          value={{
            name: selected.name,
            alsoTeamIds: selected.alsoTeamIds.join(", "),
          }}
          onSave={(next) =>
            onChange({
              ...doc,
              teams: {
                ...(doc.teams ?? {}),
                [String(selected.teamId)]: {
                  ...(doc.teams?.[String(selected.teamId)] ?? {}),
                  name: next.name,
                  alsoTeamIds: next.alsoTeamIds
                    .split(",")
                    .map((part) => Number(part.trim()))
                    .filter((n) => Number.isInteger(n) && n > 0),
                },
              },
            })
          }
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
          title={`Changes to ${publishedPlayers.get(undoingPlayer)?.nick ?? "this player"}`}
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
          title={`Changes to ${publishedTeams.get(selected.teamId)?.name ?? "this team"}`}
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
      title={`Edit ${player.nick}`}
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
