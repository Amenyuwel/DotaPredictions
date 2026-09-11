---
name: code-quality
description: Standards for writing and reviewing clean, correct, maintainable code in any language, built on KISS, YAGNI, DRY, and SOLID, with a firm default against over-engineering and unnecessary packages. Use this skill whenever writing new code, refactoring, fixing bugs, reviewing a diff or PR, or when the user asks to "clean up", "improve", "make production-ready", or "review" code - even if they don't say "quality". Also use for scripts over ~20 lines, since small scripts grow into big ones.
---

# Code Quality

Goal: code a new teammate can read, trust, and change safely six months from now. Quality is not polish added at the end; it's a set of choices made while writing.

## Priority order

When goals conflict, resolve in this order:

1. **Correct** - does what it claims, including edge cases.
2. **Clear** - intent obvious from reading it once.
3. **Safe** - fails loudly, validates input, no secrets or injection holes.
4. **Simple** - fewest moving parts that meet the need.
5. **Fast** - only optimize what's measured or obviously hot.

A clever 3-line solution that nobody can debug loses to a plain 10-line one.

## Design principles

These four principles guide every design decision. They sometimes pull in different directions; when they do, **KISS and YAGNI win**. Simplicity is the default, and complexity must earn its place.

### KISS - Keep It Simple
Choose the most straightforward solution that fully meets the current requirement. A plain function beats a class; a class beats a hierarchy; a module beats a framework. If a junior developer couldn't follow the code in one read, simplify it before shipping.

### YAGNI - You Aren't Gonna Need It
Build only what is required now. Don't add options, hooks, extension points, config flags, generic type parameters, or "future-proof" layers for requirements nobody has stated. Speculative code costs reading time, testing time, and maintenance forever, and the imagined future usually arrives in a different shape than predicted. When the need becomes real, add it then - with better information.

### DRY - Don't Repeat Yourself
DRY is about **knowledge**, not text. Each business rule, constant, or piece of logic should have one authoritative home, so a change happens in one place. But two pieces of code that look alike and change for different reasons are *not* duplication - merging them couples unrelated things.

- Apply the **rule of three**: tolerate a second copy; abstract on the third, once the real shape of the pattern is clear.
- Duplication is far cheaper than the wrong abstraction. If an abstraction starts sprouting flags and special cases to serve its callers, inline it back.

### SOLID - apply pragmatically
SOLID helps keep larger, object-oriented codebases changeable. Use it as a lens for spotting problems, not a template to stamp onto every file. Taken literally everywhere, it produces exactly the over-engineering this skill forbids.

- **S - Single Responsibility**: a module/class/function has one reason to change. This one applies everywhere, in any paradigm.
- **O - Open/Closed**: extend behavior by adding code rather than editing stable code - *once there are real, recurring variations*. Don't pre-build extension points for one case.
- **L - Liskov Substitution**: a subtype must work anywhere its parent does, without surprises. If a subclass has to throw "not supported" for an inherited method, the hierarchy is wrong - prefer composition.
- **I - Interface Segregation**: keep interfaces small and client-specific; nobody should depend on methods they don't use.
- **D - Dependency Inversion**: core logic depends on abstractions, not concrete I/O - *where it enables testing or genuinely swappable implementations*. Passing a function or object as a parameter is usually enough; a DI container rarely is needed.

## Over-engineering: refuse by default

Default stance: **don't build it**. Complexity is only justified when at least one of these is true:

1. A **current, stated requirement** demands it (not a hypothetical one).
2. A **measured problem** exists (profiled slowness, observed bugs, real scale).
3. The **existing codebase convention** already uses the pattern, so matching it is the simpler choice.
4. The **user explicitly insists** after hearing the trade-off.
5. The **simple fix would be unsafe** - it leaves edge cases unhandled or risks breaking production (see "Fixes and patches" below).

Common over-engineering signals - remove or avoid these unless one of the conditions above holds:

- An interface or abstract base class with only one implementation
- Factories, builders, registries, or strategy patterns for a single case
- Layers that only forward calls (service → manager → handler → repository doing nothing new)
- Generic/templated code serving one concrete type
- Config options, feature flags, or plugin systems nobody asked for
- Custom frameworks, event buses, or DSLs for problems a few functions solve
- Caching, queuing, sharding, or microservices without measured need
- Wrapping a standard library or well-known API in your own thin wrapper "in case we switch"

