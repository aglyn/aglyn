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

import { consumeRateLimit } from './rate-limit-store'

/**
 * The cooldown on the AUTOMATIC verification send (AGL-2584).
 *
 * `/verify-email` asks for a link every time it mounts, so somebody who leaves
 * the tab and comes back to see whether the mail arrived asks for a second
 * one. Identity Platform throttles link minting per account, ahead of and
 * independently of the route's own 5/hour budget, and that collision is what a
 * returning visitor met: a mail that had genuinely been sent, reported to them
 * as a send failure.
 *
 * Reopening the page is a request to know whether the first mail worked, not a
 * request for another one — so an automatic send is skipped while a link
 * minted for this uid is still young. The explicit "Resend verification email"
 * button does not come through here: someone who says the mail never arrived
 * is asking deliberately, and that affordance keeps the full per-uid budget.
 *
 * ## Why the state is server-side and not a `sentAt` in the browser
 *
 * The throttle this avoids is per ACCOUNT, so the memory of "a link was minted
 * recently" has to be too. A marker held in the browser cannot see a link
 * minted from a phone, a second browser, or a private window, and clearing
 * site data erases it — each of which puts the collision straight back. It
 * would also put the decision on the side of the wire that does not do the
 * minting, which is where it went wrong the first time.
 *
 * ## Why the durable limiter, with a budget of one
 *
 * A cooldown *is* a limit of one per window, and the limiter already solves
 * the parts that are easy to get wrong: it is global rather than per instance
 * (a per-instance `Map` on Vercel is close to no limit at all, AGL-794), it
 * hashes the key out of the document id, and it fails soft when Firestore is
 * unreachable.
 *
 * Its window is fixed rather than rolling, so a link minted near a boundary
 * can be followed by another as soon as the next window opens — the cooldown
 * holds for somewhere between zero and its full length. It cannot err the
 * other way: the FIRST ask on a uid always lands in a window with room, so a
 * first arrival never waits for its mail. And where a window does end early
 * the outcome is exactly what shipped before this — one extra mint, which the
 * route reports as the throttle it is rather than as a failure.
 */

/**
 * How long an automatic send suppresses the next one. Long enough to cover the
 * round trip this exists for — open the mail app, look, come back — and short
 * enough that someone whose mail was eaten by a spam filter gets a fresh one
 * from a later visit rather than only from the resend button.
 */
export const VERIFY_EMAIL_AUTO_SEND_COOLDOWN_MS = 10 * 60 * 1000

export interface VerifyEmailAutoSendResult {
  /** True when this mount may mint a link. */
  allowed: boolean
  /** Seconds until the cooldown lifts; 0 when allowed. */
  retryAfterSeconds: number
  /** True when the durable store was unreachable and only a local cap applied. */
  degraded: boolean
}

export interface VerifyEmailAutoSendOptions {
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

/**
 * Asks whether the page's automatic send may mint a link for `uid`.
 *
 * Keyed on the uid alone, under its own prefix: the cooldown is one account's
 * and never another's, and it counts separately from the per-uid hourly budget
 * so a suppressed automatic send spends nothing a deliberate resend would want.
 */
export async function consumeVerifyEmailAutoSend(
  uid: string,
  options?: VerifyEmailAutoSendOptions,
): Promise<VerifyEmailAutoSendResult> {
  const at = options?.now ?? Date.now()
  const result = await consumeRateLimit(`verify-email:auto:${uid}`, {
    limit: 1,
    windowMs: VERIFY_EMAIL_AUTO_SEND_COOLDOWN_MS,
    ...(options?.now === undefined ? {} : { now: options.now }),
    ...(options?.firestore === undefined
      ? {}
      : { firestore: options.firestore }),
  })
  return {
    allowed: result.allowed,
    retryAfterSeconds: result.allowed
      ? 0
      : Math.max(1, Math.ceil((result.resetMs - at) / 1000)),
    degraded: result.degraded,
  }
}

export default consumeVerifyEmailAutoSend
