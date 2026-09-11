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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CHECKS,
  addedLinesOf,
  checksFor,
  citationsAboveCeiling,
  commitsOf,
  parsePushedRefs,
} from './prepush.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const names = (checks) => checks.map((check) => check.name)

describe('parsePushedRefs', () => {
  it('reads one ref per line', () => {
    const refs = parsePushedRefs('refs/heads/main aaaa1111 refs/heads/main bbbb2222\n')
    assert.deepEqual(refs, [
      { localRef: 'refs/heads/main', localSha: 'aaaa1111', remoteRef: 'refs/heads/main', remoteSha: 'bbbb2222' },
    ])
  })

  it('gives a new remote branch no remote sha', () => {
    const [ref] = parsePushedRefs(`refs/heads/x aaaa1111 refs/heads/x ${'0'.repeat(40)}`)
    assert.equal(ref.remoteSha, null)
  })

  it('drops a delete, which pushes no content', () => {
    assert.deepEqual(parsePushedRefs(`(delete) ${'0'.repeat(40)} refs/heads/x bbbb2222`), [])
  })

  it('reads nothing from empty stdin', () => {
    assert.deepEqual(parsePushedRefs(''), [])
  })
})

describe('checksFor', () => {
  it('scopes the file-content guards to shipped source, and leaves specs out of the ratchets', () => {
    const [brand] = checksFor(['apps/console/components/panel.tsx', 'apps/console/components/panel.spec.tsx']).filter(
      (check) => check.name === 'check:brand-literals',
    )
    assert.deepEqual(brand.paths, ['apps/console/components/panel.tsx'])
  })

  it('runs check:test-wiring when a spec lands in a project (the 142ce97da shape)', () => {
    assert.ok(names(checksFor(['libs/shared/ui/next/src/lib/components/hub-tabs.spec.tsx'])).includes('check:test-wiring'))
    assert.ok(names(checksFor(['libs/shared/ui/next/project.json'])).includes('check:test-wiring'))
  })

  it('runs the tsconfig sync check when a path alias moves (the e2e7b2469 shape)', () => {
    assert.ok(names(checksFor(['tsconfig.base.json'])).includes('sync:next-tsconfigs:check'))
  })

  it('runs the page-view rate when a lib the tenant page reaches moves (the 2c7618a2d shape)', () => {
    assert.ok(names(checksFor(['libs/shared/ui/theme/src/lib/tenant.theme.ts'])).includes('check:page-view-rate'))
  })

  it('reads a docs-only push with the address and identifier guards alone', () => {
    assert.deepEqual(names(checksFor(['docs/RELEASING.md'])), ['check:contact-addresses', 'check:personal-identifiers'])
  })

  it('names a script that exists for every check', () => {
    for (const check of CHECKS) assert.ok(existsSync(join(repoRoot, check.script)), check.script)
  })
})

describe('addedLinesOf', () => {
  it('numbers added lines from each hunk header', () => {
    const diff = [
      'diff --git a/apps/a.ts b/apps/a.ts',
      '--- a/apps/a.ts',
      '+++ b/apps/a.ts',
      '@@ -3,0 +4,2 @@',
      '+// AGL-9001',
      '+const x = 1',
      '@@ -10 +12 @@',
      '-old',
      '+new',
    ].join('\n')
    assert.deepEqual(addedLinesOf(diff), [
      { path: 'apps/a.ts', line: 4, text: '// AGL-9001' },
      { path: 'apps/a.ts', line: 5, text: 'const x = 1' },
      { path: 'apps/a.ts', line: 12, text: 'new' },
    ])
  })

  it('ignores a deleted file', () => {
    assert.deepEqual(addedLinesOf('--- a/apps/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x'), [])
  })
})

describe('commitsOf', () => {
  it('splits git log records', () => {
    const log = 'abc123\x1ffix(x): one (AGL-1)\n\nbody\x1e\ndef456\x1ffeat(y): two\x1e'
    assert.deepEqual(commitsOf(log), [
      { sha: 'abc123', message: 'fix(x): one (AGL-1)\n\nbody' },
      { sha: 'def456', message: 'feat(y): two' },
    ])
  })
})

describe('citationsAboveCeiling', () => {
  it('finds an id above the ceiling in a commit message (the 537918a89 shape)', () => {
    const [one] = citationsAboveCeiling({
      commits: [{ sha: '537918a89abc', message: 'ci(main-gate): run the full sweep in parallel (AGL-2721)' }],
      addedLines: [],
      ceiling: 2720,
    })
    assert.equal(one.id, 'AGL-2721')
    assert.deepEqual(one.where, ['commit 537918a89'])
  })

  it('finds one in an added line, and collects every place it appears', () => {
    const [one] = citationsAboveCeiling({
      commits: [{ sha: 'aaaaaaaaa', message: 'fix: x (AGL-2900)' }],
      addedLines: [{ path: 'apps/a.ts', line: 3, text: '// AGL-2900' }],
      ceiling: 2842,
    })
    assert.deepEqual(one.where, ['commit aaaaaaaaa', 'apps/a.ts:3'])
  })

  it('ignores ids at or below the ceiling', () => {
    assert.deepEqual(
      citationsAboveCeiling({ commits: [{ sha: 'a', message: 'x (AGL-2842)' }], addedLines: [], ceiling: 2842 }),
      [],
    )
  })

  it('honors the forgiven commits and the files that write about ids', () => {
    assert.deepEqual(
      citationsAboveCeiling({
        commits: [{ sha: '327f8a2c5aaaa', message: 'x (AGL-9999)' }],
        addedLines: [{ path: 'tools/scripts/lib/linear-ids.test.mjs', line: 1, text: 'AGL-9999' }],
        ceiling: 2842,
        forgiven: ['327f8a2c5'],
      }),
      [],
    )
  })
})

describe('prepush.mjs and its hook', () => {
  it('checks nothing for an empty range', () => {
    const out = execFileSync(process.execPath, [join(repoRoot, 'tools', 'scripts', 'prepush.mjs'), '--base', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.match(out, /change no files|nothing new to check/)
  })

  it('.husky/pre-push runs it', () => {
    assert.match(readFileSync(join(repoRoot, '.husky', 'pre-push'), 'utf8'), /^node tools\/scripts\/prepush\.mjs$/m)
  })
})
