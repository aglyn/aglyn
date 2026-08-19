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
 * Pins the barrel gate (AGL-1895).
 *
 *   node --test tools/scripts/lib/jsx-barrel.test.mjs
 *
 * Written the way `brand-literals.test.mjs` is: every FORCED RED is paired
 * with a POSITIVE CONTROL, because a detector asserted only on what it should
 * catch is half-tested, and the untested half is the one that produces false
 * positives until somebody deletes the gate.
 *
 * The forced reds against the REAL module graph go through an injected
 * `read` that doctors the barrel IN MEMORY. Nothing here writes to the tree.
 * This is a shared checkout — a file swapped on disk to prove a red is a file
 * that rides along in whichever agent commits next.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BARREL,
  collectBarrelGraph,
  evaluateBarrel,
  measureBarrel,
  packageOf,
  readBarrelSpecifiers,
} from './jsx-barrel.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-jsx-barrel.mjs')
const BASELINE = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'tools', 'scripts', 'jsx-barrel-baseline.json'),
    'utf8',
  ),
)
const ENTRY = join(REPO_ROOT, BARREL)

/** The real tree, with the barrel's own text replaced. Disk is untouched. */
const readWithBarrel = (source) => (file) =>
  file === ENTRY ? source : readFileSync(file, 'utf8')

const realBarrel = readFileSync(ENTRY, 'utf8')

test('packageOf reduces a specifier to the dependency that bills for it', () => {
  assert.equal(packageOf('@mui/x-data-grid'), '@mui/x-data-grid')
  assert.equal(packageOf('@mui/material/styles'), '@mui/material')
  assert.equal(packageOf('lodash-es/cloneDeep'), 'lodash-es')
  assert.equal(packageOf('react-virtuoso'), 'react-virtuoso')
})

test('packageOf ignores what is not a third-party dependency', () => {
  // The positive control for the rule above. If these counted, every relative
  // import in a 188-module graph would land in the package pin and the list
  // would be unreadable within a week.
  assert.equal(packageOf('./lib/components/menu'), null)
  assert.equal(packageOf('../thing'), null)
  assert.equal(packageOf('node:fs'), null)
  assert.equal(packageOf(''), null)
})

test('readBarrelSpecifiers collects, dedupes and sorts re-exports', () => {
  assert.deepEqual(
    readBarrelSpecifiers(
      "export * from './b'\nexport * from './a'\nexport {x} from './b'\n",
    ),
    ['./a', './b'],
  )
})

test('readBarrelSpecifiers ignores type-only re-exports', () => {
  // Not pedantry: TypeScript erases these, so they are not runtime edges and
  // they cost a published page nothing. Pinning them would make the gate red
  // over changes that move zero bytes.
  const specifiers = readBarrelSpecifiers(
    "export type * from './types'\nexport type {A} from './a'\nexport * from './real'\n",
  )
  assert.deepEqual(specifiers, ['./real'])
})

test('collectBarrelGraph finds a package several hops down', () => {
  const files = {
    '/x/index.ts': "export * from './a'",
    '/x/a.ts': "import './b'",
    '/x/b.ts': "import {DataGrid} from '@mui/x-data-grid'",
  }
  const graph = collectBarrelGraph({
    entry: '/x/index.ts',
    read: (file) => files[file],
    resolve: (specifier, from) => {
      const path = `/x/${specifier.replace('./', '')}.ts`
      return files[path] ? path : null
    },
  })
  assert.deepEqual(graph.packages, ['@mui/x-data-grid'])
  // Blame lands on the module that wrote the import, which is where the fix
  // goes — not on the barrel that merely reached it.
  assert.equal(graph.firstImporter.get('@mui/x-data-grid'), '/x/b.ts')
})

test('collectBarrelGraph terminates on an import cycle', () => {
  const files = {
    '/x/index.ts': "export * from './a'",
    '/x/a.ts': "import './index'\nimport 'mitt'",
  }
  const graph = collectBarrelGraph({
    entry: '/x/index.ts',
    read: (file) => files[file],
    resolve: (specifier) => {
      const path = `/x/${specifier.replace('./', '')}.ts`
      return files[path] ? path : null
    },
  })
  assert.deepEqual(graph.packages, ['mitt'])
  assert.equal(graph.modules.size, 2)
})

