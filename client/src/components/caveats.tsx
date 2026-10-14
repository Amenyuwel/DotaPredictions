import { useId } from "react"
import { Info } from "lucide-react"

/**
 * The model's own limits, next to the number they qualify.
 *
 * Required output, not decoration. Users cannot audit the engine, so anything
 * it knows it cannot see -- an emblem carrying a stat with no data, a duo with
 * forty joint games and a truncated ceiling -- has to travel with the answer.
 * In the panel, never in a footnote.
 *
 * Visible, but quiet: caption-sized and unboxed. A shaded card with its own
 * heading made the limits the loudest block under every answer, louder than
 * the number they qualify. Each line is one short clause (the server keeps
 * them that way), so the list stays readable at this size.
 */
export function Caveats({ items }: { items: string[] }) {
  const headingId = useId()
  if (items.length === 0) return null

  return (
    <section aria-labelledby={headingId} className="text-muted-foreground text-xs">
      <h3 id={headingId} className="mb-1 flex items-center gap-1 font-medium">
        <Info className="size-3.5" aria-hidden />
        Limits
      </h3>
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  )
}
