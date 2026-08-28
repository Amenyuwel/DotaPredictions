/**
 * Validate a dry-run payload with the SERVER's reader.
 *
 *   npm run check:payload -- ../run-main.json
 *
 * Python validates on write and the server validates on read, against the same
 * schema. This runs the read side against a file, so the two validators can be
 * shown to agree before anything reaches Mongo -- a contract with only one
 * implementation exercised is a contract with one untested half.
 */
import { readFileSync } from "node:fs"

import { assertRunPayload } from "../src/validate.js"

const path = process.argv[2]
if (!path) {
  console.error("usage: npm run check:payload -- <payload.json>")
  process.exit(2)
}

assertRunPayload(JSON.parse(readFileSync(path, "utf8")))
console.log(`${path}: accepted by the server's validator`)
