# JavaScript / TypeScript Quality Reference

## Tooling
Dev tools below are fine to add - they don't ship. Runtime dependencies follow the package policy in SKILL.md: platform APIs first (`fetch`, `URL`, `Intl`, `structuredClone`, `crypto.randomUUID`).

- Prefer **TypeScript** for anything beyond a small script. Enable `"strict": true`.
- Format with **Prettier**; lint with **ESLint** (typescript-eslint). Or **Biome** as a single fast replacement.
- Tests with **Vitest** or **Jest**; component tests with Testing Library (query by role/label, not class names).
- Commit a lockfile. Use one package manager per repo.

## Style
- `const` by default, `let` when reassigned, never `var`.
- `===` / `!==` always.
- `camelCase` vars/functions, `PascalCase` types/components/classes, `UPPER_SNAKE` true constants.
- Named exports over default exports - easier refactoring and consistent import names.
- ES modules (`import`/`export`), not CommonJS, in new code.

## TypeScript
- No `any`. Use `unknown` and narrow it. If `any` is truly needed, isolate it and comment why.
- Model states as discriminated unions:
  ```ts
  type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: User[] };
  ```
- Avoid non-null assertions (`!`) - handle the null case.
- Validate external data at runtime - types don't exist at runtime; API responses can lie. A small hand-written guard is fine for simple shapes; use zod/valibot if already present or the schemas are large.
- `readonly` / `as const` for data that shouldn't change.

## Async
- `async`/`await` over `.then()` chains.
- Every promise is awaited, returned, or explicitly handled - no floating promises (enable the lint rule).
- Run independent work in parallel with `Promise.all` / `Promise.allSettled`, not sequential awaits in a loop.
- Wrap `await` at boundaries in `try/catch` with context; don't wrap every line.
- Use `AbortController` for cancellable fetches (timeouts, unmounted components).

## Idioms
- Optional chaining `a?.b` and nullish coalescing `x ?? default`. Note `??` vs `||`: `||` replaces `0` and `""` too.
- Native array/object methods over lodash-style utilities. `map`/`filter`/`reduce` for transforms; plain `for...of` when there are side effects or early exits. Avoid `reduce` when it hurts readability.
- Don't mutate arrays/objects you didn't create; spread or `structuredClone`.
- Dates: use `Intl.DateTimeFormat` for display, store ISO strings/UTC. Timezone arithmetic is a hard domain where a library (date-fns, Temporal polyfill) is justified; simple formatting is not.

## Pitfalls
- `forEach` with `async` callbacks doesn't wait. Use `for...of` or `Promise.all(map(...))`.
- Floating point money - use integer cents.
- `parseInt` without radix; prefer `Number()` or `Number.parseInt(x, 10)`.
- Array `sort()` without comparator sorts as strings: `[10, 2].sort()` → `[10, 2]`.
- Never put secrets in frontend code - everything shipped to the browser is public.

## React (if used)
- Components are small, pure functions of props/state.
- Derive values during render instead of syncing with `useEffect`. Effects are for syncing with external systems only.
- Stable, unique `key`s - never array index for lists that reorder.
- Lift state only as high as needed; colocate otherwise.
- Handle loading, error, and empty states for every data fetch.
