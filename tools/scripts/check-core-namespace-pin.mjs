/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Fail when an app shell's eager graph holds the `@aglyn/aglyn` namespace as
 * a VALUE (AGL-2706).
 *
 * `check-aglyn-barrel.mjs` pins what the core barrel REACHES. This one pins
 * how the shells IMPORT it, which is the other half of the same bill and the
 * half no allowlist can express: a namespace import moves nothing in the
 * barrel's own graph and still ships all of it.
 *
 * ```
 * npm run check:core-namespace-pin
 * npm run check:core-namespace-pin -- --json
 * ```
 *
 * There is no `--write`. The allowed count is zero, in both shells, forever;
 * the escape hatch for the one legitimate need is a relative `import()`, not
 * a baseline entry.
 *
 * Exit codes: 0 clean · 1 a shell holds the namespace.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SHELL_ENTRIES,
  WHY_NAMESPACE_PIN,
  measureShell,
} from './lib/core-namespace-pin.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const asJson = process.argv.includes('--json')

const read = (file) => readFileSync(file, 'utf8')
const shells = SHELL_ENTRIES.map((entry) =>
  measureShell(REPO_ROOT, read, entry),
)
const pinned = shells.filter((shell) => shell.pins.length)

if (asJson) {
  console.log(
    JSON.stringify(
      shells.map((shell) => ({
        entry: shell.entry,
        moduleCount: shell.moduleCount,
        pins: shell.pins.map((pin) => ({
          file: relative(REPO_ROOT, pin.file),
          line: pin.line,
          local: pin.local,
        })),
      })),
      null,
      2,
    ),
  )
  process.exit(pinned.length ? 1 : 0)
}

for (const shell of shells)
  console.log(
    `${shell.entry} — ${shell.moduleCount} module(s) reached statically, ` +
      `${shell.pins.length} namespace pin(s)`,
  )

if (!pinned.length) process.exit(0)

console.error('')
for (const shell of pinned) {
  console.error(`${shell.entry} holds the core namespace as a value:`)
  for (const pin of shell.pins)
    console.error(
      `  ${relative(REPO_ROOT, pin.file)}:${pin.line}  import * as ${pin.local}`,
    )
}
console.error('')
console.error(WHY_NAMESPACE_PIN)
process.exit(1)
