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
 * AGL-1881 — nothing enumerates the Firebase Auth user database without staff.
 *
 * ## Why this file exists at all
 *
 * SEC-C1 (AGL-491) was the July audit's only CRITICAL: `GET /api/user` on the
 * PUBLIC tenant app was gated solely by `appCsrfCheck`, which returns ok for
 * every GET, and called `auth().listUsers(1000).toJSON()` — and the Admin SDK's
 * `UserRecord` carries `passwordHash` and `passwordSalt`. It was fixed by
 * DELETING the route and its helper, which is the right fix and leaves nothing
 * behind to notice if it ever comes back.
 *
 * Re-verifying that finding for the pre-launch review is what showed the gap:
 * the closure rested entirely on two files being absent, across ~170 commits
 * of drift, with no assertion anywhere in the repo. An absence nothing checks
 * is not a control.
 *
 * ## What is actually asserted
 *
 * Not "the old file is still deleted" on its own — that is a fact about one
 * path and would pass while an equivalent route appeared next to it. The real
 * invariant is the one the fix established: **the Admin SDK's user-listing
 * helpers are reachable only from a staff-gated console route, and never from
 * the tenant app at all.** The tenant app is the public surface; that is the
 * whole distinction SEC-C1 turned on.
 *
 * The universe is derived by walking the route trees rather than listed, so a
 * new route is in scope the day it is written.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const CONSOLE_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(CONSOLE_ROOT, '..', '..')
const TENANT_ROOT = join(REPO_ROOT, 'apps', 'tenant')

/**
 * The Admin-SDK calls that return other people's accounts in bulk. `listUsers`
 * is the raw SDK call; `listUsersAcrossPools` is this repo's cross-pool
 * wrapper and the one real callers use.
 */
const ENUMERATION_CALLS = /\b(listUsersAcrossPools|auth\(\)\s*\.\s*listUsers)\s*\(/

/** Walk every `route.ts` under an app's `app/` tree. */
function* routeFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* routeFiles(path)
    else if (entry === 'route.ts') yield path
  }
}

const consoleRoutes = [...routeFiles(join(CONSOLE_ROOT, 'app'))]
const tenantRoutes = [...routeFiles(join(TENANT_ROOT, 'app'))]

describe('the sweep sees the route trees at all', () => {
  /**
   * Without these, every assertion below is green over an empty list — the
   * failure mode of every source-scanning check, and the reason a moved route
   * folder must fail here rather than reporting a perfect world.
   */
  it('finds a substantial number of console routes', () => {
    expect(consoleRoutes.length).toBeGreaterThan(100)
  })

  it('finds the tenant routes', () => {
    expect(tenantRoutes.length).toBeGreaterThan(10)
  })

  it('finds the one route that is SUPPOSED to enumerate users', () => {
    // If this stops matching, the regex has rotted and the whole file is
    // asserting nothing. Pinned to the real staff route, not to a fixture.
    const enumerating = consoleRoutes.filter((path) =>
      ENUMERATION_CALLS.test(code(path)),
    )
    expect(enumerating.map((p) => relative(CONSOLE_ROOT, p))).toContain(
      join('app', 'api', 'admin', 'users', 'route.ts'),
    )
  })
})

describe('the public tenant app cannot enumerate the user database', () => {
  it('has no route that lists users at all', () => {
    // SEC-C1's actual shape: the enumeration lived on the PUBLIC app, where
    // there is no staff concept to gate it with.
    const offenders = tenantRoutes
      .filter((path) => ENUMERATION_CALLS.test(code(path)))
      .map((path) => relative(TENANT_ROOT, path))
    expect(offenders).toEqual([])
  })

  it('has no `api/user` route, the deleted SEC-C1 surface', () => {
    // Kept alongside the general assertion rather than instead of it: this
    // one names the thing that actually shipped, so a reviewer reading a
    // failure knows immediately which finding reopened.
    const reappeared = tenantRoutes
      .map((path) => relative(TENANT_ROOT, path))
      .filter((path) => /^app[\\/]api[\\/]user[\\/]route\.ts$/.test(path))
    expect(reappeared).toEqual([])
  })

  it('does not carry the deleted `getAllUsers` helper', () => {
    const helper = join(TENANT_ROOT, 'utils', 'get-all-users.ts')
    expect(() => statSync(helper)).toThrow()
  })
})

/**
 * Comments stripped before anything is matched.
 *
 * Not defensive tidiness — measured. The first version of the staff assertion
 * below was `/\bstaff\b/` over the raw source, and a probe route written to
 * FAIL it passed, because the comment saying "with no staff check" contained
 * the word. A guard that a comment can satisfy is the thing this whole review
 * was told to hunt for, and it turned up inside the guard itself.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/**
 * A real read of the staff claim off a verified token — `decoded['staff']`,
 * `decoded.staff`, `token.staff`, or a `staffRole` comparison. Matching the
 * bare word is not enough, per the note above.
 */
const STAFF_CLAIM_READ =
  /\b(decoded|token|claims)\s*(\[\s*['"]staff(Role)?['"]\s*\]|\.\s*staff(Role)?\b)/

describe('every console route that enumerates users is staff-gated', () => {
  it.each(
    consoleRoutes
      .filter((path) => ENUMERATION_CALLS.test(code(path)))
      .map((path) => [relative(CONSOLE_ROOT, path), path]),
  )('%s verifies an ID token and reads the staff claim', (_label, path) => {
    const source = code(path)
    // Both halves. A route that verifies a token without checking `staff`
    // hands the user database to any signed-in customer, which is SEC-C1
    // again with one extra step.
    expect(source).toMatch(/verifyIdToken\(/)
    expect(source).toMatch(STAFF_CLAIM_READ)
  })
})
