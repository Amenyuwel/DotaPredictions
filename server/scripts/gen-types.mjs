/**
 * Generate ../shared/*-types.ts from the JSON Schemas beside them.
 *
 * The schemas are the single source of truth for the two contracts this project
 * has. Both the server and the client import the generated files, so neither
 * can hand-maintain a second copy that drifts from them silently.
 *
 *   run-schema.json      what the engine publishes and the server serves
 *   overlay-schema.json  what an admin may change about it without a re-crawl
 *
 * Two schemas rather than one because they are answers to different questions.
 * A run says what was measured; an overlay says what a table currently pays.
 * Folding the second into the first would make an admin edit and a measurement
 * the same kind of thing, which is precisely the distinction the audit trail
 * exists to keep.
 */
import { readFile, writeFile } from "node:fs/promises"
import { compile } from "json-schema-to-typescript"

const CONTRACTS = [
  { schema: "run-schema.json", types: "run-types.ts", root: "RunPayload" },
  { schema: "overlay-schema.json", types: "overlay-types.ts", root: "ConfigOverlay" },
]

for (const { schema: schemaFile, types, root } of CONTRACTS) {
  const url = new URL(`../../shared/${schemaFile}`, import.meta.url)
  const schema = JSON.parse(await readFile(url, "utf8"))

  const ts = await compile(schema, root, {
    additionalProperties: false,
    bannerComment:
      "/* eslint-disable */\n/**\n * GENERATED FILE -- do not edit.\n" +
      ` * Source: shared/${schemaFile}\n` +
      " * Regenerate: cd server && npm run gen:types\n */",
    style: { semi: false, singleQuote: false },
  })

  await writeFile(new URL(`../../shared/${types}`, import.meta.url), ts)
  console.log(`wrote shared/${types}`)
}
