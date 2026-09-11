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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
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
 * Every console route that verifies an ID token must actually USE it —
 * `/api/admin` since AGL-1993, every other route since AGL-2796, whose 71
 * catch-alls answered a deleted account's token with 500 and paged. The helper
 * being correct and unreferenced is the shape this repo keeps finding (written
 * but never read), so the wiring is pinned rather than assumed.
 *
 * ## Why it reads the catch, not only the file
 *
 * "The file calls the helper" passes a route with two verifications and one
 * wired catch: `auth/legal-acceptance` verifies in two handlers, and several
 * routes verify in a try of their own ahead of the one that does the work. So
 * each `.verifyIdToken(` is traced to the innermost `try` that catches it
 * within the same function, and THAT catch must consult the helper. A call
 * with no such `try` in its own function (a `verifyCaller` whose caller does
 * the catching) is held to the file check alone.
 *
 * ## The deliberate exceptions
 *
 * Each is named with its reason and held to two conditions, so a stale entry
 * cannot hide a regression: the route must still verify a token, and the catch
 * around its verification must be unable to answer 5xx at all.
 */
describe('every console route that verifies a token uses it (AGL-1993, AGL-2796)', () => {
  const REPO_ROOT = resolve(__dirname, '../../..')
  const CALLS_HELPER = /\binvalidIdTokenResponse\(/

  const DELIBERATE_EXCEPTIONS: Readonly<Record<string, string>> = {
    'apps/console/app/api/[...pluginApi]/route.ts':
      'A refused token is read as an anonymous caller and the dispatch goes ' +
      'on: tenant form posts reach the same registry with no token at all, ' +
      'and the plugin handler decides what an anonymous caller may do.',
    'apps/console/app/api/screens/revalidate/route.ts':
      'Never a 5xx to the editor: the publish already succeeded, so every ' +
      'failure, a refused token included, answers 200 `reason: error`.',
  }

  const read = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8')

  const verifying = execFileSync(
    'git',
    ['ls-files', '--', 'apps/console/app/api'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => /\/route\.tsx?$/.test(file))
    .filter((file) => /\.verifyIdToken\(/.test(read(file)))

  const parse = (file: string) =>
    ts.createSourceFile(
      file,
      read(file),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

  /** Every `.verifyIdToken(` call in a file, paired with the catch around it. */
  const verifications = (file: string) => {
    const source = parse(file)
    const found: { line: number; handler: ts.CatchClause | null }[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'verifyIdToken'
      ) {
        let handler: ts.CatchClause | null = null
        let child: ts.Node = node
        // Stops at the function boundary: a catch in an OUTER function does
        // not run when this call throws inside a callback it never awaited.
        for (
          let parent = node.parent;
          parent && !ts.isFunctionLike(parent);
          parent = parent.parent
        ) {
          if (
            ts.isTryStatement(parent) &&
            parent.tryBlock === child &&
            parent.catchClause
          ) {
            handler = parent.catchClause
            break
          }
          child = parent
        }
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        )
        found.push({ line: line + 1, handler })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return { source, found }
  }

  it('sweeps admin and non-admin routes alike', () => {
    // Anti-vacuity: a sweep that reads nothing passes everything, and a
    // silently-empty guard is the thing that lets a regression through.
    expect(verifying.length).toBeGreaterThan(130)
    expect(verifying).toContain('apps/console/app/api/admin/users/route.ts')
    expect(verifying).toContain('apps/console/app/api/hosts/delete/route.ts')
  })

  it('leaves no route that never consults it', () => {
    const missing = verifying.filter(
      (file) => !(file in DELIBERATE_EXCEPTIONS) && !CALLS_HELPER.test(read(file)),
    )
    expect(missing).toEqual([])
  })

  it('consults it in the catch around every verification, not only somewhere in the file', () => {
    const unwired = verifying
      .filter((file) => !(file in DELIBERATE_EXCEPTIONS))
      .flatMap((file) => {
        const { source, found } = verifications(file)
        return found
          .filter(
            ({ handler }) =>
              handler && !CALLS_HELPER.test(handler.getText(source)),
          )
          .map(({ line }) => `${file}:${line}`)
      })
    expect(unwired).toEqual([])
  })

  it('names only exceptions that still verify a token and cannot answer 5xx', () => {
    const canAnswerServerError = (handler: ts.CatchClause) => {
      let found = false
      const visit = (node: ts.Node) => {
        if (ts.isThrowStatement(node)) found = true
        if (ts.isNumericLiteral(node) && /^5\d\d$/.test(node.text)) found = true
        ts.forEachChild(node, visit)
      }
      visit(handler.block)
      return found
    }
    for (const file of Object.keys(DELIBERATE_EXCEPTIONS)) {
      expect([file, verifying.includes(file)]).toEqual([file, true])
      const { found } = verifications(file)
      expect([file, found.length > 0]).toEqual([file, true])
      for (const { line, handler } of found) {
        expect([`${file}:${line}`, Boolean(handler)]).toEqual([`${file}:${line}`, true])
        expect([`${file}:${line}`, canAnswerServerError(handler)]).toEqual([
          `${file}:${line}`,
          false,
        ])
      }
    }
  })
})
