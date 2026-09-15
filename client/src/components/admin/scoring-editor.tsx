import { useMemo, useState } from "react"
import { ChevronRight, Plus } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog"
import { EditDialog, EditField } from "@/components/admin/edit-dialog"
import { UndoDialog, type ChangeRow } from "@/components/admin/undo-dialog"
import {
  FilterField,
  LabelledField,
  NumberCell,
  PercentCell,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMediaQuery } from "@/hooks/use-media-query"
import { validateKey } from "@/lib/admin-ui"
import { tierLabel, traitLabel } from "@/lib/emblem-catalog"
import { capitalize, ROLE_LABEL, statLabel } from "@/lib/labels"
import type { FantasyRole } from "@/types/run"
import type { AdminConfig, ConfigOverlay, StatPatch, TraitPatch } from "@/types/admin"
import type { Scoring } from "@/types/run"

/**
 * The scoring table: stats, emblem tiers, traits, and the colour rules.
 *
 * This is the half of a run recomputed on every request, which is what makes
 * editing it possible without a re-crawl -- and what makes it the most
 * dangerous form here. A per-unit value multiplies every projection on the
 * public page, and no arithmetic anywhere would notice a misplaced decimal.
 *
 * Laid out as tables across the full width. Checking a scoring table against
 * the client is comparison work, and values that are never on screen together
 * cannot be compared at all -- so the shape of the page follows from the job:
 * one row per stat, every attribute a column, nothing folded away.
 *
 * Four tables, one at a time, behind a tab strip. Stacked, they were four
 * screens of scrolling to reach the one being edited, and nothing was gained
 * by the other three being below the fold rather than behind a tab -- they were
 * not comparable with each other, only with the client. Comparison happens
 * WITHIN a table, which is why the rows are dense and the tables are not.
 *
 * Below 768px -- where the page is one column and the rail sits on top of the
 * editor rather than beside it -- the strip becomes a list of four and the
 * table opens over the page instead of under it. A tab strip promises that what
 * is under it is the page; stacked, the rail, the draft controls and the
 * caveats were above it, so "under it" was most of a scroll away and the table
 * arrived without the width it was designed for. A dialog is the honest version
 * of the same move: one table, the viewport it needs, and a way back that is
 * not a scroll.
 */

/** The rules the scorer implements. A closed list because they are code: a
 * trait naming something else pays nothing, and a trait naming nothing pays
 * ALWAYS -- the quiet way for every score on the public page to go up. */
const CONDITION_RULES = [
  { value: "always", label: "Always" },
  { value: "neighboursOnly", label: "Neighbours only" },
  { value: "allQualitiesDiffer", label: "All qualities differ" },
  { value: "countAtLeast3", label: "3+ of this trait" },
  { value: "onlyOne", label: "Only one" },
  { value: "never", label: "Never" },
] as const

/** A rule key as the strip shows it. Falls back to the key so an
 * unrecognised one is visible rather than blank. */
const ruleLabel = (rule: string | null | undefined) =>
  CONDITION_RULES.find((r) => r.value === rule)?.label ?? rule ?? "None"

const RULE_DETAIL: Record<string, string> = {
  always: "Pays its bonus on every banner.",
  neighboursOnly: "Pays nothing to itself; the adjacent bonus is the whole effect.",
  allQualitiesDiffer: "Only when every tier on the banner differs. Fractal's rule.",
  countAtLeast3: "Only with three or more of this trait. Friendly's rule.",
  onlyOne: "Only with exactly one of this trait. Unique's rule.",
  never: "Never pays its own bonus.",
}

type Patch = NonNullable<ConfigOverlay["scoring"]>

/** A percentage as the client shows it, for the "was" marker. */
const pct = (value: number | undefined) =>
  value === undefined ? undefined : `${Math.round(value * 1000) / 10}%`

/**
 * Drop a key, and the map with it once empty.
 *
 * Dropping rather than writing the published value back. An overlay entry that
 * agrees with the run is not nothing -- it is a standing instruction to hold
 * that value if the run ever changes, which is the silent revert this design
 * exists to prevent. An empty map left behind is the same problem smaller: it
 * still counts as a change and still publishes.
 */
