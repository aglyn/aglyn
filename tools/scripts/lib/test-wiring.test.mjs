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

// Self-test for the test-wiring guard (AGL-2376, AGL-2377).
//
// The guard's whole subject is checks that cannot fail, so the bar here is
// higher than usual: every one of its six failure shapes gets a red case AND a
// green control, and the two that matter most — a source comment must not
// count as a runner, and `passWithNoTests` must not launder an empty project —
// get a case of their own, because those are the exact shapes that produced
// the false greens this guard was written for.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  UNTESTED_PROJECTS,
  evaluateTestWiring,
  formatFailure,
  hasRunner,
} from './test-wiring.mjs'

/** A minimal, all-green world the individual cases perturb one field at a time. */
const green = () => ({
  standaloneTestFiles: ['cloud/rules-tenant.spec.mjs'],
  runnerText:
    '{"test:rules":"bash tools/scripts/test-rules.sh"}\nnode --test rules-tenant.spec.mjs\n',
  projects: [
    {
      project: 'console',
      dir: 'apps/console',
      hasTestTarget: true,
      testFileCount: 40,
      passWithNoTests: false,
    },
    {
      project: 'shared-util-dom',
      dir: 'libs/shared/util/dom',
      hasTestTarget: false,
      testFileCount: 0,
      passWithNoTests: false,
    },
  ],
  untested: [
    {
      project: 'shared-util-dom',
      dir: 'libs/shared/util/dom',
      why: 'never had a spec',
    },
  ],
})

describe('evaluateTestWiring — the green control', () => {
  it('passes when every file has a runner and every target has tests', () => {
    const result = evaluateTestWiring(green())
    assert.equal(result.ok, true, formatFailure(result))
    assert.deepEqual(result.orphanFiles, [])
    assert.deepEqual(result.emptyTargets, [])
  })
})

describe('a test file no runner executes', () => {
  it('is named — this is the five cloud/*.spec.mjs shape (AGL-2376)', () => {
    const world = green()
    world.standaloneTestFiles = [
      'cloud/rules-tenant.spec.mjs',
      'cloud/rules-org-billing.spec.mjs',
      'tools/scripts/backfills/lib/backfill-core.test.mjs',
    ]
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.orphanFiles, [
      'cloud/rules-org-billing.spec.mjs',
      'tools/scripts/backfills/lib/backfill-core.test.mjs',
    ])
    assert.match(formatFailure(result, world.untested), /NO runner executes/)
    assert.match(
      formatFailure(result, world.untested),
      /backfill-core\.test\.mjs/,
    )
  })

  it('a SOURCE COMMENT naming the spec does not count as a runner', () => {
    // The exact false green that hid cloud/hosts-list-constraint.spec.mjs: a
    // comment in dataset-schema-dialog.component.tsx cited it as if it were a
    // live guard. runnerText is built from scripts and workflows only, so the
    // comment is not in scope — this pins that the CLI's input choice is what
    // makes the check mean anything.
    const comment =
      '// see cloud/hosts-list-constraint.spec.mjs for the constraint this relies on'
    assert.equal(
      hasRunner(comment, 'cloud/hosts-list-constraint.spec.mjs'),
      true,
    )
    const world = green()
    world.standaloneTestFiles = ['cloud/hosts-list-constraint.spec.mjs']
    world.runnerText = '{"test:rules":"bash tools/scripts/test-rules.sh"}'
    const result = evaluateTestWiring(world)
    assert.deepEqual(result.orphanFiles, [
      'cloud/hosts-list-constraint.spec.mjs',
    ])
  })

  it('accepts the basename spelling test-rules.sh actually uses', () => {
    // The runner cd's into cloud/ and names its suites relatively; insisting
    // on the full repo-relative path would reject the spelling that works.
    assert.equal(
      hasRunner(
        'node --test rules-tests/firestore-rules.test.mjs',
        'cloud/rules-tests/firestore-rules.test.mjs',
      ),
      true,
    )
  })
})

