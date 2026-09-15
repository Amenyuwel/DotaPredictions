import { useState } from "react"
import { Plus, Trash2, Undo2 } from "lucide-react"

import { AddDialog } from "@/components/admin/add-dialog"
import { validateKey } from "@/lib/admin-ui"
import { FieldRow, NumberField, PercentField, TextField } from "@/components/admin/field"
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
import { Separator } from "@/components/ui/separator"
import { tierLabel, traitLabel } from "@/lib/emblem-catalog"
import type { AdminConfig, ConfigOverlay } from "@/types/admin"
import type { Scoring } from "@/types/run"

/**
 * The scoring table: stats, emblem tiers, traits, and the colour rules.
 *
 * This is the half of a run that is recomputed on every request, which is what
 * makes editing it possible at all without a re-crawl -- and what makes it the
 * most dangerous form in the application. A per-unit value here multiplies
 * every projection on the public page, and there is no arithmetic anywhere that
 * would notice a decimal point in the wrong place.
 *
 * Every control below is therefore built around one idea: the reader can always
 * see what the engine published, beside what they have changed it to.
 */

/** The rules the scorer actually implements. Offered as a closed list because
 * they are code: a trait naming something else pays nothing, and a trait naming
 * nothing pays ALWAYS -- which is the quiet way for every score to go up. */
const CONDITION_RULES: { value: string; label: string; detail: string }[] = [
  { value: "always", label: "Always", detail: "No condition. Pays its bonus on every banner." },
  {
    value: "neighboursOnly",
    label: "Neighbours only",
    detail: "Pays nothing to itself; the adjacent bonus is the whole effect.",
  },
  {
    value: "allQualitiesDiffer",
    label: "All qualities differ",
    detail: "Fires only when every tier on the banner is distinct. Fractal's rule.",
  },
  {
    value: "countAtLeast3",
    label: "At least 3 of this trait",
    detail: "Fires when three or more emblems on the banner carry it. Friendly's rule.",
  },
  {
    value: "onlyOne",
    label: "Only one of this trait",
    detail: "Fires when exactly one emblem on the banner carries it. Unique's rule.",
  },
  { value: "never", label: "Never", detail: "Never pays its own bonus." },
]

interface Props {
  config: AdminConfig
  doc: ConfigOverlay
  onChange: (next: ConfigOverlay) => void
  /** The scoring table as it would be served with this overlay on it, straight
   * from the server's own `applyOverlay`. Undefined while the draft has unsaved
   * edits: the effective table is not knowable here, and guessing it in the
   * browser would be a second implementation of the thing being previewed. */
  effective: Scoring | undefined
}