**When the user asks for something over-engineered**: say briefly why a simpler version would serve them better, and offer that version. If they have a real reason (scale, team convention, planned requirement they can name) or still prefer their approach, respect it and build it well. The goal is to prevent accidental complexity, not to override the user.

**When you catch yourself adding it**: stop and ask, "What current requirement does this serve?" No answer means delete it.

## Fixes and patches: simple first, escalate when unsafe

When fixing a bug or changing behavior, start from the smallest change that fixes the **root cause**. A minimal patch is easier to review, less likely to regress, and keeps the diff honest.

But "simple" only counts if it's also correct. Before settling on a patch, check it:

- **Root cause or symptom?** A patch that hides the symptom (catching and ignoring an error, adding a null check where the null should never exist, a `sleep` to dodge a race) leaves the real bug in place to resurface elsewhere.
- **Edge cases**: empty, null, zero, boundary values, duplicates, concurrent calls, retries, unicode, timezones, very large input. Does the patch handle them, or introduce new ones?
- **Production risk**: could it corrupt or lose data, break an API contract, fail under load, create a race condition, or break other callers of the changed code?
- **Patch-on-patch**: if this is the third workaround in the same spot, the area needs a proper fix, not another layer.

Decide:

- **Patch passes the checks** → ship the simple patch. Don't refactor surrounding code "while you're there" - mention it as a follow-up instead.
- **Patch creates edge cases or production risk** → use the cleaner, more thorough solution, even if it's a bigger change. This is legitimate complexity, not over-engineering: it serves a real, present correctness need.

When escalating, tell the user briefly: what the simple patch would have been, what specifically it would break or miss, and why the fuller fix avoids it. Keep the fuller fix as small as it can be while still being correct - escalating means "enough to be safe," not "rewrite the module." If both options are reasonable and the risk is a judgment call (e.g. an edge case that may never occur in their data), present both with the trade-off and let the user choose.

## Packages: refuse by default

Every dependency is code you don't control: security exposure, breaking upgrades, install weight, and supply-chain risk. The default answer to "should I add a package?" is **no**.

Before adding anything, check in order:

