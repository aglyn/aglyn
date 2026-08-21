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

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * Nothing verifies an ID token outside the revocation check (AGL-1881).
 *
 * The audit finding was not "someone forgot a flag on one route" — it was
 * `checkRevoked` set on 3 of 175 verifications, which is where a per-call-site
 * opt-in always ends up. The fix put the check inside
 * `firebaseAdmin.app().auth()`, so every door in the repo inherits it by
 * reaching auth the way every door already reached it.
 *
 * That is a property of how the handle is OBTAINED, and it is one import away
 * from being silently untrue: `getAuth(getApp())` returns the SDK's own Auth,
 * with no check on it, and a route written that way would look completely
 * ordinary in review. So the property is asserted here rather than trusted.
 *
 * `token-revocation.spec.ts` proves the check refuses a revoked token. This
 * proves nothing routes around it — the two halves of "verify a security
 * control is WIRED", and the half that a green suite is most likely to be
 * missing.
 */
const REPO_ROOT = resolve(__dirname, '../../..')
const SCAN_ROOTS = ['apps', 'libs', 'cloud']

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.nx',
  '.turbo',
])

/**
 * The one file allowed to hold a raw SDK auth handle: it is the module that
 * wraps it. Listed by path, so moving the wrapper is a decision and not an
 * accident.
 */
const WRAPPER = 'libs/tenant/data/admin/src/lib/server/firebase-admin.ts'

/**
 * Below the nx boundary that holds the cached check, so it cannot import it.
 * It pays Firebase's own `checkRevoked` round trip instead — asserted below,
 * because "exempt" and "unchecked" must not be the same entry.
 */
const CHECK_REVOKED_ALWAYS = 'libs/shared/util/fbserver/src/lib/fbserver.ts'

function walk(absoluteDir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  if (!existsSync(absoluteDir)) return found
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name), keep))
    } else if (keep(entry.name)) {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

const isSource = (name: string) =>
  /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)

const sourceFiles = SCAN_ROOTS.flatMap((root) =>
  walk(join(REPO_ROOT, root), isSource),
).map((absolute) => ({
  path: relative(REPO_ROOT, absolute),
  text: readFileSync(absolute, 'utf8'),
}))

describe('every ID-token verification goes through the checked handle', () => {
  it('finds the surface at all', () => {
    // A scan that matched nothing would pass every assertion below. This is
    // the negative control: the guard must be looking at real files.
    const verifiers = sourceFiles.filter((f) =>
      f.text.includes('verifyIdToken('),
    )
    expect(verifiers.length).toBeGreaterThan(50)
  })

  it('lets nobody but the wrapper hold a raw SDK auth handle', () => {
    const offenders = sourceFiles
      .filter(
        (f) =>
          f.path !== WRAPPER &&
          f.path !== CHECK_REVOKED_ALWAYS &&
          f.text.includes("from 'firebase-admin/auth'") &&
          /\bgetAuth\s*\(/.test(f.text),
      )
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('keeps the wrapper wired to the check', () => {
    const wrapper = sourceFiles.find((f) => f.path === WRAPPER)
    expect(wrapper).toBeDefined()
    // Both halves: the import could survive a refactor that dropped the call.
    expect(wrapper.text).toContain('assertIdTokenNotRevoked')
    expect(wrapper.text).toContain('revocationCheckedAuth(getAuth(app))')
  })

  it('keeps the boundary-crossing helper on Firebase-side checkRevoked', () => {
    const shared = sourceFiles.find((f) => f.path === CHECK_REVOKED_ALWAYS)
    expect(shared).toBeDefined()
    expect(shared.text).toContain('verifyIdToken(idToken, true)')
  })
})

describe('every revoke tells its own process immediately', () => {
  /**
   * `revokeRefreshTokens` moves the account's epoch; the process that called
   * it is holding a cached verdict from before that move. Without the
   * invalidation it would serve the revoked token for up to another 15s —
   * including on the reply to the very click that revoked it, which is the
   * one window a person would actually SEE.
   *
   * The pairing is checked by proximity rather than by dataflow: near enough
   * to be obviously about the same uid, loose enough not to fail on a
   * reformat.
   */
  const WINDOW = 8

  it('pairs every revokeRefreshTokens with a cache invalidation', () => {
    const unpaired: string[] = []
    for (const file of sourceFiles) {
      const lines = file.text.split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('revokeRefreshTokens(')) return
        // The declaration in the SDK facade / the doc comments that name it.
        if (line.trimStart().startsWith('*')) return
        if (line.includes('//')) return
        const nearby = lines.slice(index, index + WINDOW).join('\n')
        if (nearby.includes('invalidateTokenRevocationCache')) return
        unpaired.push(`${file.path}:${index + 1}`)
      })
    }
    expect(unpaired).toEqual([])
  })

  it('finds the revoke sites at all', () => {
    // Negative control again: an empty sweep passes the assertion above.
    const sites = sourceFiles.filter((f) =>
      /^[^*/\n]*revokeRefreshTokens\(/m.test(f.text),
    )
    expect(sites.length).toBeGreaterThanOrEqual(6)
  })
})