export function ScoringEditor({ config, doc, onChange, effective }: Props) {
  const published = config.published.scoring
  const scoring = effective ?? published
  const patch = doc.scoring ?? {}

  const setScoring = (next: NonNullable<ConfigOverlay["scoring"]>) =>
    onChange({ ...doc, scoring: next })

  // Dropping a key rather than writing the published value back. An overlay
  // entry that agrees with the run is not nothing: it is a standing instruction
  // to hold that value if the run ever changes, which is the silent revert this
  // whole design exists to prevent.
  const dropFrom = <T extends object>(map: T | undefined, key: string): T | undefined => {
    if (!map || !(key in map)) return map
    const next = { ...map } as Record<string, unknown>
    delete next[key]
    return (Object.keys(next).length > 0 ? next : undefined) as T | undefined
  }

  return (
    <div className="grid gap-4">
      <StatsSection
        config={config}
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
        dropFrom={dropFrom}
      />
      <QualitySection
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
        dropFrom={dropFrom}
      />
      <TraitsSection
        scoring={scoring}
        published={published}
        patch={patch}
        setScoring={setScoring}
        dropFrom={dropFrom}
      />
      <ColorsSection scoring={scoring} published={published} patch={patch} setScoring={setScoring} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

type Patch = NonNullable<ConfigOverlay["scoring"]>
type Drop = <T extends object>(map: T | undefined, key: string) => T | undefined

function StatsSection({
  config,
  scoring,
  published,
  patch,
  setScoring,
  dropFrom,
}: {
  config: AdminConfig
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
  dropFrom: Drop
}) {
  const [adding, setAdding] = useState(false)
  const removed = new Set(patch.statsRemoved ?? [])

  const editStat = (key: string, field: string, value: unknown) =>
    setScoring({
      ...patch,
      stats: { ...(patch.stats ?? {}), [key]: { ...(patch.stats?.[key] ?? {}), [field]: value } },
    })

  const addStat = (key: string) => {
    setScoring({
      ...patch,
      stats: {
        ...(patch.stats ?? {}),
        // Every field named, because a new stat has nothing to merge onto. The
        // server refuses a partial one rather than filling in zeros that would
        // look chosen. `measurable` starts false and `source` null: a stat is
        // unmeasured until somebody points it at a column that exists.
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

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Stats</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            What each stat pays, and which emblem colour carries it. A player scores only
            the stats on their banner, so these values are the whole ranking.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add stat
        </Button>
      </CardHeader>

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
        onSubmit={({ key }) => addStat(key)}
      />
      <CardContent className="grid gap-3">
        {Object.keys(scoring.stats)
          .sort()
          .map((key) => {
            const spec = scoring.stats[key]!
            const was = published.stats[key]
            const entry = patch.stats?.[key]
            const isNew = !was

            return (
              <div key={key} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-medium">{key}</code>
                  {isNew ? <Badge variant="secondary">added</Badge> : null}
                  {!spec.measurable ? (
                    <Badge variant="outline" title="Excluded from emblem choice, never scored as zero">
                      unmeasurable
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    {entry ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-xs"
                        onClick={() => setScoring({ ...patch, stats: dropFrom(patch.stats, key) })}
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
                        setScoring({
                          ...patch,
                          stats: dropFrom(patch.stats, key),
                          statsRemoved: [...removed, key],
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <FieldRow
                    label="Points per unit"
                    changed={entry?.perUnit !== undefined}
                    wasLabel={was ? String(was.perUnit) : undefined}
                    onRevert={() =>
                      setScoring({ ...patch, stats: dropField(patch.stats, key, "perUnit") })
                    }
                  >
                    <NumberField value={spec.perUnit} onCommit={(v) => editStat(key, "perUnit", v)} />
                  </FieldRow>

                  <FieldRow
                    label="Flat base"
                    hint="Paid once when the stat is present at all, before the per-unit amount."
                    changed={entry?.base !== undefined}
                    wasLabel={was ? String(was.base) : undefined}
                    onRevert={() =>
                      setScoring({ ...patch, stats: dropField(patch.stats, key, "base") })
                    }
                  >
                    <NumberField value={spec.base} onCommit={(v) => editStat(key, "base", v)} />
                  </FieldRow>

                  <FieldRow
                    label="Colour"
                    hint="Decides which banner slots can hold this stat."
                    changed={entry?.color !== undefined}
                    wasLabel={was?.color}
                    onRevert={() =>
                      setScoring({ ...patch, stats: dropField(patch.stats, key, "color") })
                    }
                  >
                    <Select
                      value={spec.color}
                      onValueChange={(v) => editStat(key, "color", v as string)}
                    >
                      <SelectTrigger size="sm" className="max-w-40" aria-label={`${key} colour`}>
                        <SelectValue>{(v: string) => v}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {scoring.colors.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>

                  <FieldRow
                    label="Source column"
                    hint={
                      <>
                        The column in this run's sample matrices that carries the per-game
                        values. It cannot be invented: a source that does not exist does not
                        error, the stat just pays its flat base on every game.
                      </>
                    }
                    changed={entry?.source !== undefined}
                    wasLabel={was ? (was.source ?? "none") : undefined}
                    onRevert={() =>
                      setScoring({ ...patch, stats: dropField(patch.stats, key, "source") })
                    }
                  >
                    <Select
                      value={spec.source ?? "__none__"}
                      onValueChange={(v) => {
                        const source = v === "__none__" ? null : (v as string)
                        setScoring({
                          ...patch,
                          stats: {
                            ...(patch.stats ?? {}),
                            [key]: {
                              ...(patch.stats?.[key] ?? {}),
                              source,
                              // Measurability follows the source rather than being a
                              // second switch that can disagree with it. Marking a stat
                              // measurable with nothing behind it is a measurement claim
                              // nobody can support, and the server refuses it -- so the
                              // form does not offer the combination at all.
                              measurable: source !== null,
                            },
                          },
                        })
                      }}
                    >
                      <SelectTrigger size="sm" className="max-w-56" aria-label={`${key} source column`}>
                        <SelectValue>
                          {(v: string) => (v === "__none__" ? "none - unmeasurable" : v)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">none - unmeasurable</SelectItem>
                        {config.sourceColumns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                </div>
              </div>
            )
          })}

        {removed.size > 0 ? (
          <>
            <Separator />
            <div className="grid gap-2">
              <p className="text-sm font-medium">Removed</p>
              <p className="text-muted-foreground text-xs">
                Every emblem carrying one of these disappears with it. That is the intent: a
                stat that pays nothing and an emblem that cannot be built are the same
                statement.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...removed].map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setScoring({
                        ...patch,
                        statsRemoved: [...removed].filter((k) => k !== key),
                      })
                    }
                  >
                    <Undo2 aria-hidden />
                    {key}
                  </Button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------

function QualitySection({
  scoring,
  published,
  patch,
  setScoring,
  dropFrom,
}: {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
  dropFrom: Drop
}) {
  const [adding, setAdding] = useState(false)
  const removed = new Set(patch.qualityRemoved ?? [])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Emblem quality</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            What each tier adds to an emblem's multiplier. Quality is not rerollable in the
            client, so these are the fixed rungs a banner is built from. Adding a tier adds a
            row to the catalog for every stat and every trait.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add tier
        </Button>
      </CardHeader>

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
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {Object.entries(scoring.quality).map(([tier, bonus]) => (
          <FieldRow
            key={tier}
            label={tierLabel(tier)}
            changed={patch.quality?.[tier] !== undefined}
            wasLabel={
              published.quality[tier] !== undefined
                ? `+${Math.round(published.quality[tier]! * 1000) / 10}%`
                : undefined
            }
            onRevert={() => setScoring({ ...patch, quality: dropFrom(patch.quality, tier) })}
          >
            <div className="flex items-center gap-2">
              <PercentField
                value={bonus}
                onCommit={(v) => setScoring({ ...patch, quality: { ...(patch.quality ?? {}), [tier]: v } })}
              />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive h-7 px-1.5 text-xs"
                onClick={() =>
                  setScoring({
                    ...patch,
                    quality: dropFrom(patch.quality, tier),
                    qualityRemoved: [...removed, tier],
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </FieldRow>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// traits
// ---------------------------------------------------------------------------

function TraitsSection({
  scoring,
  published,
  patch,
  setScoring,
  dropFrom,
}: {
  scoring: Scoring
  published: Scoring
  patch: Patch
  setScoring: (next: Patch) => void
  dropFrom: Drop
}) {
  const [adding, setAdding] = useState(false)
  const editTrait = (key: string, field: string, value: unknown) =>
    setScoring({
      ...patch,
      traits: { ...(patch.traits ?? {}), [key]: { ...(patch.traits?.[key] ?? {}), [field]: value } },
    })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Emblem traits</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            What a trait pays itself, and what it does to the emblem on either side. The
            adjacent bonus is why a banner's value depends on the ORDER of its emblems and
            not only on which ones they are.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add trait
        </Button>
      </CardHeader>

      <AddDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an emblem trait"
        description="It starts unconditional and paying nothing. Set its bonus and its rule once it exists."
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
              // `conditionRule` is set, not left blank. A trait with no rule
              // pays on every banner, which is how every score on the public
              // page goes up with nothing looking broken.
              [key]: { bonus: 0, adjacentBonus: 0, conditionRule: "always", condition: null },
            },
          })
        }
      />
      <CardContent className="grid gap-3">
        {Object.entries(scoring.traits).map(([name, spec]) => {
          const was = published.traits[name]
          const entry = patch.traits?.[name]
          return (
            <div key={name} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{traitLabel(name)}</span>
                {!was ? <Badge variant="secondary">added</Badge> : null}
                <div className="ml-auto flex items-center gap-1">
                  {entry ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-1.5 text-xs"
                      onClick={() => setScoring({ ...patch, traits: dropFrom(patch.traits, name) })}
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
                      setScoring({
                        ...patch,
                        traits: dropFrom(patch.traits, name),
                        traitsRemoved: [...(patch.traitsRemoved ?? []), name],
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <FieldRow
                  label="Own bonus"
                  changed={entry?.bonus !== undefined}
                  wasLabel={was ? `+${Math.round(was.bonus * 1000) / 10}%` : undefined}
                  onRevert={() =>
                    setScoring({ ...patch, traits: dropField(patch.traits, name, "bonus") })
                  }
                >
                  <PercentField value={spec.bonus} onCommit={(v) => editTrait(name, "bonus", v)} />
                </FieldRow>

                <FieldRow
                  label="To each neighbour"
                  hint="Applied to the emblem above and below. Negative charges them."
                  changed={entry?.adjacentBonus !== undefined}
                  wasLabel={was ? `${Math.round(was.adjacentBonus * 1000) / 10}%` : undefined}
                  onRevert={() =>
                    setScoring({ ...patch, traits: dropField(patch.traits, name, "adjacentBonus") })
                  }
                >
                  <PercentField
                    value={spec.adjacentBonus}
                    onCommit={(v) => editTrait(name, "adjacentBonus", v)}
                  />
                </FieldRow>

                <FieldRow
                  label="Condition"
                  hint={
                    CONDITION_RULES.find((r) => r.value === (spec.conditionRule ?? ""))?.detail ??
                    "No rule named. The scorer pays nothing for this trait's own bonus until one is."
                  }
                  changed={entry?.conditionRule !== undefined}
                  wasLabel={was?.conditionRule ?? undefined}
                  onRevert={() =>
                    setScoring({ ...patch, traits: dropField(patch.traits, name, "conditionRule") })
                  }
                >
                  <Select
                    value={spec.conditionRule ?? ""}
                    onValueChange={(v) => editTrait(name, "conditionRule", v as string)}
                  >
                    <SelectTrigger size="sm" className="max-w-56" aria-label={`${name} condition rule`}>
                      <SelectValue>
                        {(v: string) =>
                          CONDITION_RULES.find((r) => r.value === v)?.label ?? "Name the rule"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_RULES.map((rule) => (
                        <SelectItem key={rule.value} value={rule.value}>
                          {rule.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>

                <FieldRow
                  label="Condition, in words"
                  hint="Shown to readers. Never evaluated - the rule above is what fires."
                  changed={entry?.condition !== undefined}
                  wasLabel={was?.condition ?? undefined}
                  onRevert={() =>
                    setScoring({ ...patch, traits: dropField(patch.traits, name, "condition") })
                  }
                >
                  <TextField
                    value={spec.condition ?? ""}
                    onCommit={(v) => editTrait(name, "condition", v || null)}
                    placeholder="all emblem qualities on the banner differ"
                  />
                </FieldRow>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------

function ColorsSection({
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
      <CardHeader>
        <CardTitle>Colours and slots</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          The palette, and the colour of each banner slot by role. This is not a preference
          and not one-of-each: a Core banner is three reds and two greens, and a Support
          banner has no red slot at all. It decides which stats a slot can hold, so a row
          naming a colour no stat carries makes that slot unfillable - and the server refuses
          it rather than letting a picker silently come up empty.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <FieldRow
          label="Palette"
          hint="Comma separated. Replaced whole rather than patched."
          changed={patch.colors !== undefined}
          wasLabel={published.colors.join(", ")}
          onRevert={() => setScoring({ ...patch, colors: undefined })}
        >
          <TextField
            value={scoring.colors.join(", ")}
            onCommit={(v) => setScoring({ ...patch, colors: commaList(v) })}
          />
        </FieldRow>

        {Object.keys(rows).length === 0 ? (
          <p className="text-muted-foreground text-xs">
            This run carries no slot-colour rule. Adding one here would be introducing the
            rule rather than correcting it - check every row against the client first.
          </p>
        ) : null}

        {Object.entries(rows).map(([role, row]) => (
          <FieldRow
            key={role}
            label={`${role} slots`}
            hint="Top to bottom, at Main Event length. A shorter period takes the first few."
            changed={patch.bannerColors?.[role] !== undefined}
            wasLabel={published.bannerColors?.[role]?.join(", ")}
            onRevert={() => {
              const next = { ...(patch.bannerColors ?? {}) }
              delete next[role]
              setScoring({
                ...patch,
                bannerColors: Object.keys(next).length > 0 ? next : undefined,
              })
            }}
          >
            <TextField
              value={row.join(", ")}
              onCommit={(v) => {
                const row = commaList(v)
                const next = { ...(patch.bannerColors ?? {}) }
                // An emptied row means "leave the published one alone" rather
                // than "this role has no slots". A banner with no slots is not
                // a shape, and the server would refuse it -- but refusing a
                // half-typed field is not the moment to say so.
                if (row) next[role] = row
                else delete next[role]
                setScoring({
                  ...patch,
                  bannerColors: Object.keys(next).length > 0 ? next : undefined,
                })
              }}
            />
          </FieldRow>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * A comma-separated list, or undefined when it is empty.
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

/** Drop one field from one entry, and the entry itself once it is empty.
 * An empty patch object would still count as a change and still be published,
 * which is a difference nobody can see and everybody has to reason about. */
function dropField<T extends object>(map: T | undefined, key: string, field: string): T | undefined {
  const bag = map as Record<string, Record<string, unknown>> | undefined
  if (!bag?.[key]) return map
  const entry = { ...bag[key] }
  delete entry[field]
  const next: Record<string, unknown> = { ...bag }
  if (Object.keys(entry).length === 0) delete next[key]
  else next[key] = entry
  return (Object.keys(next).length > 0 ? next : undefined) as T | undefined
}
