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
 * The console side of `writeGuardedBySeed` (AGL-1356, AGL-1358).
 *
 * The guard's own behaviour is proven where it lives, next to the listener
 * hooks whose `fromCache` it consumes — see
 * `libs/tenant/feature/instance/src/lib/hooks/helpers/guarded-seed-write.spec.ts`.
 * It had to move there because most of the sites wearing the stale-seed shape
 * are plugin cards that cannot import from this app.
 *
 * What is left here is the WIRING, which is the half that was actually broken.
 * A guard that behaves correctly in isolation and is not reached by the write
 * it protects is the exact fault AGL-1356 was filed for — that page already
 * had two such guards. Source-level assertions, deliberately: importing the
 * page or the Firebase layout would drag in the whole client Firebase stack to
 * prove something about a call graph.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Manage Account is wired to the guard (AGL-1356)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app', '(app)', 'manage', 'user', 'page.tsx'),
    'utf8',
  )

  it('reads fromCache off the listener AND feeds it to the guard', () => {
    // Twice, not once: declared in the `useFirestoreDoc` destructure and
    // consumed in the guard's options. One occurrence means it is being
    // read and dropped, which is how the old guards came to be decorative.
    const occurrences = source.split('fromCache: profileFromCache').length - 1
    expect(occurrences).toBe(2)
  })

  it('puts the profile setDoc INSIDE the guarded callback', () => {
    const guardAt = source.indexOf('writeGuardedBySeed(')
    const writeAt = source.indexOf('...fields,')
    const guardEndAt = source.indexOf('if (!verdict.ok)')

    expect(guardAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(-1)
    expect(guardEndAt).toBeGreaterThan(-1)
    // Opened before the write, and still open after it: the write cannot be
    // reached without going through the verdict.
    expect(guardAt).toBeLessThan(writeAt)
    expect(writeAt).toBeLessThan(guardEndAt)
  })

  it('reports the refusal to the user instead of failing silently', () => {
    expect(source).toEqual(
      expect.stringContaining('enqueueSnackbar(verdict.message'),
    )
  })
})

/**
 * The seam that hands the console's `session-health` verdict to a guard that
 * lives in the library (AGL-1358).
 *
 * This is the ONLY place that signal can enter. Drop the registration and the
 * guard keeps compiling, keeps passing its own tests, and silently loses its
 * third signal at every call site in the workspace — the same way the guards
 * AGL-1356 replaced were lost.
 */
describe('the console registers its stale-session verdict (AGL-1358)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'components', 'layouts', 'firebase-app.layout.tsx'),
    'utf8',
  )

  it('registers the session-health verdict with the library guard', () => {
    expect(source).toEqual(
      expect.stringContaining('setStaleSessionCheck(() => getSessionHealth()'),
    )
  })

  it('registers at module scope, not inside a component or effect', () => {
    // A save can be clicked before any effect has run. `useEffect(` must not
    // appear before the registration.
    const registerAt = source.indexOf('setStaleSessionCheck(')
    const firstComponentAt = source.indexOf('function ')
    expect(registerAt).toBeGreaterThan(-1)
    expect(registerAt).toBeLessThan(firstComponentAt)
  })
})
