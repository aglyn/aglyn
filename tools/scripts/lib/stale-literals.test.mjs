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
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  changedLiterals,
  editDistance,
  findStaleLiteralSpecs,
  literalsOf,
  specFindings,
} from './stale-literals.mjs'

describe('literalsOf', () => {
  it('reads quoted copy and JSX text', () => {
    assert.deepEqual(literalsOf("title={'This workspace holds no licences'}"), ['This workspace holds no licences'])
    assert.deepEqual(literalsOf('<Tab>Licences</Tab>'), ['Licences'])
  })

  it('keeps one capitalized word as copy', () => {
    assert.deepEqual(literalsOf("label: 'Licences',"), ['Licences'])
  })

  it('skips import paths, identifiers and templates', () => {
    assert.deepEqual(literalsOf("import x from '@aglyn/aglyn/server'"), [])
    assert.deepEqual(literalsOf("const key = 'consoleApi'"), [])
    assert.deepEqual(literalsOf("const name = 'OrgLicencesPanel'"), [])
    assert.deepEqual(literalsOf("const cap = 'MAX_RETRIES'"), [])
    assert.deepEqual(literalsOf('const t = `Hello ${name} there`'), [])
  })
})

describe('editDistance', () => {
  it('counts one substitution', () => assert.equal(editDistance('Licences', 'Licenses'), 1))
  it('gives up once the lengths alone exceed the limit', () => assert.equal(editDistance('a', 'abcdef'), Infinity))
})

describe('changedLiterals', () => {
  const diff = [
    'diff --git a/apps/console/panel.tsx b/apps/console/panel.tsx',
    '@@ -10 +10 @@',
    "-          title={'This workspace holds no licences'}",
    "+          title={'This workspace holds no licenses'}",
    '@@ -40 +40 @@',
    "-    label: 'Loading payments'",
    "+    label: 'Refund issued to the buyer'",
    'diff --git a/apps/console/panel.spec.tsx b/apps/console/panel.spec.tsx',
    '@@ -1 +1 @@',
    "-    expect(screen.getByText('Old copy here')).toBeTruthy()",
    "+    expect(screen.getByText('Old copy hers')).toBeTruthy()",
  ].join('\n')

  it('pairs a literal with a near replacement in the same hunk', () => {
    const pairs = changedLiterals(diff)
    assert.deepEqual(pairs.get('This workspace holds no licences'), {
      next: 'This workspace holds no licenses',
      file: 'apps/console/panel.tsx',
    })
  })

  it('does not pair a literal with unrelated new copy', () => {
    assert.equal(changedLiterals(diff).has('Loading payments'), false)
  })

  it('ignores literals changed inside a spec', () => {
    assert.equal(changedLiterals(diff).has('Old copy here'), false)
  })

  it('does not pair a literal across hunks', () => {
    const split = [
      'diff --git a/apps/x.tsx b/apps/x.tsx',
      '@@ -1 +1 @@',
      "-  a('Save changes')",
      '@@ -90 +90 @@',
      "+  b('Save changed')",
    ].join('\n')
    assert.equal(changedLiterals(split).size, 0)
  })
})

describe('specFindings', () => {
  const pairs = new Map([['This workspace holds no licences', { next: 'This workspace holds no licenses', file: 'apps/console/panel.tsx' }]])
  const gone = ['This workspace holds no licences']

  it('reports an assertion of the old copy, in any case', () => {
    const hits = 'abc1234:apps/console/panel.spec.tsx:80:    expect(screen.getByText(/this workspace holds no licences/i)).toBeTruthy()'
    const [finding] = specFindings({ hits, gone, pairs })
    assert.equal(finding.spec, 'apps/console/panel.spec.tsx')
    assert.equal(finding.line, 80)
    assert.equal(finding.now, 'This workspace holds no licenses')
  })

  it('skips a negative assertion and a test title', () => {
    const hits = [
      'apps/console/panel.spec.tsx:93:    expect(screen.queryByText(/this workspace holds no licences/i)).toBeNull()',
      "apps/console/panel.spec.tsx:12:  it('shows This workspace holds no licences when empty', () => {",
    ].join('\n')
    assert.deepEqual(specFindings({ hits, gone, pairs }), [])
  })
})

describe('findStaleLiteralSpecs, against a real repository', () => {
  let dir
  const git = (args, opts = {}) => {
    try {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    } catch (error) {
      if (opts.allowNoMatch && error.status === 1) return ''
      throw error
    }
  }
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (message) => {
    git(['add', '-A'])
    git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message])
    return git(['rev-parse', 'HEAD']).trim()
  }
  const PANEL = (word) => `export const Panel = () => <Empty title={'This workspace holds no ${word}'} />\n`
  const SPEC = "it('renders', () => {\n  expect(screen.getByText(/this workspace holds no licences/i)).toBeTruthy()\n})\n"

  let before1
  let changed
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'stale-literals-test-'))
    git(['init', '-q'])
    write('apps/console/panel.tsx', PANEL('licences'))
    write('apps/console/panel.spec.tsx', SPEC)
    before1 = commit('panel')
    write('apps/console/panel.tsx', PANEL('licenses'))
    changed = commit('american spelling')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('finds the spec still asserting the old copy (the 551bdd32f shape)', () => {
    const findings = findStaleLiteralSpecs({ base: before1, head: changed, git })
    assert.equal(findings.length, 1)
    assert.equal(findings[0].spec, 'apps/console/panel.spec.tsx')
    assert.equal(findings[0].line, 2)
  })

  it('finds nothing once the spec moved with the copy', () => {
    write('apps/console/panel.spec.tsx', SPEC.replace('licences', 'licenses'))
    const fixed = commit('spec follows')
    assert.deepEqual(findStaleLiteralSpecs({ base: before1, head: fixed, git }), [])
  })

  it('finds nothing while the old copy survives in another source file', () => {
    write('apps/console/panel.spec.tsx', SPEC)
    write('apps/console/other.tsx', PANEL('licences'))
    const survives = commit('old copy elsewhere')
    assert.deepEqual(findStaleLiteralSpecs({ base: before1, head: survives, git }), [])
  })
})
