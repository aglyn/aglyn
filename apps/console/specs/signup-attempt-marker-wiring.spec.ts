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
 * The drought denominator is only a denominator while somebody writes it
 * (AGL-2714).
 *
 * `signupDrought` reds when attempts to create an org arrived and no org came
 * out. Delete the one call that records an attempt, or move it below a
 * refusal branch, and the numerator it is compared against is the only number
 * left — the check goes permanently, silently green, and the next AGL-2581
 * runs for days with the monitor calm. That is the exact failure this whole
 * check exists to prevent, reintroduced one layer down.
 *
 * A source assertion rather than a route test, deliberately. What matters is
 * WHERE the call sits relative to the refusals: a test that drives the happy
 * path would pass with the call anywhere at all, including after the branches
 * that make an attempt worth counting in the first place.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTE = readFileSync(
  join(__dirname, '..', 'app', 'api', 'orgs', 'create', 'route.ts'),
  'utf8',
)

const ROUTE_PROBE = readFileSync(
  join(
    __dirname,
    '..',
    'app',
    'api',
    'health',
    'signup-volume',
    'route.ts',
  ),
  'utf8',
)

const STORE = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'libs',
    'tenant',
    'data',
    'admin',
    'src',
    'lib',
    'server',
    'rate-limit-store.ts',
  ),
  'utf8',
)

describe('the org-create route records the attempt (AGL-2714)', () => {
  it('calls the recorder at all', () => {
    expect(ROUTE).toContain('recordSignupAttempt()')
  })

  it('records BEFORE every refusal, so a refused attempt still counts', () => {
    /**
     * The pair the drought compares is "asked" against "got one". A marker
     * written after the refusals would only ever count attempts that were
     * ALREADY going to succeed, so the ratio could never be anything but 1
     * and the check could never fire.
     */
    const attemptAt = ROUTE.indexOf('recordSignupAttempt()')
    expect(attemptAt).toBeGreaterThan(-1)
    for (const refusal of [
      'return emailUnverifiedResponse()',
      'if (locked) return locked',
      'recordSignupRefusal(',
    ]) {
      const refusalAt = ROUTE.indexOf(refusal)
      expect(refusalAt).toBeGreaterThan(-1)
      expect(attemptAt).toBeLessThan(refusalAt)
    }
  })

  it('records AFTER the token is verified — an attempt is a real session', () => {
    // Ahead of the token check it would count unauthenticated noise, which is
    // the serves mistake in a new place: a denominator anybody can inflate.
    expect(ROUTE.indexOf('verifyIdToken(idToken)')).toBeLessThan(
      ROUTE.indexOf('recordSignupAttempt()'),
    )
  })

  it('is never awaited — the breadcrumb cannot delay or fail a signup', () => {
    expect(ROUTE).not.toMatch(/await\s+recordSignupAttempt/)
  })
})

describe('the marker the probe reads is the marker the route writes', () => {
  it('writes under a prefix of its own that the probe filters on', () => {
    /**
     * The probe filters `doc.id.startsWith(SIGNUP_ATTEMPT_DOC_PREFIX)` after
     * the read. A prefix that collided with a sibling's would make one
     * signal's markers answer another's question; a prefix nothing writes
     * would leave the probe reading and discarding — a denominator of zero,
     * which reads as calm.
     *
     * Read out of the source rather than imported: importing the admin barrel
     * from a spec drags `firebase-admin` in with it.
     */
    const prefixOf = (name: string) =>
      STORE.match(
        new RegExp(`export const ${name}_DOC_PREFIX = '([^']+)'`),
      )?.[1]
    const attempt = prefixOf('SIGNUP_ATTEMPT')
    expect(attempt).toBe('signupAttempted_')
    for (const sibling of ['SIGNUP_SERVED', 'SIGNUP_REFUSAL']) {
      expect(prefixOf(sibling)).toBeDefined()
      expect(attempt).not.toBe(prefixOf(sibling))
    }
    expect(ROUTE_PROBE).toContain('SIGNUP_ATTEMPT_DOC_PREFIX')
  })

  it('stamps attemptedAtMs — the field the range query is served by', () => {
    // NOT `lastAtMs` (AGL-1679), NOT `refusedAtMs` (AGL-1907), NOT
    // `erroredAtMs` (AGL-1921), NOT `servedAtMs` (AGL-2583). Five signals,
    // five disjoint indexes, so no signal's flood can fill another's read
    // limit and silently blind it.
    expect(STORE).toMatch(/attemptedAtMs: nowMs/)
  })

  it('carries the count the verdict sums, and an expiry the sweep reads', () => {
    expect(STORE).toMatch(/attempts: FieldValue\.increment\(1\)/)
    expect(STORE).toMatch(/SIGNUP_ATTEMPT_RETENTION_MS/)
  })
})