describe('a `test` target with nothing to run', () => {
  it('is named — this is the five empty nx projects shape (AGL-2377)', () => {
    const world = green()
    world.projects.push({
      project: 'shared-ui-next',
      dir: 'libs/shared/ui/next',
      hasTestTarget: true,
      testFileCount: 0,
      passWithNoTests: false,
    })
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.emptyTargets, ['shared-ui-next'])
    assert.match(formatFailure(result, world.untested), /No tests found/)
  })

  it('`passWithNoTests` does NOT launder it green', () => {
    // The one-line "fix" this guard exists to refuse. Setting the flag must
    // make the verdict worse, not better.
    const world = green()
    world.projects.push({
      project: 'shared-ui-next',
      dir: 'libs/shared/ui/next',
      hasTestTarget: true,
      testFileCount: 0,
      passWithNoTests: true,
    })
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.emptyTargets, ['shared-ui-next'])
    assert.deepEqual(result.passWithNoTests, ['shared-ui-next'])
    assert.match(formatFailure(result, world.untested), /report GREEN/)
  })

  it('the flag is refused even on a project that DOES have tests', () => {
    // libs/besigner/core carried it with seven live specs, where it does
    // nothing at all — until the day the seventh is deleted and the target
    // goes on reporting green. A dormant lie is still a lie.
    const world = green()
    world.projects[0].passWithNoTests = true
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.passWithNoTests, ['console'])
    assert.deepEqual(result.emptyTargets, [])
  })
})

describe('the exemption list cannot rot in either direction', () => {
  it('a spec written into an exempt project goes RED — nothing would run it', () => {
    const world = green()
    world.projects[1].testFileCount = 1
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.resurrected, ['shared-util-dom'])
    assert.match(formatFailure(result, world.untested), /Restore the target/)
  })

  it('an exemption whose project got its target back is stale', () => {
    const world = green()
    world.projects[1].hasTestTarget = true
    world.projects[1].testFileCount = 3
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.staleExemptions, ['shared-util-dom'])
    // ...and it is ALSO reported as resurrected, which is correct: both facts
    // are true and each has its own remedy line.
    assert.deepEqual(result.resurrected, ['shared-util-dom'])
  })

  it('an exemption naming a project that no longer exists is dead', () => {
    const world = green()
    world.projects = [world.projects[0]]
    const result = evaluateTestWiring(world)
    assert.equal(result.ok, false)
    assert.deepEqual(result.deadExemptions, ['shared-util-dom'])
    assert.match(formatFailure(result, world.untested), /does not exist/)
  })
})

describe('the shipped exemption list', () => {
  // The number is the point. It is not a fact about the list — it is a
  // TRIPWIRE, so that shrinking or growing the exemption set is an edit
  // someone made on purpose rather than a line that slid in with unrelated
  // work. `099964c57` removed `shared-util-dom` (it got tests, which is the
  // good direction) and left this at five, so `Main Gate` ran red on `main`
  // for every scheduled sweep until AGL-2486. Moving the number IS the
  // review; do not replace it with `UNTESTED_PROJECTS.length`.
  it('names four projects, each with a reason', () => {
    assert.equal(UNTESTED_PROJECTS.length, 4)
    for (const entry of UNTESTED_PROJECTS) {
      assert.ok(entry.project, 'every entry needs a project name')
      assert.ok(entry.dir.startsWith('libs/'), `${entry.project} needs a dir`)
      assert.ok(
        entry.why && entry.why.length > 20,
        `${entry.project} needs a real reason, not a placeholder`,
      )
    }
  })

  it('has no duplicate entries', () => {
    const names = UNTESTED_PROJECTS.map((e) => e.project)
    assert.equal(new Set(names).size, names.length)
  })
})

describe("the CLI's enumeration reaches BOTH depths", () => {
  // Not a pure-function test, because the bug was not in a pure function: the
  // first version of check-test-wiring.mjs globbed only `cloud/**/*.spec.mjs`
  // and reported GREEN over all five orphans AGL-2376 was filed about.
  //
  // git's `**` pathspec requires at least one intervening directory, so that
  // pattern matches `cloud/rules-tests/firestore-rules.test.mjs` and does NOT
  // match `cloud/rules-tenant.spec.mjs` — where every one of the five lives. A
  // guard that cannot see the files it was written for is the exact
  // manufactured confidence this whole exercise is about, so the fix is pinned
  // here rather than left to be re-derived.
  const cli = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'check-test-wiring.mjs',
    ),
    'utf8',
  )

  for (const pattern of [
    "'cloud/*.spec.mjs'",
    "'cloud/**/*.spec.mjs'",
    "'cloud/*.test.mjs'",
    "'cloud/**/*.test.mjs'",
    "'tools/*.test.mjs'",
    "'tools/**/*.test.mjs'",
  ]) {
    it(`globs ${pattern}`, () => {
      assert.ok(
        cli.includes(pattern),
        `check-test-wiring.mjs must enumerate ${pattern} — dropping the ` +
          `top-level form silently hides every spec that sits directly in ` +
          `cloud/, which is all five of them`,
      )
    })
  }
})