test('evaluateBarrel reports both directions, and both are red', () => {
  const verdict = evaluateBarrel(
    { specifiers: ['./a', './new'], packages: ['react'] },
    { specifiers: ['./a', './gone'], packages: ['react', 'mitt'] },
  )
  assert.deepEqual(verdict.specifiers.added, ['./new'])
  assert.deepEqual(verdict.specifiers.removed, ['./gone'])
  assert.deepEqual(verdict.packages.removed, ['mitt'])
  assert.equal(verdict.clean, false)
})

// ── The real graph ─────────────────────────────────────────────────────────

test('POSITIVE CONTROL: the real barrel matches the checked-in allowlist', () => {
  const measured = measureBarrel(REPO_ROOT, (file) =>
    readFileSync(file, 'utf8'),
  )
  const verdict = evaluateBarrel(measured, BASELINE)
  assert.deepEqual(verdict.specifiers.added, [])
  assert.deepEqual(verdict.specifiers.removed, [])
  assert.deepEqual(verdict.packages.added, [])
  assert.deepEqual(verdict.packages.removed, [])
  assert.equal(verdict.clean, true)
})

test('POSITIVE CONTROL: the CLI exits 0 against the tree as it stands', () => {
  const out = execFileSync('node', [CLI], { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.match(out, /matches the allowlist/)
})

test('FORCED RED: re-exporting DataTable is caught, by both pins', () => {
  // The exact AGL-1290 regression, against the REAL module graph. It has to
  // fail on the export list AND on the package list — the first is the change
  // a reviewer sees, the second is the ~159 KB gzipped it actually costs.
  const measured = measureBarrel(
    REPO_ROOT,
    readWithBarrel(
      `${realBarrel}\nexport * from './lib/components/data-table.component'\n`,
    ),
  )
  const verdict = evaluateBarrel(measured, BASELINE)
  assert.deepEqual(verdict.specifiers.added, [
    './lib/components/data-table.component',
  ])
  assert.deepEqual(verdict.packages.added, ['@mui/x-data-grid'])
  assert.equal(verdict.clean, false)
})

test('FORCED RED: re-exporting GridList drags react-virtuoso back in', () => {
  const measured = measureBarrel(
    REPO_ROOT,
    readWithBarrel(
      `${realBarrel}\nexport * from './lib/components/grid-list'\n`,
    ),
  )
  const verdict = evaluateBarrel(measured, BASELINE)
  assert.deepEqual(verdict.specifiers.added, ['./lib/components/grid-list'])
  assert.deepEqual(verdict.packages.added, ['react-virtuoso'])
})

test('FORCED RED: a heavy import added to an ALREADY-allowlisted module', () => {
  // The regression the export list cannot see, and the reason the package pin
  // exists. `menu` is on the allowlist; nothing about its export line changes
  // when it reaches for a virtualizer, so pin 1 stays green and pin 2 does not.
  const menu = join(REPO_ROOT, 'libs/shared/ui/jsx/src/lib/components/menu.tsx')
  const measured = measureBarrel(REPO_ROOT, (file) =>
    file === menu
      ? `import 'react-virtuoso'\n${readFileSync(file, 'utf8')}`
      : readFileSync(file, 'utf8'),
  )
  const verdict = evaluateBarrel(measured, BASELINE)
  assert.deepEqual(verdict.specifiers.added, [], 'the export list is unchanged')
  assert.deepEqual(verdict.packages.added, ['react-virtuoso'])
  assert.equal(verdict.clean, false)
})

test('FORCED RED: dropping an export is red too, not silently forgiven', () => {
  const measured = measureBarrel(
    REPO_ROOT,
    readWithBarrel(
      realBarrel.replace("export * from './lib/components/sr-only'", ''),
    ),
  )
  const verdict = evaluateBarrel(measured, BASELINE)
  assert.deepEqual(verdict.specifiers.removed, ['./lib/components/sr-only'])
  assert.equal(verdict.clean, false)
})
