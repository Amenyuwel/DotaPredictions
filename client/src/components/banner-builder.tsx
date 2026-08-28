import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Emblem } from "@/types/run"

/**
 * Build a banner, emblem by emblem.
 *
 * Two client rules come straight from the scoring model:
 *
 *  - A banner may repeat a colour but never a stat, so a stat already placed is
 *    unselectable rather than merely discouraged.
 *  - Order is meaningful. Vampiric charges each neighbour -10% and Benevolent
 *    pays each +20%, so position is an input, not a presentation choice.
 */
export function BannerBuilder({
  emblems,
  slots,
  value,
  onChange,
}: {
  emblems: Emblem[]
  slots: number
  value: (Emblem | null)[]
  onChange: (next: (Emblem | null)[]) => void
}) {
  const usedStats = new Set(value.filter(Boolean).map((e) => e!.stat))

  const setSlot = (index: number, emblem: Emblem | null) => {
    const next = [...value]
    next[index] = emblem
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: slots }, (_, i) => {
        const current = value[i] ?? null
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-muted-foreground w-6 text-center text-xs tabular-nums">
              {i + 1}
            </span>
            <Select
              value={current?.emblemId ?? ""}
              onValueChange={(id) =>
                setSlot(i, emblems.find((e) => e.emblemId === id) ?? null)
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={`Emblem ${i + 1}`} />
              </SelectTrigger>
              <SelectContent>
                {emblems.map((e) => (
                  <SelectItem
                    key={e.emblemId}
                    value={e.emblemId}
                    disabled={usedStats.has(e.stat) && e.emblemId !== current?.emblemId}
                  >
                    {e.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current && !current.measurable && (
              <Tooltip>
                {/* Base UI composes through `render`, not `asChild`. */}
                <TooltipTrigger render={<Badge variant="outline">no data</Badge>} />
                <TooltipContent>
                  This stat has no field in the match data at any depth, so it scores 0 for
                  every player here. It is worth real points in the client — the model
                  simply cannot see them.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )
      })}

      {value.some(Boolean) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(Array(slots).fill(null))}>
          Clear
        </Button>
      )}
    </div>
  )
}
