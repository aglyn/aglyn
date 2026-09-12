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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FILES_FROM, inScope, scopeBaseline, scopeFromArgv, scopeNote } from './guard-scope.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('scopeFromArgv', () => {
  it('is null without the flag, so a guard sweeps everything', () => {
    assert.equal(scopeFromArgv(['--json']), null)
  })

  it('reads one repo-relative path per line', () => {
    const scope = scopeFromArgv([FILES_FROM, 'list.txt'], () => 'apps/a.ts\n ./libs/b.ts \n\n')
    assert.deepEqual([...scope], ['apps/a.ts', 'libs/b.ts'])
  })

  it('refuses the flag without a path, rather than sweeping all or nothing', () => {
    assert.throws(() => scopeFromArgv([FILES_FROM]), /needs the path/)
    assert.throws(() => scopeFromArgv([FILES_FROM, '--json']), /needs the path/)
  })
})

describe('inScope, scopeBaseline and scopeNote', () => {
  const scope = new Set(['apps/a.ts'])

  it('lets everything through without a scope', () => {
    assert.equal(inScope(null, 'anything'), true)
    assert.equal(inScope(scope, 'apps/b.ts'), false)
  })

  it('keeps only the baseline rows a scoped run swept, so an unswept row is never stale', () => {
    assert.deepEqual(scopeBaseline({ 'apps/a.ts': 2, 'apps/b.ts': 1 }, scope), { 'apps/a.ts': 2 })
    const full = { 'apps/b.ts': 1 }
    assert.equal(scopeBaseline(full, null), full)
  })

  it('names a scoped run as not the full sweep', () => {
    assert.match(scopeNote(scope), /SCOPED to 1 named file\(s\); this is not the full sweep/)
    assert.equal(scopeNote(null), '')
  })
})

describe('the file-content guards honor --files-from', () => {
  let dir
  let list
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'guard-scope-'))
    list = join(dir, 'scope.txt')
    writeFileSync(list, 'tools/scripts/lib/guard-scope.mjs\n')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  const run = (script, args) => {
    try {
      const out = execFileSync(process.execPath, [join(repoRoot, 'tools', 'scripts', script), ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { code: 0, out }
    } catch (error) {
      return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  const GUARDS = [
    'check-brand-literals.mjs',
    'check-hardcoded-colours.mjs',
    'check-contact-addresses.mjs',
    'check-personal-identifiers.mjs',
    'check-next-public-access.mjs',
  ]

  for (const script of GUARDS) {
    it(`${script} sweeps only the named files, says so, and does not fail its corpus-size premise`, () => {
      const { code, out } = run(script, [FILES_FROM, list])
      assert.equal(code, 0, out)
      assert.match(out, /SCOPED to 1 named file\(s\)/)
    })

    it(`${script} refuses ${FILES_FROM} without a path`, () => {
      assert.equal(run(script, [FILES_FROM]).code, 2)
    })
  }

  for (const script of ['check-brand-literals.mjs', 'check-hardcoded-colours.mjs']) {
    it(`${script} refuses to write a baseline from a scoped sweep`, () => {
      const { code, out } = run(script, ['--write', FILES_FROM, list])
      assert.equal(code, 2)
      assert.match(out, /--write refuses a --files-from scope/)
    })
  }
})
