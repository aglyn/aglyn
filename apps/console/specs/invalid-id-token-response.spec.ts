/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
 *
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
 * A refused credential is a 401, an outage is still a 500 (AGL-1993).
 *
 * ## Why the 500 half is the half that matters
 *
 * A test that only asserted "bad token → 401" would pass a helper that
 * returned 401 for EVERYTHING — including a Firestore outage, an expired
 * service-account key, or Google's cert endpoint being down. That helper
 * would tell an operator their credential was bad during an incident and
 * suppress the only signal that the incident existed.
 *
 * So every case below is paired: something that MUST become 401, and
 * something adjacent that MUST NOT. The infrastructure cases are the
 * load-bearing ones. Each was verified to red by mutating the helper:
 * dropping the code enumeration reds 5, dropping the cert-outage carve-out
 * reds 1, and leaking the code into the body reds 1.
 */

import { invalidIdTokenResponse } from '../app/api/_lib/invalid-id-token-response'

/** An error shaped like the ones firebase-admin actually throws. */
const authError = (code: string, message = 'x') =>
  Object.assign(new Error(message), { code })

describe('invalidIdTokenResponse — the credential is bad (AGL-1993)', () => {
  /*
   * These are the codes enumerated from firebase-admin 14.2.0 itself
   * (`lib/auth/error.js`), not guessed. `auth/argument-error` is what a
   * malformed JWT, a bad signature and a wrong audience all collapse to.
   */
  const refusals = [
    'auth/argument-error',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/session-cookie-expired',
    'auth/session-cookie-revoked',
    'auth/user-disabled',
    'auth/user-not-found',
    'auth/mismatching-tenant-id',
  ]

  it.each(refusals)('answers 401 for %s', (code) => {
    const response = invalidIdTokenResponse(authError(code))
    expect([code, response?.status]).toEqual([code, 401])
  })

  it('says nothing about WHICH credential check failed', async () => {
    // An enumeration oracle is the failure mode here: a caller who can tell
    // "expired" from "no such user" can ask questions about accounts.
    const bodies = await Promise.all(
      refusals.map(async (code) => {
        const response = invalidIdTokenResponse(
          authError(code, `detailed reason for ${code}`),
        )
        return JSON.stringify(await response?.json())
      }),
    )
    expect(new Set(bodies).size).toBe(1)
    // And it matches what a missing Authorization header already returns, so
    // the two are indistinguishable from outside.
    expect(JSON.parse(bodies[0])).toEqual({ error: 'Unauthenticated' })
  })

  it('leaks no header a caller could read the reason off', () => {
    const response = invalidIdTokenResponse(authError('auth/id-token-expired'))
    const names = [...response.headers.keys()].map((name) => name.toLowerCase())
    expect(names.filter((name) => name !== 'content-type')).toEqual([])
  })
})

describe('invalidIdTokenResponse — something broke on OUR side (AGL-1993)', () => {
  /*
   * Each of these MUST return null so the caller's existing 500 stands. If
   * any starts returning a Response, a real outage begins reporting itself as
   * an authentication problem.
   */
  const outages = [
    // firebase-admin's own "we could not complete this" codes.
    'auth/internal-error',
    'auth/invalid-credential',
    // The admin app cannot reach its dependencies at all.
    'auth/network-error',
    // A code this helper has never been taught. The DEFAULT is 500, and this
    // is the case that proves the default rather than the enumeration.
    'auth/some-code-invented-after-this-was-written',
  ]

  it.each(outages)('keeps the 500 for %s', (code) => {
    expect([code, invalidIdTokenResponse(authError(code))]).toEqual([code, null])
  })

  it('keeps the 500 for a Firestore/transport failure with no auth code', () => {
    expect(invalidIdTokenResponse(new Error('ECONNRESET'))).toBeNull()
  })

  /*
   * ⚠️ `strictNullChecks` is OFF repo-wide, so an absent `code` folds to a
   * falsy value. These pin that it lands on the 500 default and never slides
   * into the 401 branch.
   */
  it.each([
    ['undefined code', authError(undefined as unknown as string)],
    ['empty-string code', authError('')],
    ['null error', null],
    ['undefined error', undefined],
    ['string thrown instead of an Error', 'auth/id-token-expired'],
    ['numeric code', Object.assign(new Error('x'), { code: 401 })],
  ])('keeps the 500 when the error is %s', (_label, error) => {
    expect(invalidIdTokenResponse(error)).toBeNull()
  })

  /*
   * THE TRAP. firebase-admin's `mapJwtErrorToAuthError` falls through to
   * `auth/argument-error` for `KEY_FETCH_ERROR` — its own Google cert
   * endpoint being unreachable. By code alone that is indistinguishable from
   * a forged token, so a naive `argument-error → 401` would 401 every console
   * user during a Google outage and page nobody. The message is the only
   * signal the SDK gives; this pins that it is used.
   */
  it('keeps the 500 when argument-error is really a cert-fetch outage', () => {
    const outage = authError(
      'auth/argument-error',
      'Error fetching public keys for Google certs: connect ETIMEDOUT',
    )
    expect(invalidIdTokenResponse(outage)).toBeNull()
  })

  it('still 401s an ordinary argument-error, so the carve-out is narrow', () => {
    const forged = authError(
      'auth/argument-error',
      'Firebase ID token has invalid signature.',
    )
    expect(invalidIdTokenResponse(forged)?.status).toBe(401)
  })
})

/**
 * Every admin route must actually USE it. The helper being correct and
 * unreferenced is the shape this repo keeps finding (written but never read),
 * so the wiring is pinned rather than assumed.
 */
describe('every admin route that verifies a token uses it (AGL-1993)', () => {
  it('leaves no route answering 500 for a refused credential', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process')
    const root = require('node:path').resolve(__dirname, '../../..')
    const verifying: string[] = execSync(
      'git ls-files -- apps/console/app/api/admin | grep "route.ts$"',
      { cwd: root, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((file: string) =>
        require('node:fs')
          .readFileSync(require('node:path').join(root, file), 'utf8')
          .includes('verifyIdToken'),
      )

    // Anti-vacuity: if this ever reads zero files the assertion below is
    // meaningless, and a silently-empty guard is the thing that lets a
    // regression through.
    expect(verifying.length).toBeGreaterThan(35)

    const missing = verifying.filter(
      (file: string) =>
        !require('node:fs')
          .readFileSync(require('node:path').join(root, file), 'utf8')
          .includes('invalidIdTokenResponse'),
    )
    expect(missing).toEqual([])
  })
})
