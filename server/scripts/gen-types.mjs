/**
 * Generate ../shared/run-types.ts from ../shared/run-schema.json.
 *
 * The schema is the single source of truth for the contract. Both the server
 * and the client import the generated file, so neither can hand-maintain a
 * second copy that drifts from it silently.
 */
import { readFile, writeFile } from "node:fs/promises"
import { compile } from "json-schema-to-typescript"

const schema = JSON.parse(await readFile(new URL("../../shared/run-schema.json", import.meta.url), "utf8"))

const ts = await compile(schema, "RunPayload", {
  additionalProperties: false,
  bannerComment:
    "/* eslint-disable */\n/**\n * GENERATED FILE -- do not edit.\n * Source: shared/run-schema.json\n * Regenerate: cd server && npm run gen:types\n */",
  style: { semi: false, singleQuote: false },
})

await writeFile(new URL("../../shared/run-types.ts", import.meta.url), ts)
console.log("wrote shared/run-types.ts")
