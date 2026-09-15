import { useMemo, useState } from "react"
import { Plus, Search, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { Cell, NumberCell, PercentCell, SelectCell, TextCell, UndoCell } from "@/components/admin/cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { validateKey } from "@/lib/admin-ui"
import { tierLabel, traitLabel } from "@/lib/emblem-catalog"
import type { AdminConfig, ConfigOverlay } from "@/types/admin"
import type { Scoring } from "@/types/run"

/**
 * The scoring table: stats, emblem tiers, traits, and the colour rules.
 *
 * This is the half of a run recomputed on every request, which is what makes
 * editing it possible without a re-crawl -- and what makes it the most
 * dangerous form here. A per-unit value multiplies every projection on the
 * public page, and no arithmetic anywhere would notice a decimal point in the
 * wrong place.
 *
 * Laid out as tables rather than as a card per stat. Eighteen stats as cards,
 * four stacked labelled fields each, was about five thousand pixels of
 * scrolling -- to do a job that is almost entirely comparison. Checking a
 * scoring table against the client means reading values against each other, and
 * values that are never on screen together cannot be compared at all.
 *
 * So: one row per stat, every attribute a column, changed cells marked in
 * place with what the published run said beside them. The whole table fits on
 * roughly one screen, which is the point.
 */

/** The rules the scorer actually implements. A closed list because they are
 * code: a trait naming something else pays nothing, and a trait naming nothing
 * pays ALWAYS -- the quiet way for every score to go up. */
const CONDITION_RULES = [
  { value: "always", label: "Always" },
  { value: "neighboursOnly", label: "Neighbours only" },
  { value: "allQualitiesDiffer", label: "All qualities differ" },
  { value: "countAtLeast3", label: "3+ of this trait" },
  { value: "onlyOne", label: "Only one" },
  { value: "never", label: "Never" },
] as const

const RULE_DETAIL: Record<string, string> = {
  always: "No condition. Pays its bonus on every banner.",
  neighboursOnly: "Pays nothing to itself; the adjacent bonus is the whole effect.",
  allQualitiesDiffer: "Fires only when every tier on the banner is distinct. Fractal's rule.",
  countAtLeast3: "Fires when three or more emblems carry it. Friendly's rule.",
  onlyOne: "Fires when exactly one emblem carries it. Unique's rule.",
  never: "Never pays its own bonus.",
}

type Patch = NonNullable<ConfigOverlay["scoring"]>

interface Props {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** The table as it would be served with this overlay on it, from the server's
   * own `applyOverlay`. Undefined while the draft has unsaved edits: guessing it
   * in the browser would be a second implementation of the thing being
   * previewed, and its disagreement with the first would be invisible. */
  effective: Scoring | undefined
}

export function ScoringEditor({ config, doc, onChange, effective }: Props) {
  const published = config.published.scoring
  const scoring = effective ?? published
  const patch = doc.scoring ?? {}
  const setScoring = (next: Patch) => onChange({ ...doc, scoring: next })

  return (
    <div className="grid gap-4">
      <StatsTable
        config={config}
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
      />
      <TraitsTable
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
      />
      <QualityTable
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
      />
      <ColorsPanel
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// shared patch helpers
// ---------------------------------------------------------------------------

/**
 * Drop a key, and the map with it once empty.
 *
 * Dropping rather than writing the published value back. An overlay entry that
 * agrees with the run is not nothing -- it is a standing instruction to hold
 * that value if the run ever changes, which is the silent revert this whole
 * design exists to prevent. An empty map left behind is the same problem in
 * miniature: it still counts as a change and still publishes.
 */
function without<T extends object>(map: T | undefined, key: string): T | undefined {
  if (!map || !(key in map)) return map
  const next = { ...map } as Record<string, unknown>
  delete next[key]
  return (Object.keys(next).length > 0 ? next : undefined) as T | undefined
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

function StatsTable({
  config,
  scoring,
  published,
  patch,
  setScoring,
}: {
  config: AdminConfig
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
}) {
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState("")
  const removed = new Set(patch.statsRemoved ?? [])

  const edit = (key: string, field: string, value: unknown) =>
    setScoring({
      ...patch,
      stats: { ...(patch.stats ?? {}), [key]: { ...(patch.stats?.[key] ?? {}), [field]: value } },
    })

  const colorOptions = useMemo(
    () => scoring.colors.map((c) => ({ value: c, label: c })),
    [scoring.colors],
  )
  const sourceOptions = useMemo(
    () => [
      { value: "__none__", label: "none" },
      ...config.sourceColumns.map((c) => ({ value: c, label: c })),
    ],
    [config.sourceColumns],
  )

  const keys = Object.keys(scoring.stats)
    .sort()
    .filter((key) => key.includes(filter.trim().toLowerCase()))

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Stats</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add stat
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          What each stat pays, and which emblem colour carries it. A player scores only the
          stats on their banner, so these values are the whole ranking. A source column
          cannot be invented — one that does not exist makes the stat pay its flat base on
          every game, silently.
        </p>
        <Filter
          value={filter}
          onChange={setFilter}
          label="Filter stats"
          count={keys.length}
          total={Object.keys(scoring.stats).length}
        />
      </CardHeader>

      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Stat</TableHead>
              <TableHead>Per unit</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Colour</TableHead>
              <TableHead>Source column</TableHead>
              <TableHead className="pr-6 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => {
              const spec = scoring.stats[key]!
              const was = published.stats[key]
              const entry = patch.stats?.[key]
              return (
                <TableRow key={key} className={entry ? "bg-primary/5" : undefined}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs">{key}</code>
                      {!was ? <Badge variant="secondary">new</Badge> : null}
                      {!spec.measurable ? (
                        <Badge
                          variant="outline"
                          title="Excluded from emblem choice, never scored as zero"
                        >
                          no data
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Cell changed={entry?.perUnit !== undefined} was={was?.perUnit}>
                      <NumberCell
                        value={spec.perUnit}
                        changed={entry?.perUnit !== undefined}
                        onCommit={(v) => edit(key, "perUnit", v)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell>
                    <Cell changed={entry?.base !== undefined} was={was?.base}>
                      <NumberCell
                        value={spec.base}
                        changed={entry?.base !== undefined}
                        onCommit={(v) => edit(key, "base", v)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell>
                    <Cell changed={entry?.color !== undefined} was={was?.color}>
                      <SelectCell
                        label={`${key} colour`}
                        value={spec.color}
                        options={colorOptions}
                        changed={entry?.color !== undefined}
                        width="w-28"
                        onChange={(v) => edit(key, "color", v)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell>
                    <Cell
                      changed={entry?.source !== undefined}
                      was={was ? (was.source ?? "none") : undefined}
                    >
                      <SelectCell
                        label={`${key} source column`}
                        value={spec.source ?? "__none__"}
                        options={sourceOptions}
                        changed={entry?.source !== undefined}
                        width="w-44"
                        format={(v) => (v === "__none__" ? "none" : v)}
                        onChange={(v) => {
                          const source = v === "__none__" ? null : v
                          setScoring({
                            ...patch,
                            stats: {
                              ...(patch.stats ?? {}),
                              [key]: {
                                ...(patch.stats?.[key] ?? {}),
                                source,
                                // Measurability follows the source rather than
                                // being a second switch that can disagree with
                                // it. Marking a stat measurable with nothing
                                // behind it is a claim the server refuses, so
                                // the form does not offer the combination.
                                measurable: source !== null,
                              },
                            },
                          })
                        }}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell className="pr-6">
                    <div className="flex items-center justify-end gap-0.5">
                      <UndoCell
                        changed={Boolean(entry)}
                        what={key}
                        onRevert={() => setScoring({ ...patch, stats: without(patch.stats, key) })}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive size-7"
                        aria-label={`Remove ${key}`}
                        onClick={() =>
                          setScoring({
                            ...patch,
                            stats: without(patch.stats, key),
                            statsRemoved: [...removed, key],
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}

            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No stat matches “{filter}”.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {removed.size > 0 ? (
          <RemovedRow
            label="Removed stats"
            hint="Every emblem carrying one of these disappears with it — a stat that pays nothing and an emblem that cannot be built are the same statement."
            keys={[...removed]}
            onRestore={(key) =>
              setScoring({ ...patch, statsRemoved: [...removed].filter((k) => k !== key) })
            }
          />
        ) : null}
      </CardContent>

      <AddDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a stat"
        description="It starts unmeasured and paying nothing. Point it at a source column and set its value once it exists."
        fields={[
          {
            name: "key",
            label: "Stat key",
            placeholder: "courier_kills",
            hint: "As the scoring table names it.",
            validate: validateKey,
          },
        ]}
        submitLabel="Add stat"
        onSubmit={({ key }) =>
          setScoring({
            ...patch,
            stats: {
              ...(patch.stats ?? {}),
              // Every field named: a stat the run does not carry has nothing to
              // merge onto, and the server refuses a partial one rather than
              // filling in zeros that would look chosen.
              [key]: {
                perUnit: 0,
                base: 0,
                color: scoring.colors[0] ?? "red",
                measurable: false,
                source: null,
              },
            },
          })
        }
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// traits
// ---------------------------------------------------------------------------

function TraitsTable({
  scoring,
  published,
  patch,
  setScoring,
}: {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
}) {
  const [adding, setAdding] = useState(false)
  const removed = new Set(patch.traitsRemoved ?? [])

  const edit = (key: string, field: string, value: unknown) =>
    setScoring({
      ...patch,
      traits: { ...(patch.traits ?? {}), [key]: { ...(patch.traits?.[key] ?? {}), [field]: value } },
    })

  const pct = (v: number | undefined) =>
    v === undefined ? undefined : `${Math.round(v * 1000) / 10}%`

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Emblem traits</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add trait
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          What a trait pays itself, and what it does to the emblem on either side. The
          adjacent bonus is why a banner’s value depends on the ORDER of its emblems. The
          rule is code, not prose — a trait without one pays on every banner.
        </p>
      </CardHeader>

      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Trait</TableHead>
              <TableHead>Own bonus</TableHead>
              <TableHead>Each neighbour</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Condition, in words</TableHead>
              <TableHead className="pr-6 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(scoring.traits).map(([name, spec]) => {
              const was = published.traits[name]
              const entry = patch.traits?.[name]
              return (
                <TableRow key={name} className={entry ? "bg-primary/5" : undefined}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{traitLabel(name)}</span>
                      {!was ? <Badge variant="secondary">new</Badge> : null}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Cell changed={entry?.bonus !== undefined} was={pct(was?.bonus)}>
                      <PercentCell
                        value={spec.bonus}
                        changed={entry?.bonus !== undefined}
                        onCommit={(v) => edit(name, "bonus", v)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell>
                    <Cell
                      changed={entry?.adjacentBonus !== undefined}
                      was={pct(was?.adjacentBonus)}
                    >
                      <PercentCell
                        value={spec.adjacentBonus}
                        changed={entry?.adjacentBonus !== undefined}
                        onCommit={(v) => edit(name, "adjacentBonus", v)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell>
                    <Cell
                      changed={entry?.conditionRule !== undefined}
                      was={was?.conditionRule ?? undefined}
                    >
                      <SelectCell
                        label={`${name} condition rule`}
                        value={spec.conditionRule ?? ""}
                        options={CONDITION_RULES}
                        changed={entry?.conditionRule !== undefined}
                        width="w-44"
                        format={(v) =>
                          CONDITION_RULES.find((r) => r.value === v)?.label ?? "Name the rule"
                        }
                        onChange={(v) => edit(name, "conditionRule", v)}
                      />
                    </Cell>
                    <p className="text-muted-foreground mt-0.5 max-w-52 text-2xs whitespace-normal">
                      {RULE_DETAIL[spec.conditionRule ?? ""] ??
                        "No rule named — scored as paying nothing."}
                    </p>
                  </TableCell>

                  <TableCell>
                    <Cell changed={entry?.condition !== undefined}>
                      <TextCell
                        value={spec.condition ?? ""}
                        changed={entry?.condition !== undefined}
                        placeholder="all emblem qualities differ"
                        className="w-56"
                        onCommit={(v) => edit(name, "condition", v || null)}
                      />
                    </Cell>
                  </TableCell>

                  <TableCell className="pr-6">
                    <div className="flex items-center justify-end gap-0.5">
                      <UndoCell
                        changed={Boolean(entry)}
                        what={name}
                        onRevert={() => setScoring({ ...patch, traits: without(patch.traits, name) })}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive size-7"
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          setScoring({
                            ...patch,
                            traits: without(patch.traits, name),
                            traitsRemoved: [...removed, name],
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {removed.size > 0 ? (
          <RemovedRow
            label="Removed traits"
            keys={[...removed]}
            onRestore={(key) =>
              setScoring({ ...patch, traitsRemoved: [...removed].filter((k) => k !== key) })
            }
          />
        ) : null}
      </CardContent>

      <AddDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an emblem trait"
        description="It starts unconditional and paying nothing. Set its bonus and rule once it exists."
        fields={[
          {
            name: "key",
            label: "Trait key",
            placeholder: "voracious",
            hint: "Lower case, as the scoring table names it.",
            validate: validateKey,
          },
        ]}
        submitLabel="Add trait"
        onSubmit={({ key }) =>
          setScoring({
            ...patch,
            traits: {
              ...(patch.traits ?? {}),
              // The rule is set, not left blank. A trait with no rule pays on
              // every banner, which is how every score on the public page goes
              // up with nothing looking broken.
              [key]: { bonus: 0, adjacentBonus: 0, conditionRule: "always", condition: null },
            },
          })
        }
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------

function QualityTable({
  scoring,
  published,
  patch,
  setScoring,
}: {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
}) {
  const [adding, setAdding] = useState(false)
  const removed = new Set(patch.qualityRemoved ?? [])

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Emblem quality</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add tier
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          What each tier adds to an emblem’s multiplier. Quality is not rerollable in the
          client, so these are the fixed rungs a banner is built from. A new tier adds a
          catalog row for every stat and every trait.
        </p>
      </CardHeader>

      {/* A row of tiles rather than a table: five short numeric values, where a
          five-row table would be mostly chrome. */}
      <CardContent className="flex flex-wrap gap-2">
        {Object.entries(scoring.quality).map(([tier, bonus]) => {
          const changed = patch.quality?.[tier] !== undefined
          const was = published.quality[tier]
          return (
            <div
              key={tier}
              className={`grid w-36 gap-1 rounded-lg border p-2 ${changed ? "border-primary/40 bg-primary/5" : ""}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium">{tierLabel(tier)}</span>
                <div className="flex items-center">
                  <UndoCell
                    changed={changed}
                    what={tierLabel(tier)}
                    onRevert={() => setScoring({ ...patch, quality: without(patch.quality, tier) })}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive size-7"
                    aria-label={`Remove ${tierLabel(tier)}`}
                    onClick={() =>
                      setScoring({
                        ...patch,
                        quality: without(patch.quality, tier),
                        qualityRemoved: [...removed, tier],
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <PercentCell
                value={bonus}
                changed={changed}
                onCommit={(v) =>
                  setScoring({ ...patch, quality: { ...(patch.quality ?? {}), [tier]: v } })
                }
              />
              <p className="text-muted-foreground min-h-4 text-2xs">
                {changed && was !== undefined ? `was ${Math.round(was * 1000) / 10}%` : null}
              </p>
            </div>
          )
        })}

        {removed.size > 0 ? (
          <RemovedRow
            label="Removed tiers"
            keys={[...removed]}
            onRestore={(key) =>
              setScoring({ ...patch, qualityRemoved: [...removed].filter((k) => k !== key) })
            }
          />
        ) : null}
      </CardContent>

      <AddDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an emblem tier"
        description="A new tier adds a catalog row for every stat and every trait."
        fields={[
          {
            name: "key",
            label: "Tier key",
            placeholder: "tier_vi",
            hint: "The client stamps the numeral; this is the key behind it.",
            validate: validateKey,
          },
        ]}
        submitLabel="Add tier"
        onSubmit={({ key }) =>
          setScoring({ ...patch, quality: { ...(patch.quality ?? {}), [key]: 0 } })
        }
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------

function ColorsPanel({
  scoring,
  published,
  patch,
  setScoring,
}: {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
}) {
  const rows = scoring.bannerColors ?? {}

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Colours and slots</CardTitle>
        <p className="text-muted-foreground text-xs">
          The palette, and the colour of each banner slot by role. Not a preference and not
          one-of-each: a Core banner is three reds and two greens, and Support has no red
          slot at all. A row naming a colour no stat carries makes that slot unfillable, and
          the server refuses it rather than letting a picker come up empty.
        </p>
      </CardHeader>

      <CardContent className="grid gap-2 sm:grid-cols-2">
        <Labelled
          label="Palette"
          changed={patch.colors !== undefined}
          was={published.colors.join(", ")}
          onRevert={() => setScoring({ ...patch, colors: undefined })}
        >
          <TextCell
            value={scoring.colors.join(", ")}
            changed={patch.colors !== undefined}
            onCommit={(v) => setScoring({ ...patch, colors: commaList(v) })}
          />
        </Labelled>

        {Object.entries(rows).map(([role, row]) => (
          <Labelled
            key={role}
            label={`${role} slots`}
            changed={patch.bannerColors?.[role] !== undefined}
            was={published.bannerColors?.[role]?.join(", ")}
            onRevert={() => {
              const next = { ...(patch.bannerColors ?? {}) }
              delete next[role]
              setScoring({
                ...patch,
                bannerColors: Object.keys(next).length > 0 ? next : undefined,
              })
            }}
          >
            <TextCell
              value={row.join(", ")}
              changed={patch.bannerColors?.[role] !== undefined}
              onCommit={(v) => {
                const next = { ...(patch.bannerColors ?? {}) }
                const parsed = commaList(v)
                // An emptied row means "leave the published one alone" rather
                // than "this role has no slots". A banner with no slots is not
                // a shape, and refusing a half-typed field is not the moment to
                // say so.
                if (parsed) next[role] = parsed
                else delete next[role]
                setScoring({
                  ...patch,
                  bannerColors: Object.keys(next).length > 0 ? next : undefined,
                })
              }}
            />
          </Labelled>
        ))}

        {Object.keys(rows).length === 0 ? (
          <p className="text-muted-foreground text-xs">
            This run carries no slot-colour rule. Adding one here would be introducing the
            rule rather than correcting it — check every row against the client first.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// small shared pieces
// ---------------------------------------------------------------------------

function Labelled({
  label,
  changed,
  was,
  onRevert,
  children,
}: {
  label: string
  changed: boolean
  was?: string
  onRevert: () => void
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-sm font-medium">{label}</span>
          {children}
        </label>
        <UndoCell changed={changed} what={label} onRevert={onRevert} />
      </div>
      {/* Reserved, so the row keeps its height whether or not it is changed. */}
      <p className="text-muted-foreground min-h-4 text-2xs">
        {changed && was ? `was ${was}` : null}
      </p>
    </div>
  )
}

function Filter({
  value,
  onChange,
  label,
  count,
  total,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  count: number
  total: number
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative flex-1 sm:max-w-xs">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={label}
          className="h-7 pl-7"
        />
      </label>
      {/* Announced, because filtering changes what is on screen without moving
          focus -- and scoped to the count alone rather than the table. */}
      <span className="text-muted-foreground text-2xs tabular-nums" aria-live="polite">
        {count === total ? `${total}` : `${count} of ${total}`}
      </span>
    </div>
  )
}

function RemovedRow({
  label,
  hint,
  keys,
  onRestore,
}: {
  label: string
  hint?: string
  keys: string[]
  onRestore: (key: string) => void
}) {
  return (
    <div className="mx-6 mt-3 grid gap-1.5 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <Button
            key={key}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onRestore(key)}
          >
            <Undo2 aria-hidden />
            {key}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A comma-separated list, or undefined when empty.
 *
 * The contract types these as non-empty -- a palette with no colours and a
 * banner row with no slots are both meaningless -- so an emptied field drops
 * the override rather than publishing a list of nothing.
 */
function commaList(value: string): [string, ...string[]] | undefined {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? (parts as [string, ...string[]]) : undefined
}
