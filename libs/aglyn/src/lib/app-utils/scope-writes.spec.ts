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
 * No save answers an unstorable scope with every site (AGL-2773).
 *
 * `normalizeVisibleTo` returns null for a selection it cannot store: no site
 * picked, or more sites than one `array-contains-any` can match. Writing the
 * org token in its place shares the resource with EVERY site — the opposite of
 * what somebody narrowing a scope asked for, and a write the narrowing
 * confirmation has just told them is safe. `scopeToStore` is how a selection
 * becomes a write; this pins that no call site spells the substitution again.
 *
 * Enumerated from `git ls-files`, like the other corpus guards, so a local
 * build directory cannot change the answer. Specs are out of scope: a fixture
 * may spell the pattern out in order to test it.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

const SOURCE = /\.(ts|tsx)$/
const NOT_A_TEST = /\.spec\.|\.e2e\.|\.test\.|\/specs\//
/** `normalizeVisibleTo(…) ?? [ORG_SCOPE_TOKEN]`, however it is spaced. */
const WIDENING =
  /normalizeVisibleTo\([^)]*\)\s*\?\?\s*\[\s*ORG_SCOPE_TOKEN\s*\]/

describe('scope writes (AGL-2773)', () => {
  it('never substitute the org token for a scope that cannot be stored', () => {
    const files = execFileSync('git', ['ls-files', 'apps', 'libs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((file) => SOURCE.test(file) && !NOT_A_TEST.test(file))
    // A scan that found nothing to read would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(1000)

    const offenders = files.filter((file) => {
      const path = resolve(REPO_ROOT, file)
      return existsSync(path) && WIDENING.test(readFileSync(path, 'utf8'))
    })

    expect(offenders).toEqual([])
  })
})
