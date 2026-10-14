import { cn } from "@/lib/utils"

/**
 * One grey box standing where a piece of the answer will be.
 *
 * Sized by the caller, because the point of a skeleton is that it is the SHAPE
 * of what is coming: a block of the wrong height reserves the wrong space and
 * the page still jumps when the real thing lands, which is the one job it had.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

/**
 * A group of skeletons, with the sentence a screen reader gets instead of them.
 *
 * Skeletons are silent. They are a picture of a layout, so a reader who cannot
 * see the layout is handed nothing at all -- a region that was announced as
 * "Loading the published run" while it had a spinner in it goes quiet the
 * moment the spinner is replaced by grey boxes. The label is that sentence,
 * kept off screen, and `role="status"` announces it once rather than on every
 * pulse.
 *
 * `aria-busy` marks the region as still filling, so assistive technology can
 * skip it rather than read placeholder structure as content.
 */
function SkeletonPanel({
  label,
  className,
  children,
}: {
  /** What is being waited for, in the words the spinner used to say aloud. */
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" aria-busy className={cn("space-y-2", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export { Skeleton, SkeletonPanel }
