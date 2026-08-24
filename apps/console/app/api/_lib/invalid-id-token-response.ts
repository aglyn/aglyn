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

/*==========================================
 * "THIS TOKEN IS NOT VALID" vs "SOMETHING BROKE WHILE CHECKING IT" (AGL-1993).
 *
 * `verifyIdToken` throws for both, and every admin route caught the throw and
 * answered 500. So an expired tab, a signed-out browser retrying, or a bot
 * walking `/api/admin/*` was recorded as Aglyn failing rather than as Aglyn
 * refusing. Nothing leaked — the request was still refused — but 500 is a
 * claim about US, and a log full of false ones is how a real 500 stops being
 * noticed.
 *
 * ## The direction of the default, which is the whole design
 *
 * Unrecognised → null → the caller's existing 500. NOT 401.
 *
 * A wrong 500 makes noise. A wrong 401 tells an operator "your credential is
 * bad" during an outage that has nothing to do with their credential, and
 * hides the outage while it does so. Only codes POSITIVELY known to mean "the
 * credential is bad" earn a 401, and `strictNullChecks` is off repo-wide, so
 * an error with no `code` at all folds to falsy and lands on the 500 default
 * rather than sliding into the 401 branch. That is pinned by a test, because
 * it is exactly the kind of thing a refactor silently inverts.
 *
 * ## `auth/argument-error` is NOT purely a client fault, and that is the trap
 *
 * firebase-admin's `mapJwtErrorToAuthError` maps a bad signature, a malformed
 * JWT, a wrong audience/issuer and an unknown `kid` to `auth/argument-error`.
 * It also FALLS THROUGH to `auth/argument-error` for `KEY_FETCH_ERROR` — its
 * own public-key endpoint being unreachable. Measured against firebase-admin
 * 14.2.0: `lib/utils/jwt.js` builds that message as
 * `'Error fetching public keys for Google certs: …'`, and
 * `lib/auth/token-verifier.js` hands it to the same code as a garbage token.
 *
 * So a Google cert-endpoint outage is, by CODE alone, indistinguishable from a
 * forged token — and a naive `argument-error → 401` would 401 every console
 * user during one and page nobody. The message is the only signal
 * firebase-admin gives, so it is used, and pinned by a test.
 *
 * ## WHY IT LIVES HERE and not beside `verifyConsoleIdToken` in the lib
 *
 * It belongs, conceptually, next to the auth wrapper in
 * `libs/tenant/data/admin/.../firebase-admin.ts`. It is here instead because
 * 178 console specs replace `@aglyn/tenant-data-admin` with a hand-built
 * `jest.mock` factory, and a factory that does not list a symbol makes it
 * `undefined` rather than failing loudly. A new export there red-lines 46
 * suites that have nothing to do with this change, and — worse — the ones
 * that stub it as a no-op would silently stop testing the refusal at all.
 * A module nothing mocks keeps the behaviour real in every one of them.
 *
 * ## What callers must NOT do with this
 *
 * The body is the same one a missing `Authorization` header already gets. It
 * does not say which code matched. Reporting "expired" vs "revoked" vs
 * "malformed" would build an oracle that answers questions about accounts for
 * anyone who can send a request, so only the STATUS changes here.
 *
 * This does not feed the AGL-1921 server-error rate either way: that counter
 * is fed only by `reportServerError`, called only from each app's
 * `onRequestError`, which Next fires only for an UNCAUGHT throw. A handler
 * that catches and returns a Response — every one of these — was never
 * counted. Turning these into 401s cannot therefore quiet a real alarm, and it
 * stops them being false 5xx in the runtime log a drain would grade by status.
 *==========================================*/

/**
 * Codes that mean the CREDENTIAL is bad. Anything absent from this set is
 * treated as an infrastructure failure and keeps its 500 — see the note.
 */
const INVALID_CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  // The JWT itself did not check out: bad signature, malformed, wrong
  // audience or issuer, unknown `kid`, absent/oversized `sub`.
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/session-cookie-expired',
  // Revoked or locked out. `assertIdTokenNotRevoked` (AGL-1881) raises these
  // two with codes matching the SDK's, so both arms agree.
  'auth/id-token-revoked',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
  // The account behind a well-formed token is gone. Fail-closed, and it is a
  // statement about the credential, not about our health.
  'auth/user-not-found',
  // A token minted in a different GCIP tenant than the pool verifying it.
  'auth/mismatching-tenant-id',
])

/**
 * firebase-admin reports its own public-key fetch failing as
 * `auth/argument-error`. That is an OUTAGE, not a bad token — see the note.
 */
const KEY_FETCH_FAILURE = /error fetching public keys/i

/**
 * The 401 a refused credential deserves, or null when the failure is ours and
 * must keep propagating to the caller's 500.
 *
 * Mirrors `freeWorkspaceCapRefusalResponse` so a route's catch stays one line
 * and cannot accidentally mask a real fault.
 */
export function invalidIdTokenResponse(error: unknown): Response | null {
  const code = (error as { code?: unknown })?.code
  if (typeof code !== 'string') return null
  if (!INVALID_CREDENTIAL_CODES.has(code)) return null
  if (code === 'auth/argument-error') {
    const message = (error as { message?: unknown })?.message
    if (typeof message === 'string' && KEY_FETCH_FAILURE.test(message)) {
      return null
    }
  }
  // Byte-identical to the body a missing Authorization header already gets.
  // Never say WHICH code matched.
  return Response.json({ error: 'Unauthenticated' }, { status: 401 })
}
