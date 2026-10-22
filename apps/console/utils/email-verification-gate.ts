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
'use client'

/**
 * The client's read of the email-verification gate (AGL-479/AGL-480), for the
 * two console-wide effects that fire before a person has verified anything.
 *
 * Every route behind `verifyConsoleIdToken` (and the handful that spell the
 * check out — `/api/auth/session`, `/api/edit-hint/blob`) refuses an
 * unverified caller with a 403. That is correct and stays. What is not
 * correct is an effect that mounts on `/verify-email`, sends a request whose
 * refusal is already legible in the token it signs with, and pays for it:
 * `EditHintBounce` spends its once-a-day throttle window, and the session
 * mint logs an AGL-1142 refusal warning on the most ordinary event there is.
 *
 * ## Read the TOKEN, not `user.emailVerified`
 *
 * The server decides on the decoded ID token, so that is the thing to mirror.
 * `user.emailVerified` is nearly the same answer and would be the wrong one
 * for the case that matters: a staff impersonation session (AGL-480) carries
 * the TARGET account's verification state, which may well be false, and an
 * `impersonatedBy` claim that exempts it. Reading the record would silently
 * switch both effects off for exactly the support session AGL-480 exists to
 * keep working.
 *
 * ## Absent means unverified, because that is what the server does
 *
 * `isEmailVerified` requires `email_verified === true`; a token carrying no
 * such claim (some custom-token sign-ins) is refused. This agrees, so the
 * predicate keeps naming requests the server would refuse rather than
 * inventing a second, looser rule that would leave a 403 through.
 *
 * ## Unreadable claims are not a verdict
 *
 * The `use-is-staff` discipline: "could not read" is not the empty claim set.
 * A token refresh that does not land must not be reported as "this person is
 * unverified" — that would turn a flaky network into a silently disabled
 * feature. It answers `false` (do not suppress), which is precisely today's
 * behavior: the request goes, and the server decides.
 */

/** The account shape this reads: something that can hand back its claims. */
export interface ClaimSource {
  getIdTokenResult?: (
    forceRefresh?: boolean,
  ) => Promise<{ claims?: Record<string, unknown> } | undefined>
}

/**
 * The gate itself, over claims already in hand — the exact predicate
 * `verifyConsoleIdToken` applies, with the AGL-480 impersonation exemption.
 */
export function claimsFailEmailGate(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  if (!claims) return false
  if (typeof claims['impersonatedBy'] === 'string') return false
  return claims['email_verified'] !== true
}

/**
 * Would the email gate refuse this session? `true` means the request need not
 * be sent — the answer is already known, and it is a 403.
 *
 * Cheap: `getIdTokenResult()` reads the cached token and only reaches the
 * network when it has expired, which is the same refresh the call it is
 * guarding would have paid for anyway.
 */
export async function emailGateWouldRefuse(
  user: ClaimSource | null | undefined,
): Promise<boolean> {
  if (!user?.getIdTokenResult) return false
  try {
    const result = await user.getIdTokenResult()
    return claimsFailEmailGate(result?.claims)
  } catch {
    return false
  }
}

export default emailGateWouldRefuse