1. **Standard library / platform** - can the language or browser already do it? (e.g. `fetch`, `URL`, `Intl`, `structuredClone`, Python's `pathlib`, `dataclasses`, `itertools`, `json`, `argparse`)
2. **Already installed** - does the project already depend on something that covers it?
3. **Small code** - can ~20-30 clear lines do it? Then write them.

Add a package only when the problem is **genuinely hard to get right** and a mistake is costly: cryptography, authentication, timezone/date arithmetic, parsing complex formats (CSV edge cases, PDF, XML), HTML sanitization, database drivers, or a framework the project is built on.

When a package is justified:
- Pick well-maintained, widely-used, small-footprint options.
- Tell the user in one line what it's for and why the stdlib/hand-rolled option isn't enough.
- Never add a package for trivial helpers (padding strings, checking odd numbers, one lodash function, a single date format).
- Dev tooling (formatter, linter, test runner) is fine - it doesn't ship to users.

## Before writing

- Read surrounding code first. Match existing conventions (naming, structure, error style, test layout) even if you'd choose differently. Consistency beats personal preference.
- Check for existing helpers before writing new ones. Duplication is cheaper than the wrong abstraction, but reinventing a utility that already exists is neither.
- Clarify the input/output contract: types, ranges, empty cases, failure cases.

## Writing rules

### Naming
- Names say what, not how: `unpaid_invoices`, not `filtered_list`.
- Booleans read as questions: `is_active`, `has_access`, `should_retry`.
- Functions are verbs: `fetch_user`, `calculate_total`. Avoid vague verbs like `handle`, `process`, `do` unless nothing better fits.
- No abbreviations beyond universal ones (`id`, `url`, `db`). `cust_mgr_cfg` costs every reader time.
- Length scales with scope: `i` is fine in a 3-line loop, not as a module global.

### Functions
- One job per function. If describing it needs "and", consider splitting.
- Keep them short enough to see whole (~40 lines is a soft signal, not a rule).
- Few parameters (≤4). More than that usually means a missing object/config type.
- Prefer returning values over mutating arguments.
- Use early returns / guard clauses to keep the happy path unindented.

```python
# Prefer
def ship(order):
    if not order.paid:
        raise OrderNotPaid(order.id)
    if not order.items:
        return None
    return create_shipment(order)
```

### Errors
- Never swallow errors silently. Every `except`/`catch` either handles meaningfully, adds context and re-raises, or logs with enough detail to debug.
- Catch the narrowest exception type possible.
- Error messages include what failed and the relevant value: `f"User {user_id} not found"`, not `"Error"`.
- Validate at boundaries (user input, network, files, env vars). Trust data inside the boundary.
- Fail fast on impossible states rather than limping on with bad data.

### State and side effects
- Keep I/O (network, disk, DB, time, randomness) at the edges; keep core logic pure so it's testable.
- Avoid global mutable state. Pass dependencies in.
- Make immutability the default where the language supports it (`const`, `final`, frozen dataclasses, `readonly`).

### Types
- Use the type system the language offers (TypeScript types, Python type hints, etc.) on public interfaces at minimum.
- Model states explicitly: a union/enum like `"loading" | "error" | "ready"` beats three booleans that can contradict each other.
- Avoid `any` / untyped escape hatches; if unavoidable, isolate and comment why.

### Magic values
- Name constants: `MAX_RETRIES = 3`, not a bare `3` in a loop.
- Config (URLs, keys, limits) comes from config/env, never hardcoded. Secrets never in source.

### Comments
- Comment **why**, not **what**. The code says what.
- Good: business rules, non-obvious constraints, workarounds with a link to the issue.
- Delete commented-out code; version control remembers it.
- Public functions/modules get a short docstring: purpose, params, return, raises.
- `TODO` includes owner or ticket, or it's noise.

### Dependencies
- Follow the package policy above. When one is justified: pin versions for apps, use ranges for libraries, commit the lockfile.

### Security basics
- Parameterized queries only; never build SQL/shell commands with string concatenation.
- Escape output for its context (HTML, URL, shell).
- Don't log secrets, tokens, passwords, or full personal data.
- Least privilege for credentials and file permissions.

### Performance
- Pick the right data structure first (set/dict lookups vs list scans) - that's most of the win.
- Watch for N+1 queries and work inside loops that could be hoisted.
- Don't micro-optimize without a measurement. Leave a comment when you do optimize, with the reason.

## Tests

- New behavior gets a test; bug fixes get a test that fails before the fix.
- Test behavior through public interfaces, not internals.
- Cover: happy path, empty/zero, boundary values, invalid input, failure of dependencies.
- One reason to fail per test; name tests as sentences: `test_expired_token_is_rejected`.
- Tests are deterministic: no real network, fixed time and random seeds.

## Refactoring

- Refactor in small steps with tests green between each.
- Don't mix refactoring and behavior changes in one commit/diff - reviewers can't verify either.
- Rule of three: abstract on the third repetition, not the first.
- Refactoring toward simpler is always welcome. Refactoring toward more layers needs a current reason.

## Reviewing code

When asked to review, check in priority order and report findings grouped by severity:

- **Blocking** - bugs, security holes, data loss risk, broken edge cases, missing error handling.
- **Should fix** - over-engineering (speculative abstractions, unneeded layers or patterns), unnecessary dependencies, unclear naming, oversized functions, missing tests, duplicated knowledge, wrong abstraction.
- **Nit** - style, minor naming, formatting (skip if a formatter/linter would catch it).

For each finding give: location, the problem, why it matters, and a concrete fix (code snippet when useful). Mention what's done well briefly - it tells the author what to keep doing. Don't pad reviews; if the code is solid, say so.

## Before delivering code

Run through this quickly:

- [ ] Handles empty, null, and boundary inputs
- [ ] No silent error swallowing
- [ ] No hardcoded secrets, URLs, or magic numbers
- [ ] Names read clearly without comments
- [ ] No dead code, debug prints, or commented-out blocks
- [ ] Simplest design that meets the current requirement - no speculative features or abstractions
- [ ] Fixes address the root cause; simple patch checked for edge cases and production risk before choosing it
- [ ] No new package that stdlib or a few lines could replace
- [ ] Matches existing project conventions
- [ ] Tests added or updated (or noted why not)
- [ ] Runs - if you can execute it, execute it

## Language-specific guidance

Read the matching reference only when working in that language:

- Python: `references/python.md`
- JavaScript / TypeScript: `references/javascript-typescript.md`

For other languages, apply the principles above and follow the language's dominant community style guide and formatter.