/**
 * The fields an override actually moves, paired with what the run says.
 *
 * Built from the OVERLAY entry rather than by diffing two whole rows: the entry
 * already holds exactly the fields that differ, because `mergeEntry` writes
 * only those. Diffing again here would be a second opinion on the same
 * question, and the two could disagree.
 */
function statChangeRows(
  entry: StatPatch,
  base: Scoring["stats"][string] | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = []
  if (entry.perUnit !== undefined) {
    rows.push({ label: "Points per unit", was: base?.perUnit, now: entry.perUnit })
  }
  if (entry.base !== undefined) {
    rows.push({ label: "Flat base", was: base?.base, now: entry.base })
  }
  if (entry.color !== undefined) {
    rows.push({
      label: "Colour",
      was: base && capitalize(base.color),
      now: capitalize(entry.color),
    })
  }
  return rows
}

function traitChangeRows(
  entry: TraitPatch,
  base: Scoring["traits"][string] | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = []
  if (entry.bonus !== undefined) {
    rows.push({ label: "Own bonus", was: pct(base?.bonus), now: pct(entry.bonus) })
  }
  if (entry.adjacentBonus !== undefined) {
    rows.push({
      label: "To each neighbour",
      was: pct(base?.adjacentBonus),
      now: pct(entry.adjacentBonus),
    })
  }
  if (entry.conditionRule !== undefined) {
    rows.push({
      label: "Rule",
      was: base?.conditionRule ? ruleLabel(base.conditionRule) : undefined,
      now: ruleLabel(entry.conditionRule),
    })
  }
  if (entry.condition !== undefined) {
    rows.push({
      label: "Condition, in words",
      was: base?.condition ?? undefined,
      now: entry.condition || "—",
    })
  }
  return rows
}

/** The rule names, as a type, so a select cannot hand back a string the
 * contract does not admit. */
type TraitRule = NonNullable<TraitPatch["conditionRule"]>

/**
 * Put an entry's changed fields into a patch map, or drop the entry entirely
 * when nothing differs from the published run.
 *
 * An edit dialog hands back a whole row, so the diff happens on save. Writing
 * every field would leave entries that AGREE with the run -- standing
 * instructions to hold a value if it ever changes, which is the silent revert
 * this design exists to avoid. `isKnown` is false for a row the run does not
 * carry, where the entry is kept whole because there is nothing to merge onto.
 */
function mergeEntry<T extends object>(
  map: Record<string, T> | undefined,
  key: string,
  changes: T,
  isKnown: boolean,
): Record<string, T> | undefined {
  if (isKnown && Object.keys(changes).length === 0) return without(map, key)
  return { ...(map ?? {}), [key]: changes }
}

function without<T extends object>(map: T | undefined, key: string): T | undefined {
  if (!map || !(key in map)) return map
  const next = { ...map } as Record<string, unknown>
  delete next[key]
  return (Object.keys(next).length > 0 ? next : undefined) as T | undefined
}

