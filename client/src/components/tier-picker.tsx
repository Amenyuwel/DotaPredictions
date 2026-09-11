import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TIER_CHIP, tierLabel, tierNumeral } from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"

/**
 * The tier stamp, as a control.
 *
 * Quality is the one part of a banner no reroll can change, so on every other
 * screen it is a fact being reported. Here it is the input: a reader saying
 * which emblems they actually have, so the answer is about their hand rather
 * than about a rung somebody else named.
 *
 * Deliberately the same square, in the same place, at the same size as the
 * stamp on a result row -- the thing you click is the thing you have been
 * reading. What marks it as a control is the focus ring and the hover, not a
 * different shape, so nothing moves when it is pressed.
 */
export function TierPicker({
  value,
  tiers,
  onChange,
  label,
}: {
  value: string
  /** The run's own qualities, worst first. Read off the scoring table rather
   * than named here: a period with six of them must offer six. */
  tiers: string[]
  onChange: (tier: string) => void
  /** Which emblem this is, for anyone who cannot see the row it sits in. */
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          TIER_CHIP,
          "focus-visible:ring-ring hover:bg-muted hover:text-foreground cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none",
        )}
        aria-label={`${label}: ${tierLabel(value)}, change`}
      >
        {tierNumeral(value)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {tiers.map((tier) => (
          <DropdownMenuItem key={tier} onClick={() => onChange(tier)}>
            {tierLabel(tier)}
            {tier === value && <span className="text-muted-foreground ml-auto">current</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
