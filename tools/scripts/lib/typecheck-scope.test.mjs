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
 * The widening decision, pinned in both directions — a rule that only ever
 * says yes is the same as no rule.
 *
 *   npm run test:typecheck-scope
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { barrelEntryPoints, barrelsAmong } from './typecheck-scope.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const FIXTURE = {
  compilerOptions: {
    paths: {
      '@aglyn/shared-util-vendor': ['./libs/shared/util/vendor/src/index.ts'],
      '@aglyn/shared-util-vendor/*': ['./libs/shared/util/vendor/src/lib/*'],
      '@aglyn/aglyn': ['./libs/aglyn/src/index.ts'],
    },
  },
}

describe('barrelEntryPoints', () => {
  it('takes the exact mappings and drops the leading ./', () => {
    assert.deepEqual(barrelEntryPoints(FIXTURE), [
      'libs/aglyn/src/index.ts',
      'libs/shared/util/vendor/src/index.ts',
    ])
  })

  it('skips wildcard mappings — a deep import is a normal file dependency', () => {
    assert.ok(
      !barrelEntryPoints(FIXTURE).some((one) => one.includes('/src/lib')),
      'the subpath escape hatch must not widen the scope',
    )
  })

  it('degrades to no barrels rather than throwing on junk', () => {
    for (const junk of [undefined, null, {}, { compilerOptions: {} }, { compilerOptions: { paths: 'no' } }])
      assert.deepEqual(barrelEntryPoints(junk), [])
  })

  it('ignores a non-string or wildcard target', () => {
    assert.deepEqual(
      barrelEntryPoints({
        compilerOptions: { paths: { '@x/y': [42, './libs/x/src/*'], '@x/z': './not-an-array' } },
      }),
      [],
    )
  })
})

describe('barrelsAmong', () => {
  const barrels = barrelEntryPoints(FIXTURE)

  it('names the barrel that widened the run', () => {
    assert.deepEqual(
      barrelsAmong(
        ['apps/console/components/media/media-library.component.tsx', 'libs/shared/util/vendor/src/index.ts'],
        barrels,
      ),
      ['libs/shared/util/vendor/src/index.ts'],
    )
  })

  it('does NOT widen for an ordinary file — the whole point of --changed', () => {
    assert.deepEqual(
      barrelsAmong(['libs/shared/util/vendor/src/lib/deep-equal.ts', 'apps/console/x.tsx'], barrels),
      [],
    )
  })

  it('does not widen for an index.ts that no mapping names', () => {
    assert.deepEqual(barrelsAmong(['apps/console/components/index.ts'], barrels), [])
  })

  it('matches a ./-prefixed changed path', () => {
    assert.deepEqual(barrelsAmong(['./libs/aglyn/src/index.ts'], barrels), [
      './libs/aglyn/src/index.ts',
    ])
  })
})

describe('against the real tsconfig.base.json', () => {
  const real = barrelEntryPoints(
    JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.base.json'), 'utf8')),
  )

  it('finds the workspace barrels at all', () => {
    // A derivation that comes back empty would silently restore the old
    // behaviour, which is the failure mode this whole file guards.
    assert.ok(real.length > 20, `expected many barrels, found ${real.length}`)
  })

  it('includes the two this rule was written for', () => {
    assert.ok(real.includes('libs/shared/util/vendor/src/index.ts'))
    assert.ok(real.includes('libs/shared/ui/jsx/src/index.ts'))
  })

  it('is entry points only — never a directory of modules', () => {
    assert.ok(real.every((one) => one.endsWith('.ts') || one.endsWith('.tsx')))
  })
})
