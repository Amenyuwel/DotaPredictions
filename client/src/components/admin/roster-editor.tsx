import { useMemo, useState } from "react"
import { AlertTriangle, Plus, Trash2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import {
  Cell,
  FilterField,
  LabelledField,
  RemovedChips,
  RowActions,
  SelectCell,
  TextCell,
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
import { ROLE_LABEL } from "@/lib/labels"
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

const LANES: Lane[] = ["carry", "mid", "offlane", "soft_support", "hard_support"]
const FANTASY_ROLES: FantasyRole[] = ["core", "mid", "support"]

const LANE_OPTIONS = LANES.map((lane) => ({ value: lane, label: lane.replace(/_/g, " ") }))
const ROLE_OPTIONS = FANTASY_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABEL[role] ?? role,
}))

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

  // Matches a team by its own name or by any of its players', so looking for a
  // person finds the team they are on rather than nothing.
  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? teams.filter(
        (team) =>
          team.name.toLowerCase().includes(needle) ||
          String(team.teamId).includes(needle) ||
          (byTeam.get(team.teamId) ?? []).some((p) => p.nick.toLowerCase().includes(needle)),
      )
    : teams

  // Derived, not stored: a stored selection survives a filter that excludes it,
  // or a team the overlay removed, and the detail pane then describes something
  // the list no longer offers.
  const selected = shown.find((team) => team.teamId === selectedId) ?? shown[0] ?? null

  const editTeam = (id: number, field: string, value: unknown) =>
    onChange({
      ...doc,
      teams: {
        ...(doc.teams ?? {}),
        [String(id)]: { ...(doc.teams?.[String(id)] ?? {}), [field]: value },
      },
    })

  const editPlayer = (id: number, field: keyof PlayerPatch, value: unknown) =>
    onChange({
      ...doc,
      players: {
        ...(doc.players ?? {}),
        [String(id)]: { ...(doc.players?.[String(id)] ?? {}), [field]: value },
      },
    })

  const dropKey = (bucket: "teams" | "players", id: number) => {
    const next = { ...(doc[bucket] ?? {}) } as Record<string, unknown>
    delete next[String(id)]
    onChange({ ...doc, [bucket]: Object.keys(next).length > 0 ? next : undefined })
  }

  const isTouched = (team: Team) =>
    Boolean(doc.teams?.[String(team.teamId)]) ||
    (byTeam.get(team.teamId) ?? []).some((p) => doc.players?.[String(p.playerId)])

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
                shown.length === teams.length ? `${teams.length}` : `${shown.length} of ${teams.length}`
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
                    not in stage
                  </Badge>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <LabelledField
                  label="Name"
                  changed={doc.teams?.[String(selected.teamId)]?.name !== undefined}
                  was={publishedTeams.get(selected.teamId)?.name}
                  onUndo={() => dropKey("teams", selected.teamId)}
                >
                  <TextCell
                    value={selected.name}
                    changed={doc.teams?.[String(selected.teamId)]?.name !== undefined}
                    onCommit={(v) => editTeam(selected.teamId, "name", v)}
                  />
                </LabelledField>

                <LabelledField
                  label="Also played under"
                  hint="One org on two ids splits its evidence in half. Takes effect at the next crawl."
                  changed={doc.teams?.[String(selected.teamId)]?.alsoTeamIds !== undefined}
                  was={publishedTeams.get(selected.teamId)?.alsoTeamIds.join(", ") || "none"}
                  onUndo={() => dropKey("teams", selected.teamId)}
                >
                  <TextCell
                    value={selected.alsoTeamIds.join(", ")}
                    changed={doc.teams?.[String(selected.teamId)]?.alsoTeamIds !== undefined}
                    placeholder="10182357, 9824702"
                    onCommit={(v) =>
                      editTeam(
                        selected.teamId,
                        "alsoTeamIds",
                        v
                          .split(",")
                          .map((part) => Number(part.trim()))
                          .filter((n) => Number.isInteger(n) && n > 0),
                      )
                    }
                  />
                </LabelledField>
              </div>
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
                    const was = publishedPlayers.get(player.playerId)
                    return (
                      <TableRow
                        key={player.playerId}
                        className={entry ? "bg-primary/5" : undefined}
                      >
                        <TableCell className="pl-6">
                          <Cell changed={entry?.nick !== undefined} was={was?.nick}>
                            <TextCell
                              value={player.nick}
                              changed={entry?.nick !== undefined}
                              className="w-36"
                              onCommit={(v) => editPlayer(player.playerId, "nick", v)}
                            />
                          </Cell>
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
                          <SelectCell
                            label={`${player.nick} lane`}
                            value={player.lane}
                            options={LANE_OPTIONS}
                            changed={entry?.lane !== undefined}
                            width="w-32"
                            onChange={(v) => editPlayer(player.playerId, "lane", v)}
                          />
                        </TableCell>

                        <TableCell>
                          <SelectCell
                            label={`${player.nick} fantasy slot`}
                            value={player.fantasyRole}
                            options={ROLE_OPTIONS}
                            changed={entry?.fantasyRole !== undefined}
                            width="w-28"
                            onChange={(v) => editPlayer(player.playerId, "fantasyRole", v)}
                          />
                        </TableCell>

                        <TableCell className="pr-6">
                          <RowActions
                            what={player.nick}
                            changed={Boolean(entry)}
                            onUndo={() => dropKey("players", player.playerId)}
                            onRemove={() =>
                              onChange({
                                ...doc,
                                playersRemoved: [...playersRemoved, String(player.playerId)],
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
                    onChange({ ...doc, teamsRemoved: [...teamsRemoved, String(selected.teamId)] })
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
    </div>
  )
}
