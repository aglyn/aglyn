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
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createResolver, readImports } from '../../lint-rules/lib/app-router-graph.mjs'
import { collectBarrelGraph } from './jsx-barrel.mjs'
import {
  FORBIDDEN_MODULES,
  TENANT_PAGE_ENTRY,
  budgetFor,
  evaluatePageWeight,
  explainVerdict,
  forbiddenReached,
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

// --- the named barrels, which are red under the ceiling too ----------------

test('forbiddenReached matches on the repo-relative suffix, not a substring', () => {
  const hit = forbiddenReached({
    modules: ['/anywhere/on/disk/libs/aglyn/src/index.ts'],
  })
  assert.deepEqual(
    hit.map(({ path }) => path),
    ['libs/aglyn/src/index.ts'],
  )
})

test('POSITIVE CONTROL: a same-named file in another package is not a match', () => {
  // The suffix carries the whole repo-relative path, so a vendored copy or a
  // sibling library's own `src/index.ts` cannot trip the pin.
  assert.deepEqual(
    forbiddenReached({
      modules: [
        '/repo/node_modules/@vendor/libs/aglyn/src/index.ts.map',
        '/repo/libs/aglyn-node-renderer/src/index.ts',
        '/repo/libs/besigner/core/src/lib/foundation/index.ts',
      ],
    }),
    [],
  )
})

test('a measurement with no module list is not silently forbidden', () => {
  // `evaluatePageWeight` is called with `{ bytes }` alone in several places.
  // An absent list has to read as "nothing reached", never as a red.
  assert.deepEqual(forbiddenReached({}), [])
  assert.equal(
    evaluatePageWeight(
      { bytes: 1 },
      { entry: TENANT_PAGE_ENTRY, budgetBytes: 1000 },
    ).ok,
    true,
  )
})

test('FORCED RED: a forbidden barrel is red while far UNDER the budget', () => {
  const verdict = evaluatePageWeight(
    { bytes: 1, modules: ['/repo/libs/aglyn/src/index.ts'] },
    { entry: TENANT_PAGE_ENTRY, budgetBytes: 10_000_000 },
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.over, false, 'the ceiling is not what caught this')
  assert.deepEqual(
    verdict.forbidden.map(({ path }) => path),
    ['libs/aglyn/src/index.ts'],
  )
})

test('every forbidden module names a file that exists and says why', () => {
  // A pin whose path stopped resolving is a pin that can never go red again.
  for (const { path, why } of FORBIDDEN_MODULES) {
    assert.ok(
      statSync(join(REPO_ROOT, path)).isFile(),
      `${path} is pinned but is not a file`,
    )
    assert.ok(why.length > 80, `${path} must explain the fix, not just forbid`)
  }
})

test('POSITIVE CONTROL: the real page reaches none of them', () => {
  assert.deepEqual(forbiddenReached(measureReal()), [])
})

test('FORCED RED: the entry taking one value back off the core barrel', () => {
  // The exact regression the pin exists for, and the one the ceiling cannot
  // see on its own: a single named import is enough to reopen the barrel, and
  // a named import is what every one of these started as.
  const measured = measureReal((file, source) =>
    file === ENTRY
      ? source.replace(
          "import { canvas, emitter } from '@aglyn/aglyn/aglyn'",
          "import { canvas, emitter } from '@aglyn/aglyn'",
        )
      : source,
  )
  const hit = forbiddenReached(measured).map(({ path }) => path)
  assert.ok(hit.includes('libs/aglyn/src/index.ts'))
  // And it brings the other two with it, which is the argument for pinning
  // the boundary rather than trusting a byte ceiling to notice: one named
  // import re-admits every module three separate pins exist to keep out.
  assert.deepEqual(hit, FORBIDDEN_MODULES.map(({ path }) => path).filter(
    (path) => path !== 'libs/shared/ui/jsx/src/index.ts',
  ))
  assert.equal(evaluatePageWeight(measured, BUDGET).ok, false)
})

test('FORCED RED: a core module reopening the foundation barrel', () => {
  // Five constants, all of them in a `foundation/constants/*` file of one or
  // two KB, reached through a barrel that pulls 114 modules.
  const canvasManager = join(
    REPO_ROOT,
    'libs/aglyn/src/lib/canvas-manager/canvas-manager.ts',
  )
  const measured = measureReal((file, source) =>
    file === canvasManager
      ? source.replace(
          "from '../foundation/constants/app'",
          "from '../foundation'",
        )
      : source,
  )
  assert.deepEqual(
    forbiddenReached(measured).map(({ path }) => path),
    ['libs/aglyn/src/lib/foundation/index.ts'],
  )
})

test('FORCED RED: the badge taking its brand off the plan table', () => {
  const measured = measureReal((file, source) =>
    file === ENTRY
      ? source.replace(
          "from '@aglyn/aglyn/app-utils/platform-brand'",
          "from '@aglyn/aglyn/app-utils/plan-entitlements'",
        )
      : source,
  )
  assert.deepEqual(
    forbiddenReached(measured).map(({ path }) => path),
    ['libs/aglyn/src/lib/app-utils/plan-entitlements.ts'],
  )
})

// --- the exit and the reason cannot drift apart ---------------------------

const SOME_BUDGET = { entry: TENANT_PAGE_ENTRY, budgetBytes: 1000 }

test('explainVerdict says nothing when the verdict is green', () => {
  const verdict = evaluatePageWeight({ bytes: 1, modules: [] }, SOME_BUDGET)
  assert.equal(verdict.ok, true)
  assert.deepEqual(explainVerdict(verdict, { bytes: 1 }, SOME_BUDGET), [])
})

test('a red verdict always yields at least one reason to print', () => {
  // The gap this closes: the CLI branched per reason and returned 1 from each
  // branch, so deleting a branch changed the EXIT CODE and no test noticed.
  // One `!ok` now decides the exit, and this asserts the reader is still told
  // why for every shape of red there is.
  const reds = [
    evaluatePageWeight(
      { bytes: 1, modules: ['/repo/libs/aglyn/src/index.ts'] },
      SOME_BUDGET,
    ),
    evaluatePageWeight({ bytes: 5000, modules: [] }, SOME_BUDGET),
    evaluatePageWeight(
      { bytes: 1, modules: [] },
      { entry: 'apps/tenant/app/moved.tsx', budgetBytes: 1000 },
    ),
  ]
  for (const verdict of reds) {
    assert.equal(verdict.ok, false)
    const reasons = explainVerdict(verdict, { bytes: 5000, moduleCount: 3 }, SOME_BUDGET)
    assert.ok(reasons.length >= 1, 'a red with no reason is a silent failure')
    for (const reason of reasons) assert.ok(reason.length > 40)
  }
})

test('explainVerdict names the forbidden module and its fix', () => {
  const verdict = evaluatePageWeight(
    { bytes: 1, modules: ['/repo/libs/aglyn/src/index.ts'] },
    SOME_BUDGET,
  )
  const text = explainVerdict(verdict, { bytes: 1, moduleCount: 1 }, SOME_BUDGET).join('\n')
  assert.match(text, /libs\/aglyn\/src\/index\.ts/)
  assert.match(text, /@aglyn\/aglyn\/app-utils/, 'must say what to import instead')
})

test('a red for two reasons at once reports both', () => {
  const verdict = evaluatePageWeight(
    { bytes: 5000, modules: ['/repo/libs/aglyn/src/index.ts'] },
    SOME_BUDGET,
  )
  assert.equal(
    explainVerdict(verdict, { bytes: 5000, moduleCount: 9 }, SOME_BUDGET).length,
    2,
  )
})

// --- the exit code itself, through the real process -----------------------

/** A budget file outside the repo, so a forced red never edits the tree. */
function budgetFile(budget) {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-page-weight-'))
  const file = join(dir, 'budget.json')
  writeFileSync(file, JSON.stringify(budget))
  return file
}

function runCli(extra = []) {
  try {
    const stdout = execFileSync('node', [CLI, ...extra], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` }
  }
}

test('FORCED RED: the CLI exits 1 over a budget it cannot meet', () => {
  // Everything above proves the VERDICT. This proves the only thing the gate
  // actually delivers to CI, which is the exit code — and it is the one thing
  // a green-path-only test can never hold: with the red branch removed, the
  // run passed silently.
  const result = runCli([
    '--budget',
    budgetFile({ entry: TENANT_PAGE_ENTRY, budgetBytes: 1 }),
  ])
  assert.equal(result.code, 1)
  assert.match(result.output, /grew past its budget/)
})

test('FORCED RED: the CLI exits 1 when the budget names another entry', () => {
  const result = runCli([
    '--budget',
    budgetFile({
      entry: 'apps/tenant/app/somewhere-else.tsx',
      budgetBytes: 10_000_000,
    }),
  ])
  assert.equal(result.code, 1)
  assert.match(result.output, /Re-baseline with --write/)
})

test('POSITIVE CONTROL: --budget against a generous budget still exits 0', () => {
  // Without this, a CLI that exited 1 unconditionally would pass both reds
  // above and nothing would say so.
  const result = runCli([
    '--budget',
    budgetFile({ entry: TENANT_PAGE_ENTRY, budgetBytes: 10_000_000 }),
  ])
  assert.equal(result.code, 0)
})

test('--write re-baselines the checked-in file, never the --budget one', () => {
  // A comparison target is not a place to bank a win. Pointed at a temp file
  // with --write, the CLI must leave it exactly as it found it.
  const file = budgetFile({ entry: TENANT_PAGE_ENTRY, budgetBytes: 1 })
  const before = readFileSync(file, 'utf8')
  // Not run for real: --write rewrites tools/tenant-page-budget.json, and a
  // test must not move the repo's baseline. The pin is that the two paths are
  // distinct constants in the source, and that --write names the default one.
  const cli = readFileSync(CLI, 'utf8')
  assert.match(cli, /writeFileSync\(DEFAULT_BUDGET_PATH/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('FORCED RED: an entry that cannot be measured is red, never a pass', () => {
  // Zero bytes is under every budget, so a client root that moved would sail
  // through a gate that treated an unreadable entry as an empty graph.
  const result = runCli(['--entry', 'apps/tenant/app/does-not-exist.tsx'])
  assert.equal(result.code, 1)
  assert.match(result.output, /cannot measure/)
  assert.match(result.output, /never a pass/)
})

test('FORCED RED: --write refuses to re-baseline from another entry', () => {
  // `budgetFor` stamps TENANT_PAGE_ENTRY whatever was measured, so without the
  // refusal this pins the published page's budget to a different page's
  // weight — measured, by deleting the refusal: the file came back reading
  // 4,737,856 B across 446 modules, the SEARCH page, under the catch-all's
  // name. That is a budget with four times the headroom nobody chose.
  //
  // The file is restored before the assertions rather than after, so a red
  // here reports a red instead of also leaving the repo's baseline rewritten.
  const path = join(REPO_ROOT, 'tools', 'tenant-page-budget.json')
  const before = readFileSync(path, 'utf8')
  const result = runCli([
    '--entry',
    'apps/tenant/app/[host]/search/page.tsx',
    '--write',
  ])
  const after = readFileSync(path, 'utf8')
  if (after !== before) writeFileSync(path, before)
  assert.equal(after, before, 'the checked-in budget is untouched')
  assert.equal(result.code, 1)
  assert.match(result.output, /refusing to re-baseline/)
})

test('POSITIVE CONTROL: --entry pointed at the real root behaves as default', () => {
  const withFlag = runCli(['--entry', TENANT_PAGE_ENTRY])
  const without = runCli([])
  assert.equal(withFlag.code, 0)
  assert.equal(withFlag.output, without.output)
})