export function ScoringEditor({
  config,
  doc,
  onChange,
  effective,
}: {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** The table as it would be served, from the server's own `applyOverlay`.
   * Undefined while the draft has unsaved edits: guessing it in the browser
   * would be a second implementation of the thing being previewed, and its
   * disagreement with the first would be invisible. */
  effective: Scoring | undefined
}) {
  const published = config.published.scoring
  const scoring = effective ?? published
  const patch = doc.scoring ?? {}
  const setScoring = (next: Patch) => onChange({ ...doc, scoring: next })

  const shared = { scoring, published, patch, setScoring }

  // Which table is open. Local, and deliberately not lifted: it is a view
  // preference with no bearing on the draft, and threading it through the page
  // would put something in the page's state that cannot change an answer.
  const [pane, setPane] = useState<string>(PANES[0].value)

  // Whether the four tables have a page wide enough to sit in. Below this they
  // open in a dialog instead -- see the note above the component.
  //
  // 48rem, the same width at which the page itself stops being one column and
  // puts the rail beside the editor. Two breakpoints would mean a band where
  // the layout says there is room for two columns and this says there is not
  // room for one, which is the state the strip was in at 768px: a rail, an
  // editor column beside it, and four buttons in it leading nowhere on the page.
  const wide = useMediaQuery("(min-width: 48rem)")
  const [open, setOpen] = useState(false)

  const table = (value: string) =>
    value === "stats" ? (
      <StatsCard {...shared} />
    ) : value === "traits" ? (
      <TraitsCard {...shared} />
    ) : value === "quality" ? (
      <QualityCard {...shared} />
    ) : (
      <ColorsCard {...shared} />
    )

  if (!wide) {
    const current = PANES.find((entry) => entry.value === pane) ?? PANES[0]

    return (
      <div className="grid gap-3">
        {/* Buttons, not tabs. A tab strip whose triggers open a dialog claims a
            relationship to a panel below that is not there, and says so to a
            screen reader in the roles it hands out. */}
        <div className="grid gap-2">
          {PANES.map((entry) => (
            <Button
              key={entry.value}
              variant="outline"
              className="justify-between"
              onClick={() => {
                setPane(entry.value)
                setOpen(true)
              }}
            >
              {entry.label}
              <ChevronRight aria-hidden />
            </Button>
          ))}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          {/* The card is the surface here, so the dialog gives up its own: its
              padding, background and ring would be a second frame drawn around
              one that already has a heading, a description and an action. The
              cross goes with them -- it lands on top of the card's own button
              -- and "Done" below the table takes its place, which is also where
              a thumb already is after scrolling one. */}
          {/* Two rows: the table takes what is left and scrolls inside itself,
              and the button is its own row. Scrolling the whole box instead put
              the way out at the bottom of the table's own scroll length, where
              it was reached last and clipped by the box's edge when it was
              reached at all. */}
          <DialogContent
            showCloseButton={false}
            className="grid max-h-[85dvh] max-w-[calc(100%-1rem)] grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden bg-transparent p-0 ring-0 sm:max-w-3xl"
          >
            {/* The card states the same word a line below. Kept for the
                accessible name, which a dialog is required to have. */}
            <DialogTitle className="sr-only">{current.label}</DialogTitle>

            <div className="min-h-0 overflow-y-auto">{table(current.value)}</div>

            <DialogClose render={<Button variant="outline" className="w-full" />}>
              Done
            </DialogClose>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <Tabs value={pane} onValueChange={(next) => setPane(next as string)} className="gap-3">
      {/* The same segmented control the public tool uses for its two
          directions -- default variant, full width, equal shares -- so a tab
          strip means one thing across the whole application. */}
      <TabsList className="w-full">
        {PANES.map((entry) => (
          <TabsTrigger key={entry.value} value={entry.value} className="flex-1">
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {PANES.map((entry) => (
        <TabsContent key={entry.value} value={entry.value}>
          {table(entry.value)}
        </TabsContent>
      ))}
    </Tabs>
  )
}

/**
 * The four tables, in the order they are read: what a stat pays, what a trait
 * does to it, what a tier adds, and which slots can hold the result.
 *
 * One word each. The card below each tab already carries the full heading --
 * "Emblem traits", "Colours and slots" -- and a tab repeating it is the same
 * fact twice on one screen, at the width where four long labels stop fitting.
 */
const PANES = [
  { value: "stats", label: "Stats" },
  { value: "traits", label: "Traits" },
  { value: "quality", label: "Quality" },
  { value: "colours", label: "Colours" },
] as const

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

interface SectionProps {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
}

function StatsCard({ scoring, published, patch, setScoring }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState("")
  const [pending, setPending] = useState<ConfirmRequest | null>(null)
  // Which row's dialog is open, by key rather than by value: the row is
  // read fresh on render, so nothing stale can sit in the box.
  const [editing, setEditing] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const removed = patch.statsRemoved ?? []

  // How many emblems go with a stat. The catalog is the cross product, so
  // this is the other two axes multiplied -- worth stating, because it is
  // the part of the removal nobody expects.
  const perStat = Object.keys(scoring.quality).length * Object.keys(scoring.traits).length

  const colorOptions = useMemo(
    () => scoring.colors.map((c) => ({ value: c, label: capitalize(c) })),
    [scoring.colors],
  )
  const all = Object.keys(scoring.stats).sort()
  const keys = all.filter((key) => key.includes(filter.trim().toLowerCase()))

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
        <p className="text-muted-foreground max-w-prose text-xs">
          What each stat pays, and which emblem colour carries it. A player scores only the
          stats on their banner, so these values are the whole ranking. Which measured
          column feeds a stat is not set here — that is <code>STAT_SOURCE</code> in the
          engine, and it changes when the crawler learns to read a new field. A stat this
          run could not measure is marked, and stays excluded from emblem choice.
        </p>
        <FilterField
          value={filter}
          onChange={setFilter}
          label="Filter stats"
          summary={keys.length === all.length ? `${all.length}` : `${keys.length} of ${all.length}`}
        />
      </CardHeader>

      <CardContent className="grid gap-3 px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Stat</TableHead>
              <TableHead>Per unit</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Colour</TableHead>
              <TableHead className="w-0 pr-6 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <StatRow
                key={key}
                statKey={key}
                spec={scoring.stats[key]!}
                was={published.stats[key]}
                entry={patch.stats?.[key]}
                onEdit={() => setEditing(key)}
                onUndo={() => setUndoing(key)}
                onRemove={() =>
                  setPending({
                    title: `Remove ${statLabel(key)}?`,
                    detail: `${perStat} emblems carry this stat and go from the catalog with it.`,
                    confirmText: statLabel(key),
                    confirmLabel: "Remove stat",
                    reversible: true,
                    onConfirm: () =>
                      setScoring({
                        ...patch,
                        stats: without(patch.stats, key),
                        statsRemoved: [...removed, key],
                      }),
                  })
                }
              />
            ))}

            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No stat matches “{filter}”.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="px-6">
          <RemovedChips
            label="Removed stats"
            hint="Every emblem carrying one of these disappears with it — a stat that pays nothing and an emblem that cannot be built are the same statement."
            entries={removed.map((key) => ({ key, label: statLabel(key) }))}
            onRestore={(key) =>
              setScoring({ ...patch, statsRemoved: removed.filter((k) => k !== key) })
            }
          />
        </div>
      </CardContent>

      <AddDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a stat"
        description="It starts paying nothing, and unmeasured — nothing here can attach a stat to a measured column, so it stays excluded from emblem choice until the engine learns to read one and a new run is published."
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

      {undoing !== null && patch.stats?.[undoing] ? (
        <UndoDialog
          open
          onOpenChange={(open) => !open && setUndoing(null)}
          title={`Changes to ${statLabel(undoing)}`}
          rows={statChangeRows(patch.stats[undoing], published.stats[undoing])}
          onUndo={() => setScoring({ ...patch, stats: without(patch.stats, undoing) })}
        />
      ) : null}

      {editing !== null && scoring.stats[editing] ? (
        <EditDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={`Edit ${statLabel(editing)}`}
          description="What this stat pays, and which emblem colour carries it."
          value={{
            perUnit: scoring.stats[editing].perUnit,
            base: scoring.stats[editing].base,
            color: scoring.stats[editing].color,
          }}
          onSave={(next) => {
            const base = published.stats[editing]
            const changes: StatPatch = {}
            if (!base || next.perUnit !== base.perUnit) changes.perUnit = next.perUnit
            if (!base || next.base !== base.base) changes.base = next.base
            if (!base || next.color !== base.color) changes.color = next.color
            setScoring({
              ...patch,
              stats: mergeEntry(patch.stats, editing, changes, base !== undefined),
            })
          }}
        >
          {(draft, set) => (
            <>
              <EditField
                label="Points per unit"
                was={published.stats[editing]?.perUnit}
                hint="Signed — Deaths pays -195."
              >
                <NumberCell
                  value={draft.perUnit}
                  width="w-full"
                  onCommit={(v) => set("perUnit", v)}
                />
              </EditField>

              <EditField
                label="Flat base"
                was={published.stats[editing]?.base}
                hint="Paid once if the stat is present at all, before the per-unit amount."
              >
                <NumberCell value={draft.base} width="w-full" onCommit={(v) => set("base", v)} />
              </EditField>

              <EditField
                label="Colour"
                was={published.stats[editing] && capitalize(published.stats[editing].color)}
                hint="Decides which banner slots can hold this stat."
              >
                <SelectCell
                  label="Colour"
                  value={draft.color}
                  options={colorOptions}
                  width="w-full"
                  onChange={(v) => set("color", v)}
                />
              </EditField>
            </>
          )}
        </EditDialog>
      ) : null}

      <ConfirmDialog request={pending} onClose={() => setPending(null)} />
    </Card>
  )
}

