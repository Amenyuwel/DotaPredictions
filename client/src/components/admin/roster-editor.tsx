import { useState } from "react"
import { AlertTriangle, Plus, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { validateId } from "@/lib/admin-ui"
import { FieldRow, TextField } from "@/components/admin/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ROLE_LABEL } from "@/lib/labels"
import type { AdminConfig, ConfigOverlay } from "@/types/admin"
import type { FantasyRole, Lane, Player, Team } from "@/types/run"

/**
 * Teams and players.
 *
 * The honest boundary of this whole feature runs through here. Everything on
 * the scoring tab is a table the server reads on every request, so editing it
 * takes effect immediately and exactly. A roster is not: a player's per-game
 * stat lines come from the crawler, and nothing in this form can produce one.
 *
 * So what this edits is metadata -- who is on which team, in which slot, under
 * which name. Adding a player is legal and useful (a stand-in announced before
 * the next crawl), and the tool then says so everywhere rather than ranking
 * them: no sample matrix means no distribution to draw from, and a player
 * scored from nothing would look like a weak player rather than an unknown one.
 *
 * That distinction is marked on every row, because it is the one thing about
 * this tab that would otherwise be invisible.
 */

const LANES: Lane[] = ["carry", "mid", "offlane", "soft_support", "hard_support"]
const FANTASY_ROLES: FantasyRole[] = ["core", "mid", "support"]

interface Props {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** From the server's own apply, or undefined while there are unsaved edits. */
  effective: { teams: Team[]; players: Player[] } | undefined
}

export function RosterEditor({ config, doc, onChange, effective }: Props) {
  const [addingTeam, setAddingTeam] = useState(false)
  // Which team a new player is being added to, or null when the dialog is shut.
  // Held rather than passed, because the dialog is one element outside the list
  // instead of one per team: N dialogs mounted for N teams is N copies of a
  // form only ever used once at a time.
  const [addingPlayerTo, setAddingPlayerTo] = useState<{ id: number; name: string } | null>(null)
  const teams = effective?.teams ?? config.published.teams
  const players = effective?.players ?? config.published.players
  const publishedTeams = new Map(config.published.teams.map((t) => [t.teamId, t]))
  const publishedPlayers = new Map(config.published.players.map((p) => [p.playerId, p]))
  const measured = new Set(config.measuredPlayerIds)
  const projected = new Set(config.projectedTeamIds)

  const teamsRemoved = new Set(doc.teamsRemoved ?? [])
  const playersRemoved = new Set(doc.playersRemoved ?? [])

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

  const byTeam = new Map<number, Player[]>()
  for (const player of players) {
    byTeam.set(player.teamId, [...(byTeam.get(player.teamId) ?? []), player])
  }

  return (
    <div className="grid gap-4">
      <Alert>
        <AlertTriangle aria-hidden />
        <AlertDescription>
          These are labels, not measurements. A player's per-game stat lines come from the
          crawler and nothing here can write one, so a player added now is carried through
          the tool as having no data and is absent from the pickers until the next
          <code className="mx-1">publish.py</code> run. That is deliberate: a player scored
          from nothing would read as a weak player rather than an unknown one.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Teams and players</CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Removing a team removes its players with it - a player on no team cannot be
              ranked at all.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddingTeam(true)}>
            <Plus aria-hidden />
            Add team
          </Button>
        </CardHeader>

        <CardContent className="grid gap-4">
          {teams.map((team) => {
            const was = publishedTeams.get(team.teamId)
            const entry = doc.teams?.[String(team.teamId)]
            const roster = byTeam.get(team.teamId) ?? []

            return (
              <div key={team.teamId} className="grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{team.name}</span>
                  <code className="text-muted-foreground text-xs">{team.teamId}</code>
                  {!was ? <Badge variant="secondary">added</Badge> : null}
                  {!projected.has(team.teamId) ? (
                    <Badge
                      variant="outline"
                      title="No projection in this stage - eliminated, or not in this field"
                    >
                      not in this stage
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    {entry ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-xs"
                        onClick={() => dropKey("teams", team.teamId)}
                      >
                        <Undo2 aria-hidden />
                        Undo all
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 px-1.5 text-xs"
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

                <div className="grid gap-2 sm:grid-cols-2">
                  <FieldRow
                    label="Name"
                    changed={entry?.name !== undefined}
                    wasLabel={was?.name}
                    onRevert={() => dropKey("teams", team.teamId)}
                  >
                    <TextField value={team.name} onCommit={(v) => editTeam(team.teamId, "name", v)} />
                  </FieldRow>

                  <FieldRow
                    label="Also played under (team ids)"
                    hint="Load-bearing, not cosmetic: one org carrying two ids splits its evidence in half and the model rates it on the remainder. Takes effect at the NEXT crawl - the samples already gathered were attributed under whatever ids the last one knew."
                    changed={entry?.alsoTeamIds !== undefined}
                    wasLabel={was?.alsoTeamIds.join(", ") || "none"}
                    onRevert={() => dropKey("teams", team.teamId)}
                  >
                    <TextField
                      value={team.alsoTeamIds.join(", ")}
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
                  </FieldRow>
                </div>

                <div className="grid gap-2">
                  {roster.map((player) => {
                    const wasPlayer = publishedPlayers.get(player.playerId)
                    const playerEntry = doc.players?.[String(player.playerId)]
                    return (
                      <div
                        key={player.playerId}
                        className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[1fr_auto_auto_auto]"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <TextField
                              value={player.nick}
                              onCommit={(v) => editPlayer(player.playerId, "nick", v)}
                            />
                            {!wasPlayer ? <Badge variant="secondary">added</Badge> : null}
                            {!measured.has(player.playerId) ? (
                              <Badge variant="destructive" title="No sample matrix in this run">
                                no data
                              </Badge>
                            ) : null}
                          </div>
                          <code className="text-muted-foreground text-xs">
                            {player.playerId}
                          </code>
                        </div>

                        <LabelledSelect
                          label="Lane"
                          value={player.lane}
                          options={LANES}
                          onChange={(v) => editPlayer(player.playerId, "lane", v)}
                        />
                        <LabelledSelect
                          label="Fantasy slot"
                          value={player.fantasyRole}
                          options={FANTASY_ROLES}
                          format={(v) => ROLE_LABEL[v as FantasyRole] ?? v}
                          onChange={(v) => editPlayer(player.playerId, "fantasyRole", v)}
                        />

                        <div className="flex items-start gap-1">
                          {playerEntry ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-1.5 text-xs"
                              onClick={() => dropKey("players", player.playerId)}
                            >
                              <Undo2 aria-hidden />
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 px-1.5 text-xs"
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
                      </div>
                    )
                  })}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() => setAddingPlayerTo({ id: team.teamId, name: team.name })}
                  >
                    <Plus aria-hidden />
                    Add player to {team.name}
                  </Button>
                </div>
              </div>
            )
          })}

          {(teamsRemoved.size > 0 || playersRemoved.size > 0) && (
            <div className="grid gap-2 rounded-lg border p-3">
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
                    team {publishedTeams.get(Number(id))?.name ?? id}
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
          )}
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
        onSubmit={({ teamId, name }) =>
          onChange({ ...doc, teams: { ...(doc.teams ?? {}), [teamId]: { name } } })
        }
      />

      <AddDialog
        open={addingPlayerTo !== null}
        onOpenChange={(open) => {
          if (!open) setAddingPlayerTo(null)
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

function LabelledSelect({
  label,
  value,
  options,
  onChange,
  format,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  format?: (value: string) => string
}) {
  const show = format ?? ((v: string) => v.replace(/_/g, " "))
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger size="sm" aria-label={label} className="min-w-32">
          <SelectValue>{(v: string) => show(v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {show(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
