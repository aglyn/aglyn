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
 * Pins the published-page weight budget.
 *
 *   node --test tools/scripts/lib/tenant-page-weight.test.mjs
 *
 * Written the way `jsx-barrel.test.mjs` is: every FORCED RED is paired with a
 * POSITIVE CONTROL, because a detector asserted only on what it should catch is
 * half-tested, and the untested half is the one that produces false positives
 * until somebody deletes the gate.
 *
 * The forced reds against the REAL module graph go through an injected `read`
 * that doctors one module IN MEMORY. Nothing here writes to the tree. This is a
 * shared checkout — a file swapped on disk to prove a red is a file that rides
 * along in whichever agent commits next.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createResolver, readImports } from '../../lint-rules/lib/app-router-graph.mjs'
import { collectBarrelGraph } from './jsx-barrel.mjs'
import {
  TENANT_PAGE_ENTRY,
  budgetFor,
  evaluatePageWeight,
  measurePageWeight,
} from './tenant-page-weight.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-tenant-page-weight.mjs')
const BUDGET = JSON.parse(
  readFileSync(join(REPO_ROOT, 'tools', 'tenant-page-budget.json'), 'utf8'),
)
const ENTRY = join(REPO_ROOT, TENANT_PAGE_ENTRY)

/** The real graph, with `read` optionally doctoring one module in memory. */
function measureReal(doctor = (file, source) => source) {
  return measurePageWeight({
    entry: ENTRY,
    read: (file) => doctor(file, readFileSync(file, 'utf8')),
    resolve: createResolver(REPO_ROOT),
    size: (file) => statSync(file).size,
  })
}

// --- the static/dynamic distinction the whole measurement rests on ---------

test('readImports marks an import() edge dynamic and the rest static', () => {
  const kinds = Object.fromEntries(
    readImports(
      [
        "import { a } from './static-named'",
        "import './static-bare'",
        "export * from './static-reexport'",
        "const x = await import('./lazy')",
        "const y = require('./cjs')",
      ].join('\n'),
    ).map(({ specifier, kind }) => [specifier, kind]),
  )
  assert.equal(kinds['./static-named'], 'static')
  assert.equal(kinds['./static-bare'], 'static')
  assert.equal(kinds['./static-reexport'], 'static')
  assert.equal(kinds['./cjs'], 'static')
  assert.equal(kinds['./lazy'], 'dynamic')
})

test('a static-only walk drops what only an import() reaches', () => {
  const graph = {
    '/entry.ts': "import './eager'\nconst p = () => import('./lazy')",
    '/eager.ts': "import 'react'",
    '/lazy.ts': "import 'mobx-state-tree'",
  }
  const io = {
    entry: '/entry.ts',
    read: (file) => graph[file],
    resolve: (specifier) =>
      specifier.startsWith('.') ? `${specifier.replace('.', '')}.ts` : null,
    size: () => 100,
  }

  const lazyIncluded = measurePageWeight({ ...io })
  assert.equal(lazyIncluded.moduleCount, 2, 'entry + eager, never lazy')
  assert.deepEqual(lazyIncluded.packages, ['react'])
  assert.equal(
    lazyIncluded.packages.includes('mobx-state-tree'),
    false,
    'a package only an import() reaches is not first-load weight',
  )
})

test('POSITIVE CONTROL: the barrel gates still follow import() edges', () => {
  // `staticOnly` defaults OFF, so `check:jsx-barrel` and `check:aglyn-barrel`
  // keep seeing a heavy package behind a lazy boundary. They pin the repo's
  // dependency surface, which is a different question from first-load weight.
  const graph = {
    '/entry.ts': "const p = () => import('./lazy')",
    '/lazy.ts': "import 'acorn'",
  }
  const walked = collectBarrelGraph({
    entry: '/entry.ts',
    read: (file) => graph[file],
    resolve: (specifier) =>
      specifier.startsWith('.') ? `${specifier.replace('.', '')}.ts` : null,
  })
  assert.deepEqual(walked.packages, ['acorn'])
})

// --- the verdict ----------------------------------------------------------

test('evaluatePageWeight passes at the budget and fails one byte over', () => {
  const budget = { entry: TENANT_PAGE_ENTRY, budgetBytes: 1000 }
  assert.equal(evaluatePageWeight({ bytes: 1000 }, budget).ok, true)
  const over = evaluatePageWeight({ bytes: 1001 }, budget)
  assert.equal(over.ok, false)
  assert.equal(over.over, true)
  assert.equal(over.overBy, 1)
})

test('a page getting LIGHTER is not red', () => {
  const budget = { entry: TENANT_PAGE_ENTRY, budgetBytes: 1000 }
  assert.equal(evaluatePageWeight({ bytes: 1 }, budget).ok, true)
})

test('FORCED RED: a budget recorded for a different entry measures nothing', () => {
  const verdict = evaluatePageWeight(
    { bytes: 1 },
    { entry: 'apps/tenant/app/somewhere-else.tsx', budgetBytes: 1_000_000 },
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.entryMoved, true)
})

test('budgetFor rounds the headroom up to a whole KB above the baseline', () => {
  const budget = budgetFor({ bytes: 100_000, moduleCount: 7 })
  assert.equal(budget.entry, TENANT_PAGE_ENTRY)
  assert.equal(budget.baselineBytes, 100_000)
  assert.equal(budget.baselineModules, 7)
  assert.equal(budget.budgetBytes % 1024, 0)
  assert.ok(budget.budgetBytes >= 125_000)
})

// --- against the real tree ------------------------------------------------

test('POSITIVE CONTROL: the real page is within its checked-in budget', () => {
  const measured = measureReal()
  assert.equal(
    evaluatePageWeight(measured, BUDGET).ok,
    true,
    `measured ${measured.bytes} B over ${measured.moduleCount} modules, ` +
      `budget ${BUDGET.budgetBytes} B`,
  )
})

test('POSITIVE CONTROL: the CLI exits 0 against the tree as it stands', () => {
  assert.doesNotThrow(() =>
    execFileSync('node', [CLI], { cwd: REPO_ROOT, stdio: 'pipe' }),
  )
})

test('FORCED RED: the render path reopening the shared-ui-jsx barrel', () => {
  // The regression this budget exists for, replayed. `leaf.tsx` renders every
  // author node on every published page; the barrel it deep-imports from
  // re-exports the Pages Router hooks, the inline SVG set and the ~12,000-module
  // MDI catalog, none of which a rendered node needs.
  const leaf = join(
    REPO_ROOT,
    'libs/aglyn-node-renderer/src/lib/components/leaf.tsx',
  )
  const measured = measureReal((file, source) =>
    file === leaf
      ? source.replace(
          "from '@aglyn/shared-ui-jsx/components/aglyn-text'",
          "from '@aglyn/shared-ui-jsx'",
        )
      : source,
  )
  assert.ok(
    measured.moduleCount > BUDGET.baselineModules * 10,
    `one barrel import should reopen thousands of modules, saw ${measured.moduleCount}`,
  )
  assert.equal(evaluatePageWeight(measured, BUDGET).ok, false)
})

test('POSITIVE CONTROL: an unrelated edit does not move the number', () => {
  const before = measureReal()
  const after = measureReal((file, source) =>
    file === ENTRY ? `${source}\n// a comment costs nothing\n` : source,
  )
  assert.equal(after.moduleCount, before.moduleCount)
})