function StatRow({
  statKey,
  spec,
  was,
  entry,
  onEdit,
  onUndo,
  onRemove,
}: {
  statKey: string
  spec: Scoring["stats"][string]
  was: Scoring["stats"][string] | undefined
  entry: StatPatch | undefined
  onEdit: () => void
  onUndo: () => void
  onRemove: () => void
}) {
  // What this row currently SAYS, which is the draft's value where it has one.
  // `spec` is the effective table, and that falls back to the published run
  // while there are unsaved edits -- so reading it alone showed the published
  // number on a row marked as changed.
  const shown = {
    perUnit: entry?.perUnit ?? spec.perUnit,
    base: entry?.base ?? spec.base,
    color: entry?.color ?? spec.color,
  }

  return (
    <TableRow className={entry ? "bg-primary/5" : undefined}>
      <TableCell className="pl-6">
        <div className="flex items-center gap-1.5">
          {/* The words only. The key is still what an emblem id is built from
              and what the YAML export names, so it is on the title rather than
              gone. */}
          <span className="text-sm font-medium" title={statKey}>
            {statLabel(statKey)}
          </span>
          {!was ? <Badge variant="secondary">new</Badge> : null}
          {!spec.measurable ? (
            <Badge variant="outline" title="Excluded from emblem choice, never scored as zero">
              no data
            </Badge>
          ) : null}
        </div>
      </TableCell>

      <TableCell>
        <ValueCell value={shown.perUnit} changed={entry?.perUnit !== undefined} />
      </TableCell>

      <TableCell>
        <ValueCell value={shown.base} changed={entry?.base !== undefined} />
      </TableCell>

      <TableCell>
        <ValueCell value={capitalize(shown.color)} changed={entry?.color !== undefined} />
      </TableCell>

      <TableCell className="pr-6">
        <RowActions
          what={statLabel(statKey)}
          changed={Boolean(entry)}
          onEdit={onEdit}
          onUndo={onUndo}
          onRemove={onRemove}
        />
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// traits
// ---------------------------------------------------------------------------

function TraitsCard({ scoring, published, patch, setScoring }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<ConfirmRequest | null>(null)
  // Which row's dialog is open, by key rather than by value: the row is
  // read fresh on render, so nothing stale can sit in the box.
  const [editing, setEditing] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const removed = patch.traitsRemoved ?? []
  const perTrait = Object.keys(scoring.stats).length * Object.keys(scoring.quality).length

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
        <p className="text-muted-foreground max-w-prose text-xs">
          What a trait pays itself, and what it does to the emblem on either side. The
          adjacent bonus is why a banner’s value depends on the ORDER of its emblems. The
          rule is code, not prose — a trait without one pays on every banner.
        </p>
      </CardHeader>

      <CardContent className="grid gap-3 px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Trait</TableHead>
              <TableHead>Own bonus</TableHead>
              <TableHead>Each neighbour</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>What that means</TableHead>
              <TableHead>Condition, in words</TableHead>
              <TableHead className="w-0 pr-6 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(scoring.traits).map(([name, spec]) => (
              <TraitRow
                key={name}
                name={name}
                spec={spec}
                was={published.traits[name]}
                entry={patch.traits?.[name]}
                onEdit={() => setEditing(name)}
                onUndo={() => setUndoing(name)}
                onRemove={() =>
                  setPending({
                    title: `Remove ${traitLabel(name)}?`,
                    detail: `${perTrait} emblems carry this trait and go from the catalog with it.`,
                    confirmText: traitLabel(name),
                    confirmLabel: "Remove trait",
                    reversible: true,
                    onConfirm: () =>
                      setScoring({
                        ...patch,
                        traits: without(patch.traits, name),
                        traitsRemoved: [...removed, name],
                      }),
                  })
                }
              />
            ))}
          </TableBody>
        </Table>

        <div className="px-6">
          <RemovedChips
            label="Removed traits"
            entries={removed.map((key) => ({ key, label: traitLabel(key) }))}
            onRestore={(key) =>
              setScoring({ ...patch, traitsRemoved: removed.filter((k) => k !== key) })
            }
          />
        </div>
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
              // every banner, which is how every score goes up with nothing
              // looking broken.
              [key]: { bonus: 0, adjacentBonus: 0, conditionRule: "always", condition: null },
            },
          })
        }
      />

      {undoing !== null && patch.traits?.[undoing] ? (
        <UndoDialog
          open
          onOpenChange={(open) => !open && setUndoing(null)}
          title={`Changes to ${traitLabel(undoing)}`}
          rows={traitChangeRows(patch.traits[undoing], published.traits[undoing])}
          onUndo={() => setScoring({ ...patch, traits: without(patch.traits, undoing) })}
        />
      ) : null}

      {editing !== null && scoring.traits[editing] ? (
        <EditDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={`Edit ${traitLabel(editing)}`}
          description="What it pays itself, and what it does to the emblem on either side."
          value={{
            bonus: scoring.traits[editing].bonus,
            adjacentBonus: scoring.traits[editing].adjacentBonus,
            conditionRule: scoring.traits[editing].conditionRule ?? "always",
            condition: scoring.traits[editing].condition ?? "",
          }}
          onSave={(next) => {
            const base = published.traits[editing]
            const changes: TraitPatch = {}
            if (!base || next.bonus !== base.bonus) changes.bonus = next.bonus
            if (!base || next.adjacentBonus !== base.adjacentBonus) {
              changes.adjacentBonus = next.adjacentBonus
            }
            if (!base || next.conditionRule !== base.conditionRule) {
              changes.conditionRule = next.conditionRule
            }
            if (!base || next.condition !== (base.condition ?? "")) {
              changes.condition = next.condition || null
            }
            setScoring({
              ...patch,
              traits: mergeEntry(patch.traits, editing, changes, base !== undefined),
            })
          }}
        >
          {(draft, set) => (
            <>
              <EditField label="Own bonus" was={pct(published.traits[editing]?.bonus)}>
                <PercentCell value={draft.bonus} onCommit={(v) => set("bonus", v)} />
              </EditField>

              <EditField
                label="To each neighbour"
                was={pct(published.traits[editing]?.adjacentBonus)}
                hint="Applied to the emblem above and below. Negative charges them."
              >
                <PercentCell
                  value={draft.adjacentBonus}
                  onCommit={(v) => set("adjacentBonus", v)}
                />
              </EditField>

              <EditField
                label="Rule"
                was={
                  published.traits[editing]?.conditionRule
                    ? ruleLabel(published.traits[editing].conditionRule)
                    : undefined
                }
                hint={RULE_DETAIL[draft.conditionRule] ?? "No rule named — pays nothing."}
              >
                <SelectCell
                  label="Rule"
                  value={draft.conditionRule}
                  options={CONDITION_RULES}
                  width="w-full"
                  onChange={(v) => set("conditionRule", v as TraitRule)}
                />
              </EditField>

              <EditField
                label="Condition, in words"
                hint="Shown to readers. Never evaluated — the rule above is what fires."
              >
                <TextCell
                  value={draft.condition}
                  placeholder="All emblem qualities differ"
                  onCommit={(v) => set("condition", v)}
                />
              </EditField>
            </>
          )}
        </EditDialog>
      ) : null}

      <ConfirmDialog request={pending} onClose={() => setPending(null)} />
    </Card>
  )
}

