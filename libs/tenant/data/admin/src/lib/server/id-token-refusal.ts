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
 * "THIS TOKEN IS NOT VALID" vs "SOMETHING BROKE WHILE CHECKING IT"
 * (AGL-1993, AGL-2852).
 *
 * `verifyIdToken` throws for both. A handler that answers every throw with a
 * 401 tells the caller their credential is bad during an outage that has
 * nothing to do with it, and nothing pages; one that answers every throw with
 * a 500 records an expired tab as Aglyn failing. This says which one a throw
 * is, so a refusal can answer 401 and anything else keeps a 5xx.
 *
 * ## The direction of the default, which is the whole design
 *
 * Unrecognized → `false` → the caller's 5xx. NOT 401. A wrong 500 makes
 * noise; a wrong 401 hides an outage. Only codes POSITIVELY known to mean the
 * credential is bad answer `true`, and `strictNullChecks` is off repo-wide, so
 * an error with no `code` folds to falsy and lands on the `false` default.
 *
 * ## `auth/argument-error` is NOT purely a client fault
 *
 * firebase-admin maps a bad signature, a malformed JWT, a wrong audience or
 * issuer and an unknown `kid` to `auth/argument-error` — and falls through to
 * the same code for `KEY_FETCH_ERROR`, its own Google public-key endpoint
 * being unreachable (`lib/utils/jwt.js` in firebase-admin 14.2.0 builds that
 * message as `'Error fetching public keys for Google certs: …'`). By code
 * alone a certificate outage is a forged token, so the message is read too.
 *
 * ## Why a module of its own
 *
 * Specs replace `@aglyn/tenant-data-admin` with hand-built `jest.mock`
 * factories — 178 in the console alone — and a factory that does not list a
 * symbol makes it `undefined` rather than failing loudly. This file is its
 * own entry point, `@aglyn/tenant-data-admin/server/id-token-refusal`, which
 * no factory replaces, so the console's `invalidIdTokenResponse` and every
 * plugin handler that verifies a token classify through the same real code.
 * It imports nothing, and must keep importing nothing, for the same reason.
 *
 * ## What callers must NOT do with this
 *
 * Say which code matched. A refusal's body is the one a missing
 * Authorization header already gets; telling "expired" from "revoked" from
 * "no such user" answers questions about accounts for anyone who can send a
 * request.
 *==========================================*/

/**
 * Codes that mean the CREDENTIAL is bad. Anything absent from this set is an
 * infrastructure failure and keeps its 5xx.
 */
const INVALID_CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  // The JWT itself did not check out: bad signature, malformed, wrong
  // audience or issuer, unknown `kid`, absent or oversized `sub`.
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
 * `auth/argument-error`. That is an OUTAGE, not a bad token.
 */
const KEY_FETCH_FAILURE = /error fetching public keys/i

/**
 * Whether a throw from verifying an ID token (or a session cookie) says the
 * credential was refused. `true` answers 401; `false` is a failure to check
 * and must keep the caller's 5xx.
 */
export function isRefusedIdToken(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (typeof code !== 'string') return false
  if (!INVALID_CREDENTIAL_CODES.has(code)) return false
  if (code === 'auth/argument-error') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && KEY_FETCH_FAILURE.test(message)) {
      return false
    }
  }
  return true
}
