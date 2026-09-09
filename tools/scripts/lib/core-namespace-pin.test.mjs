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
 * Pins the shell namespace gate (AGL-2706).
 *
 *   node --test tools/scripts/lib/core-namespace-pin.test.mjs
 *
 * Written the way `jsx-barrel.test.mjs` and `tenant-page-weight.test.mjs` are:
 * every FORCED RED is paired with a POSITIVE CONTROL, because a detector
 * asserted only on what it should catch is half-tested, and the untested half
 * is the one that produces false positives until somebody deletes the gate.
 *
 * The forced red against the REAL module graph goes through an injected
 * `read` that doctors one module IN MEMORY, and it replays the exact import
 * this gate was built for. Nothing here writes to the tree: this is a shared
 * checkout, and a file swapped on disk to prove a red is a file that rides
 * along in whichever agent commits next.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createResolver } from '../../lint-rules/lib/app-router-graph.mjs'
import {
  SHELL_ENTRIES,
  measureNamespacePins,
  readCoreNamespaceImports,
} from './core-namespace-pin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-core-namespace-pin.mjs')
/** The console shell — the entry the AGL-2706 regression actually landed in. */
const CONSOLE_SHELL = SHELL_ENTRIES[0]
/** The module that held it, and cost 214.3 KB gzipped on every console route. */
const OFFENDER = join(REPO_ROOT, 'apps/console/utils/realm-plugins.client.ts')

// Shared across the shell walks below for the reason the CLI shares them:
// nine entries whose closures overlap almost entirely, and a resolver or a
// source read per entry is most of the run.
const sources = new Map()
const read = (file) => {
  let source = sources.get(file)
  if (source === undefined)
    sources.set(file, (source = readFileSync(file, 'utf8')))
  return source
}
const resolve = createResolver(REPO_ROOT)

test('reads a value namespace import of the core barrel', () => {
  assert.deepEqual(
    readCoreNamespaceImports("import * as Aglyn from '@aglyn/aglyn'\n"),
    [{ line: 1, local: 'Aglyn' }],
  )
})

test('a type-only namespace is erased, so it is not a pin', () => {
  assert.deepEqual(
    readCoreNamespaceImports("import type * as Aglyn from '@aglyn/aglyn'\n"),
    [],
  )
})

test('named and default imports of the barrel are not pins', () => {
  const source = [
    "import { canvas } from '@aglyn/aglyn'",
    "import type { PluginId } from '@aglyn/aglyn'",
  ].join('\n')
  assert.deepEqual(readCoreNamespaceImports(source), [])
})

test('a namespace of something that is not the core barrel is not a pin', () => {
  const source = [
    "import * as React from 'react'",
    "import * as Besigner from '@aglyn/besigner'",
    "import * as media from '@aglyn/aglyn/app-utils/media-ref'",
  ].join('\n')
  assert.deepEqual(readCoreNamespaceImports(source), [])
})

test('a commented-out namespace import is not a pin', () => {
  const source = [
    "// import * as Aglyn from '@aglyn/aglyn'",
    "/* import * as Aglyn from '@aglyn/aglyn' */",
  ].join('\n')
  assert.deepEqual(readCoreNamespaceImports(source), [])
})

test('a dynamic import of the barrel is not a pin — that is the escape hatch', () => {
  const source = "const Aglyn = await import('@aglyn/aglyn')\n"
  assert.deepEqual(readCoreNamespaceImports(source), [])
})

test('every shell entry reaches zero namespace pins today', () => {
  for (const entry of SHELL_ENTRIES) {
    const measured = measureNamespacePins({
      entry: join(REPO_ROOT, entry),
      read,
      resolve,
    })
    assert.equal(
      measured.pins.length,
      0,
      `${entry}: ${JSON.stringify(measured.pins)}`,
    )
    assert.ok(
      measured.moduleCount > 100,
      `${entry} reached ${measured.moduleCount} modules`,
    )
  }
})

test('FORCED RED: the AGL-2706 import, replayed in memory, reddens the console shell', () => {
  const doctored = (file) =>
    file === OFFENDER
      ? read(file).replace(
          "import type * as Aglyn from '@aglyn/aglyn'",
          "import * as Aglyn from '@aglyn/aglyn'",
        )
      : read(file)
  const measured = measureNamespacePins({
    entry: join(REPO_ROOT, CONSOLE_SHELL),
    read: doctored,
    resolve: createResolver(REPO_ROOT),
  })
  assert.equal(measured.pins.length, 1)
  assert.equal(measured.pins[0].file, OFFENDER)
  assert.equal(measured.pins[0].local, 'Aglyn')
})

test('the CLI exits 0 and names every shell', () => {
  const output = execFileSync('node', [CLI], { encoding: 'utf8' })
  for (const entry of SHELL_ENTRIES) assert.ok(output.includes(entry), output)
  assert.ok(output.includes('0 namespace pin(s)'), output)
})

test('--json reports the module count for each shell', () => {
  const parsed = JSON.parse(
    execFileSync('node', [CLI, '--json'], { encoding: 'utf8' }),
  )
  assert.equal(parsed.length, SHELL_ENTRIES.length)
  for (const shell of parsed) {
    assert.ok(SHELL_ENTRIES.includes(shell.entry))
    assert.deepEqual(shell.pins, [])
    assert.ok(shell.moduleCount > 100)
  }
})
