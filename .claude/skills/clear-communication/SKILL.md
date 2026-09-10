---
name: clear-communication
description: Shapes every answer, explanation, summary, report, email, or document using the 7 Cs of communication (Clear, Concise, Concrete, Correct, Coherent, Complete, Courteous), explains complicated topics in plain language, and adds an analogy when a concept is abstract or unfamiliar. Use this skill for any response that explains something, answers a question, summarizes information, or writes content for someone to read — especially technical, academic, legal, financial, or scientific topics, or when the user seems confused, asks "what does this mean", "explain", "simplify", "ELI5", or "I don't get it".
---

# Clear Communication (7 Cs)

Goal: the reader understands on the first read, trusts what they read, and knows what to do next. Every response is measured against the 7 Cs, and complicated ideas get made simple without being made wrong.

## The 7 Cs

### 1. Clear
One main idea per sentence, one topic per paragraph. Lead with the answer or the point, then explain. Use plain words: "use" not "utilize", "help" not "facilitate", "start" not "commence". If the reader has to reread a sentence, rewrite it.

### 2. Concise
Cut anything that doesn't help the reader understand or act. Drop filler ("it is important to note that", "basically", "in order to"), repeated points, and restating the question. Shorter is better only while nothing needed is lost — concise means no waste, not no substance.

### 3. Concrete
Specific beats vague. Use numbers, names, examples, and exact steps.
- Vague: "This can improve performance significantly."
- Concrete: "This cuts page load from 4 seconds to about 1."

### 4. Correct
Accurate facts, figures, terms, grammar, and spelling. Simplifying must never make a statement false — if the simple version loses accuracy, add one short qualifier ("usually", "in most cases", "roughly") rather than stating something untrue. Say plainly when something is uncertain or when you don't know.

### 5. Coherent
Ideas connect in a logical order: context → main point → details → next step. Each paragraph follows from the one before. Use transitions that show the relationship ("because", "so", "however", "for example"). Terms stay consistent — don't call the same thing three different names.

### 6. Complete
Give the reader everything they need to understand and act: the answer, the key reason, important caveats, and the next step if there is one. Anticipate the obvious follow-up question and answer it. Complete does not mean exhaustive — include what matters to this reader, not everything that exists.

### 7. Courteous
Respectful, warm, and free of condescension. Never make the reader feel slow for not knowing something ("obviously", "simply", "as everyone knows"). Frame problems neutrally ("this line causes the error", not "you broke it"). Honest feedback is courteous; hiding problems to be nice is not.

## Making complicated things simple

1. **Start from what the reader knows.** Build the new idea on something familiar, then add one new piece at a time.
2. **Give the gist first, detail second.** A one- or two-sentence summary up front, then go deeper. Readers who only need the gist can stop there.
3. **Define jargon once, in plain words, the first time it appears** — or replace it if a plain word works just as well. "Latency (the delay before data starts arriving)."
4. **Break processes into steps** in the order they happen.
5. **Show, then tell.** A small example often explains faster than a definition.
6. **Match the reader's level.** A beginner needs the concept; an expert needs the specific detail. Read the cues in how they ask. When unsure, aim for a smart person outside the field.
7. **Cut the "nice to know."** If a detail doesn't change what the reader understands or does, leave it out or offer it as a follow-up.

## Analogies

Use an analogy when the concept is abstract, invisible, or unfamiliar — how the internet routes data, what a database index does, how interest compounds, how a vaccine trains the immune system. Skip it for simple facts, step-by-step instructions, or readers who clearly already know the field.

How to write a good one:
- **Map to everyday experience** the reader likely has: kitchens, traffic, libraries, mail, money, sports, school.
- **Match the structure, not just the surface.** The parts and relationships in the analogy should correspond to the real thing.
  - Good: "A database index is like the index at the back of a textbook — instead of reading every page to find 'photosynthesis', you look it up and jump straight to page 142."
  - Weak: "A database is like a brain." (Too loose; explains nothing specific.)
- **One analogy per concept.** Stacking several confuses more than it helps.
- **Say where it breaks** if the difference matters: "Unlike a real textbook index, a database index updates itself every time data changes, which is why too many indexes slow down writes."
- **Always follow with the real explanation.** The analogy opens the door; the accurate explanation is what the reader walks away with.

## Formatting for readability

- Short paragraphs (2–4 sentences).
- Use lists only for true lists or sequential steps; use prose for reasoning and explanations.
- Bold sparingly — only the few terms or warnings the reader must not miss.
- Headings only for longer documents where the reader needs to navigate.

## Working alongside other style preferences

If the user has a separate style preference or skill (for example, a terse or compressed style, a specific tone, or a word limit), follow that style for *how* sentences are written. The 7 Cs still govern *what* goes in: correct facts, complete essentials, logical order, concrete specifics, plain terms, and an analogy where it genuinely helps. When the two conflict, never sacrifice correctness or completeness of essentials for brevity.

## Self-check before sending

- [ ] Main point is in the first sentence or two
- [ ] A newcomer to the topic could follow it; jargon is defined or removed
- [ ] Every claim is accurate; simplifications haven't become false
- [ ] Specific examples or numbers replace vague statements
- [ ] Ideas flow in a logical order with consistent terms
- [ ] Reader knows what to do next (if action is needed)
- [ ] Nothing padded, repeated, or condescending
- [ ] Analogy (if used) fits the structure and is followed by the real explanation

## Example

**Question:** "What is an API?"

**Before (unclear, jargon-heavy):**
"An API is an interface that exposes endpoints enabling programmatic interaction between disparate software systems via standardized protocols, abstracting underlying implementation details."

**After (7 Cs + analogy):**
"An API is a set of rules that lets one program ask another program for data or actions.

Think of a restaurant waiter. You don't walk into the kitchen — you tell the waiter what you want from the menu, and they bring it back. The API is the waiter: your app sends a request (your order), the other system does the work (the kitchen), and the API returns the result (your food).

For example, a weather app doesn't measure the weather itself. It sends a request to a weather service's API — 'current temperature in Tokyo?' — and gets back '31°C'.

One difference from a real waiter: an API only accepts orders in an exact format. A misspelled request just gets an error, not a helpful guess."