function TraitRow({
  name,
  spec,
  was,
  entry,
  onEdit,
  onUndo,
  onRemove,
}: {
  name: string
  spec: Scoring["traits"][string]
  was: Scoring["traits"][string] | undefined
  entry: TraitPatch | undefined
  onEdit: () => void
  onUndo: () => void
  onRemove: () => void
}) {
  // See `StatRow`: the effective table falls back to the published run while
  // there are unsaved edits, so the draft's own value has to win here.
  const shown = {
    bonus: entry?.bonus ?? spec.bonus,
    adjacentBonus: entry?.adjacentBonus ?? spec.adjacentBonus,
    conditionRule: entry?.conditionRule ?? spec.conditionRule,
    condition: entry?.condition !== undefined ? entry.condition : spec.condition,
  }

  return (
    <TableRow className={entry ? "bg-primary/5" : undefined}>
      <TableCell className="pl-6">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{traitLabel(name)}</span>
          {!was ? <Badge variant="secondary">new</Badge> : null}
        </div>
      </TableCell>

      <TableCell>
        <ValueCell value={pct(shown.bonus)} changed={entry?.bonus !== undefined} />
      </TableCell>

      <TableCell>
        <ValueCell
          value={pct(shown.adjacentBonus)}
          changed={entry?.adjacentBonus !== undefined}
        />
      </TableCell>

      <TableCell>
        <ValueCell
          value={ruleLabel(shown.conditionRule)}
          changed={entry?.conditionRule !== undefined}
        />
      </TableCell>

      <TableCell className="text-muted-foreground max-w-56 text-2xs whitespace-normal">
        {RULE_DETAIL[shown.conditionRule ?? ""] ?? "No rule named — scored as paying nothing."}
      </TableCell>

      <TableCell className="text-muted-foreground max-w-64 text-xs whitespace-normal">
        {shown.condition || "—"}
      </TableCell>

      <TableCell className="pr-6">
        <RowActions
          what={traitLabel(name)}
          changed={Boolean(entry)}
          onEdit={onEdit}
          onUndo={onUndo}
          onRemove={onRemove}
        />
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// quality and colours
// ---------------------------------------------------------------------------

function QualityCard({ scoring, published, patch, setScoring }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<ConfirmRequest | null>(null)
  // Which row's dialog is open, by key rather than by value: the row is
  // read fresh on render, so nothing stale can sit in the box.
  const [editing, setEditing] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const removed = patch.qualityRemoved ?? []
  const perTier = Object.keys(scoring.stats).length * Object.keys(scoring.traits).length

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
        <p className="text-muted-foreground max-w-prose text-xs">
          What each tier adds to an emblem’s multiplier. Quality is not rerollable in the
          client, so these are the fixed rungs a banner is built from. A new tier adds a
          catalog row for every stat and every trait.
        </p>
      </CardHeader>

      <CardContent className="grid gap-3">
        {/* A row of tiles across the card: five short numeric values, where a
            five-row table would be mostly chrome. */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(scoring.quality).map(([tier, bonus]) => {
            const changed = patch.quality?.[tier] !== undefined
            return (
              <div
                key={tier}
                className={`grid w-32 gap-1 rounded-lg border p-2 ${changed ? "border-primary/40 bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium">{tierLabel(tier)}</span>
                  <RowActions
                    what={tierLabel(tier)}
                    changed={changed}
                    onEdit={() => setEditing(tier)}
                    onUndo={() => setUndoing(tier)}
                    onRemove={() =>
                      setPending({
                        title: `Remove ${tierLabel(tier)}?`,
                        detail: `${perTier} emblems are at this tier and go from the catalog with it.`,
                        confirmText: tierLabel(tier),
                        confirmLabel: "Remove tier",
                        reversible: true,
                        onConfirm: () =>
                          setScoring({
                            ...patch,
                            quality: without(patch.quality, tier),
                            qualityRemoved: [...removed, tier],
                          }),
                      })
                    }
                  />
                </div>
                <p className={changed ? "text-sm font-medium" : "text-sm"}>{pct(bonus)}</p>
                <p className="text-muted-foreground min-h-4 text-2xs">
                  {changed ? `was ${pct(published.quality[tier]) ?? "absent"}` : null}
                </p>
              </div>
            )
          })}
        </div>

        <RemovedChips
          label="Removed tiers"
          entries={removed.map((key) => ({ key, label: tierLabel(key) }))}
          onRestore={(key) =>
            setScoring({ ...patch, qualityRemoved: removed.filter((k) => k !== key) })
          }
        />
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

      {undoing !== null && patch.quality?.[undoing] !== undefined ? (
        <UndoDialog
          open
          onOpenChange={(open) => !open && setUndoing(null)}
          title={`Changes to ${tierLabel(undoing)}`}
          rows={[
            {
              label: "Quality bonus",
              was: pct(published.quality[undoing]),
              now: pct(patch.quality[undoing]),
            },
          ]}
          onUndo={() => setScoring({ ...patch, quality: without(patch.quality, undoing) })}
        />
      ) : null}

      {editing !== null && scoring.quality[editing] !== undefined ? (
        <EditDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={`Edit ${tierLabel(editing)}`}
          value={{ bonus: scoring.quality[editing] }}
          onSave={(next) => {
            setScoring({
              ...patch,
              quality:
                next.bonus === published.quality[editing]
                  ? without(patch.quality, editing)
                  : { ...(patch.quality ?? {}), [editing]: next.bonus },
            })
          }}
        >
          {(draft, set) => (
            // One field, so what the number MEANS goes on the field's own line
            // beside what the published run says, rather than in a dialog
            // description above a label that names the same number again. Three
            // headings over one input is what made this box feel full.
            <EditField
              label="Quality bonus"
              was={pct(published.quality[editing])}
              hint="Added to an emblem's multiplier."
            >
              <PercentCell value={draft.bonus} onCommit={(v) => set("bonus", v)} />
            </EditField>
          )}
        </EditDialog>
      ) : null}

      <ConfirmDialog request={pending} onClose={() => setPending(null)} />
    </Card>
  )
}

function ColorsCard({ scoring, published, patch, setScoring }: SectionProps) {
  const rows = scoring.bannerColors ?? {}

  const setRow = (role: string, parsed: [string, ...string[]] | undefined) => {
    const next = { ...(patch.bannerColors ?? {}) }
    // An emptied row means "leave the published one alone" rather than "this
    // role has no slots". A banner with no slots is not a shape, and refusing a
    // half-typed field is not the moment to say so.
    if (parsed) next[role] = parsed
    else delete next[role]
    setScoring({ ...patch, bannerColors: Object.keys(next).length > 0 ? next : undefined })
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Colours and slots</CardTitle>
        <p className="text-muted-foreground max-w-prose text-xs">
          The palette, and the colour of each banner slot by role. Not a preference and not
          one-of-each: a Core banner is three reds and two greens, and Support has no red
          slot at all. A row naming a colour no stat carries makes that slot unfillable.
        </p>
      </CardHeader>

      <CardContent className="grid gap-2">
        <LabelledField
          label="Palette"
          changed={patch.colors !== undefined}
          was={words(published.colors)}
          onUndo={() => setScoring({ ...patch, colors: undefined })}
        >
          <TextCell
            value={words(scoring.colors)}
            changed={patch.colors !== undefined}
            onCommit={(v) => setScoring({ ...patch, colors: commaList(v) })}
          />
        </LabelledField>

        {Object.entries(rows).map(([role, row]) => (
          <LabelledField
            key={role}
            label={`${roleLabel(role)} slots`}
            changed={patch.bannerColors?.[role] !== undefined}
            was={words(published.bannerColors?.[role])}
            onUndo={() => setRow(role, undefined)}
          >
            <TextCell
              value={words(row)}
              changed={patch.bannerColors?.[role] !== undefined}
              onCommit={(v) => setRow(role, commaList(v))}
            />
          </LabelledField>
        ))}

        {Object.keys(rows).length === 0 ? (
          <p className="text-muted-foreground max-w-prose text-xs">
            This run carries no slot-colour rule. Adding one here would be introducing the
            rule rather than correcting it — check every row against the client first.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}


/**
 * A colour list as words: `["red","blue"]` -> `"Red, Blue"`.
 *
 * Read with `commaList`, which lowercases on the way back. The pair is written
 * together because the round trip is the whole point: a colour key is lowercase
 * by contract -- the overlay schema's `Key` pattern admits nothing else -- and a
 * capitalised one saved as-is would name a colour no stat carries, emptying a
 * banner slot. So the capitals exist only between these two functions.
 */
const words = (list: readonly string[] | undefined) =>
  (list ?? []).map(capitalize).join(", ")

/**
 * A comma-separated list, lowercased, or undefined when empty.
 *
 * The contract types these as non-empty -- a palette with no colours and a
 * banner row with no slots are both meaningless -- so an emptied field drops the
 * override rather than publishing a list of nothing.
 */
function commaList(value: string): [string, ...string[]] | undefined {
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  return parts.length > 0 ? (parts as [string, ...string[]]) : undefined
}

/** A banner-colour row's role as a reader knows it. `bannerColors` is keyed by
 * plain string in the contract, so an unrecognised role still gets capitals
 * rather than falling through as typed. */
const roleLabel = (role: string) =>
  ROLE_LABEL[role as FantasyRole] ?? capitalize(role)
