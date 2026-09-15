import { useMemo, useState } from "react"
import { AlertTriangle, ChevronRight, Plus, Search, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { Cell, SelectCell, TextCell, UndoCell } from "@/components/admin/cells"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { validateId } from "@/lib/admin-ui"
import { ROLE_LABEL } from "@/lib/labels"
import { cn } from "@/lib/utils"
import type { AdminConfig, ConfigOverlay } from "@/types/admin"
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
 * One team open at a time. Sixteen teams with five players each, all expanded,
 * was several thousand pixels to reach the one being corrected -- and a roster
 * edit is almost always one team, because that is the unit that changes. The
 * closed row still carries what you scan for: the name, the id, how many
 * players, and whether any of them have no data.
 */

const LANES: Lane[] = ["carry", "mid", "offlane", "soft_support", "hard_support"]
const FANTASY_ROLES: FantasyRole[] = ["core", "mid", "support"]

const LANE_OPTIONS = LANES.map((lane) => ({ value: lane, label: lane.replace(/_/g, " ") }))
const ROLE_OPTIONS = FANTASY_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABEL[role] ?? role,
}))

interface Props {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** From the server's own apply, or undefined while there are unsaved edits. */
  effective: { teams: Team[]; players: Player[] } | undefined
}

export function RosterEditor({ config, doc, onChange, effective }: Props) {
  const [addingTeam, setAddingTeam] = useState(false)
  // Which team a new player is being added to, or null when shut. One dialog
  // outside the list rather than one per team: N dialogs mounted for N teams is
  // N copies of a form only ever used once at a time.
  const [addingPlayerTo, setAddingPlayerTo] = useState<{ id: number; name: string } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState("")

  const teams = effective?.teams ?? config.published.teams
  const players = effective?.players ?? config.published.players
  const publishedTeams = new Map(config.published.teams.map((t) => [t.teamId, t]))
  const publishedPlayers = new Map(config.published.players.map((p) => [p.playerId, p]))
  const measured = new Set(config.measuredPlayerIds)
  const projected = new Set(config.projectedTeamIds)

  const teamsRemoved = new Set(doc.teamsRemoved ?? [])
  const playersRemoved = new Set(doc.playersRemoved ?? [])

  const byTeam = useMemo(() => {
    const map = new Map<number, Player[]>()
    for (const player of players) {
      map.set(player.teamId, [...(map.get(player.teamId) ?? []), player])
    }
    return map
  }, [players])

  const editTeam = (id: number, field: string, value: unknown) =>
    onChange({
      ...doc,
      teams: {
        ...(doc.teams ?? {}),
        [String(id)]: { ...(doc.teams?.[String(id)] ?? {}), [field]: value },
      },
    })

  const editPlayer = (id: number, field: string, value: unknown) =>
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

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Teams and players</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAddingTeam(true)}>
              <Plus aria-hidden />
              Add team
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Open a team to edit it. Removing a team removes its players with it — a player
            on no team cannot be ranked at all.
          </p>
          <div className="flex items-center gap-2">
            <label className="relative flex-1 sm:max-w-xs">
              <span className="sr-only">Filter teams and players</span>
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
              />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder="Filter by team or player"
                className="h-7 pl-7"
              />
            </label>
            <span className="text-muted-foreground text-2xs tabular-nums" aria-live="polite">
              {shown.length === teams.length
                ? `${teams.length} teams`
                : `${shown.length} of ${teams.length}`}
            </span>
          </div>
        </CardHeader>

        <CardContent className="grid gap-1.5">
          {shown.map((team) => {
            const was = publishedTeams.get(team.teamId)
            const entry = doc.teams?.[String(team.teamId)]
            const roster = byTeam.get(team.teamId) ?? []
            const noData = roster.filter((p) => !measured.has(p.playerId)).length
            const isOpen = open === team.teamId
            const touched =
              Boolean(entry) || roster.some((p) => doc.players?.[String(p.playerId)])

            return (
              <div
                key={team.teamId}
                className={cn("rounded-lg border", touched && "border-primary/40 bg-primary/5")}
              >
                {/* A real button, so Enter and Space work and the expanded state
                    is announced. `<details>` would have been fewer lines and
                    could not be closed from outside, which is what keeps one
                    team open at a time. */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : team.teamId)}
                  className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>
                  <code className="text-muted-foreground shrink-0 text-2xs">{team.teamId}</code>
                  {!was ? <Badge variant="secondary">new</Badge> : null}
                  {!projected.has(team.teamId) ? (
                    <Badge variant="outline" title="No projection in this stage">
                      not in stage
                    </Badge>
                  ) : null}
                  {noData > 0 ? (
                    <Badge variant="destructive" title="No sample matrix in this run">
                      {noData} no data
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground shrink-0 text-2xs tabular-nums">
                    {roster.length}
                  </span>
                </button>

                {isOpen ? (
                  <div className="grid gap-3 border-t px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field
                        label="Name"
                        changed={entry?.name !== undefined}
                        was={was?.name}
                        onRevert={() => dropKey("teams", team.teamId)}
                      >
                        <TextCell
                          value={team.name}
                          changed={entry?.name !== undefined}
                          onCommit={(v) => editTeam(team.teamId, "name", v)}
                        />
                      </Field>

                      <Field
                        label="Also played under"
                        hint="One org on two ids splits its evidence in half. Takes effect at the next crawl."
                        changed={entry?.alsoTeamIds !== undefined}
                        was={was?.alsoTeamIds.join(", ") || "none"}
                        onRevert={() => dropKey("teams", team.teamId)}
                      >
                        <TextCell
                          value={team.alsoTeamIds.join(", ")}
                          changed={entry?.alsoTeamIds !== undefined}
                          placeholder="10182357, 9824702"
                          onCommit={(v) =>
                            editTeam(
                              team.teamId,
                              "alsoTeamIds",
                              v
                                .split(",")
                                .map((part) => Number(part.trim()))
                                .filter((n) => Number.isInteger(n) && n > 0),
                            )
                          }
                        />
                      </Field>
                    </div>

                    <ul className="grid gap-1">
                      {roster.map((player) => {
                        const wasPlayer = publishedPlayers.get(player.playerId)
                        const playerEntry = doc.players?.[String(player.playerId)]
                        return (
                          <li
                            key={player.playerId}
                            className={cn(
                              "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
                              playerEntry && "border-primary/40 bg-primary/5",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <Cell changed={playerEntry?.nick !== undefined} was={wasPlayer?.nick}>
                                <TextCell
                                  value={player.nick}
                                  changed={playerEntry?.nick !== undefined}
                                  className="w-36"
                                  onCommit={(v) => editPlayer(player.playerId, "nick", v)}
                                />
                              </Cell>
                            </div>

                            <code className="text-muted-foreground shrink-0 text-2xs">
                              {player.playerId}
                            </code>

                            {!measured.has(player.playerId) ? (
                              <Badge variant="destructive" title="No sample matrix in this run">
                                no data
                              </Badge>
                            ) : null}

                            <SelectCell
                              label={`${player.nick} lane`}
                              value={player.lane}
                              options={LANE_OPTIONS}
                              changed={playerEntry?.lane !== undefined}
                              width="w-32"
                              onChange={(v) => editPlayer(player.playerId, "lane", v)}
                            />
                            <SelectCell
                              label={`${player.nick} fantasy slot`}
                              value={player.fantasyRole}
                              options={ROLE_OPTIONS}
                              changed={playerEntry?.fantasyRole !== undefined}
                              width="w-28"
                              onChange={(v) => editPlayer(player.playerId, "fantasyRole", v)}
                            />

                            <div className="flex items-center gap-0.5">
                              <UndoCell
                                changed={Boolean(playerEntry)}
                                what={player.nick}
                                onRevert={() => dropKey("players", player.playerId)}
                              />
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-destructive size-7"
                                aria-label={`Remove ${player.nick}`}
                                onClick={() =>
                                  onChange({
                                    ...doc,
                                    playersRemoved: [...playersRemoved, String(player.playerId)],
                                  })
                                }
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs"
                        onClick={() => setAddingPlayerTo({ id: team.teamId, name: team.name })}
                      >
                        <Plus aria-hidden />
                        Add player
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive ml-auto text-xs"
                        onClick={() =>
                          onChange({
                            ...doc,
                            teamsRemoved: [...teamsRemoved, String(team.teamId)],
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                        Remove team
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          {shown.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No team or player matches “{filter}”.
            </p>
          ) : null}

          {teamsRemoved.size > 0 || playersRemoved.size > 0 ? (
            <div className="grid gap-1.5 rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">Removed</p>
              <div className="flex flex-wrap gap-1.5">
                {[...teamsRemoved].map((id) => (
                  <Button
                    key={`t${id}`}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      onChange({
                        ...doc,
                        teamsRemoved: [...teamsRemoved].filter((k) => k !== id),
                      })
                    }
                  >
                    <Undo2 aria-hidden />
                    {publishedTeams.get(Number(id))?.name ?? id}
                  </Button>
                ))}
                {[...playersRemoved].map((id) => (
                  <Button
                    key={`p${id}`}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      onChange({
                        ...doc,
                        playersRemoved: [...playersRemoved].filter((k) => k !== id),
                      })
                    }
                  >
                    <Undo2 aria-hidden />
                    {publishedPlayers.get(Number(id))?.nick ?? id}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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
          setOpen(Number(teamId))
        }}
      />

      <AddDialog
        open={addingPlayerTo !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAddingPlayerTo(null)
        }}
        title={`Add a player to ${addingPlayerTo?.name ?? ""}`}
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
          if (!addingPlayerTo) return
          onChange({
            ...doc,
            players: {
              ...(doc.players ?? {}),
              // Every field named: a player the run does not carry has nothing
              // to merge onto, and the server refuses a partial one rather than
              // filling in a lane nobody chose. Carry and core are a starting
              // point to correct, not a guess presented as a fact -- both
              // controls sit on the row that appears.
              [playerId]: {
                nick,
                teamId: addingPlayerTo.id,
                fantasyRole: "core",
                lane: "carry",
              },
            },
          })
        }}
      />
    </div>
  )
}

/** A labelled control with a reserved line under it, so a row keeps its height
 * whether or not it has been edited. */
function Field({
  label,
  hint,
  changed,
  was,
  onRevert,
  children,
}: {
  label: string
  hint?: string
  changed: boolean
  was?: string
  onRevert: () => void
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-end justify-between gap-2">
        <label className="grid min-w-0 flex-1 gap-1">
          <span className="text-xs font-medium">{label}</span>
          {children}
        </label>
        <UndoCell changed={changed} what={label} onRevert={onRevert} />
      </div>
      <p className="text-muted-foreground min-h-4 text-2xs">
        {changed && was ? `was ${was}` : hint}
      </p>
    </div>
  )
}
