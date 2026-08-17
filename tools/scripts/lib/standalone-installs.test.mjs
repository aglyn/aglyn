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
 * Pins the standalone-install guard (AGL-1781).
 *
 *   node --test tools/scripts/lib/standalone-installs.test.mjs
 *
 * The dangerous failure mode for THIS guard is passing: it exists to notice a
 * third standalone package landing with no install step, and a matcher that
 * accepts a bare root `npm ci` would report every future package as covered.
 * Every case below is written from that direction.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  evaluateStandaloneInstalls,
  formatFailure,
  hasInstallStep,
} from './standalone-installs.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const WORKFLOW_SHAPE = `
      - run: npm ci

      - run: npm ci --prefix cloud/functions

      - run: npm ci --prefix apps/docs
`

describe('the install matcher', () => {
  it('accepts a --prefix install for the dir', () => {
    assert.equal(hasInstallStep(WORKFLOW_SHAPE, 'apps/docs'), true)
    assert.equal(hasInstallStep(WORKFLOW_SHAPE, 'cloud/functions'), true)
  })

  it('does NOT accept a bare root npm ci', () => {
    // The whole defect: a root install reaches no nested package, and a
    // matcher that counted it would pass forever while CI stayed broken.
    assert.equal(hasInstallStep('      - run: npm ci\n', 'apps/docs'), false)
  })

  it('does not let one package vouch for another', () => {
    const onlyFunctions = '      - run: npm ci --prefix cloud/functions\n'
    assert.equal(hasInstallStep(onlyFunctions, 'apps/docs'), false)
  })

  it('is not fooled by the dir name merely appearing in prose', () => {
    const commentOnly = `
      # apps/docs is a separate npm package, see AGL-1781
      - run: npm ci
`
    assert.equal(hasInstallStep(commentOnly, 'apps/docs'), false)
  })

  it('accepts the working-directory spelling, which installs just as well', () => {
    const scoped = `
      - working-directory: apps/docs
        run: npm ci
`
    assert.equal(hasInstallStep(scoped, 'apps/docs'), true)
  })

  it('accepts npm install as well as npm ci, and a quoted or ./-prefixed dir', () => {
    assert.equal(
      hasInstallStep('- run: npm install --prefix ./apps/docs\n', 'apps/docs'),
      true,
    )
    assert.equal(
      hasInstallStep(`- run: npm ci --prefix 'apps/docs'\n`, 'apps/docs'),
      true,
    )
  })
})

describe('the verdict', () => {
  it('is ok when every standalone package has a step', () => {
    const result = evaluateStandaloneInstalls({
      packageDirs: ['apps/docs', 'cloud/functions'],
      workflow: WORKFLOW_SHAPE,
      rootWorkspaces: undefined,
    })
    assert.deepEqual(result, {
      ok: true,
      missing: [],
      unexpectedWorkspaces: false,
    })
  })

  it('names the package a future commit forgets', () => {
    const result = evaluateStandaloneInstalls({
      packageDirs: ['apps/docs', 'cloud/functions', 'tools/some-new-thing'],
      workflow: WORKFLOW_SHAPE,
      rootWorkspaces: undefined,
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing, ['tools/some-new-thing'])
    const message = formatFailure(result, '.github/workflows/nx-ci.yml')
    assert.match(message, /tools\/some-new-thing/)
    // The message must carry the fix, or it gets worked around instead.
    assert.match(message, /npm ci --prefix tools\/some-new-thing/)
  })

  it('refuses to pass once the root declares workspaces — its premise expired', () => {
    const result = evaluateStandaloneInstalls({
      packageDirs: ['apps/docs', 'cloud/functions'],
      workflow: WORKFLOW_SHAPE,
      rootWorkspaces: ['apps/*'],
    })
    assert.equal(result.ok, false)
    assert.equal(result.unexpectedWorkspaces, true)
    assert.match(formatFailure(result, 'w.yml'), /workspaces/)
  })
})

describe('the guard is wired, and reads the real tree', () => {
  it('finds exactly the standalone packages that exist today', () => {
    // Asserted against git rather than a fixture: if a third one lands, this
    // is the line that has to be looked at, deliberately.
    const dirs = execFileSync('git', ['ls-files', '*/package-lock.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/\/package-lock\.json$/, ''))
      .filter((d) => !d.split('/').includes('node_modules'))
      .sort()
    assert.deepEqual(dirs, ['apps/docs', 'cloud/functions'])
  })

  it('the root package.json still has no workspaces key', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    assert.equal(pkg.workspaces, undefined)
    assert.equal(
      pkg.scripts['check:standalone-installs'],
      'node tools/scripts/check-standalone-installs.mjs',
    )
    assert.match(
      pkg.scripts['test:standalone-installs'],
      /standalone-installs\.test\.mjs/,
    )
  })

  it('nx-ci.yml installs BOTH standalone packages, and this guard runs there', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'nx-ci.yml'),
      'utf8',
    )
    assert.equal(hasInstallStep(workflow, 'cloud/functions'), true)
    assert.equal(hasInstallStep(workflow, 'apps/docs'), true)
    assert.match(workflow, /npm run check:standalone-installs/)
    assert.match(workflow, /npm run test:standalone-installs/)
  })
})
